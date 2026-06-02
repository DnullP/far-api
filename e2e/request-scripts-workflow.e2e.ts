import { expect, type Page, test } from "@playwright/test";

const MOCK_PAGE = "/web-mock/mock-tauri-test.html";

interface ConsoleCapture {
  errors: string[];
  infos: string[];
  warnings: string[];
}

async function openMockApp(page: Page): Promise<ConsoleCapture> {
  const capture: ConsoleCapture = { errors: [], infos: [], warnings: [] };
  page.on("console", (msg) => {
    if (msg.type() === "error") {
      capture.errors.push(msg.text());
      return;
    }
    if (msg.type() === "warning") {
      capture.warnings.push(msg.text());
      return;
    }
    if (msg.type() === "info") {
      capture.infos.push(msg.text());
    }
  });
  page.on("pageerror", (error) => {
    capture.errors.push(error.message);
  });

  await page.goto(MOCK_PAGE);
  await page.waitForSelector(".welcome-tab", { timeout: 10_000 });
  return capture;
}

function activeCard(page: Page) {
  return page.locator(".layout-v2-tab-section__card[data-layout-presentation-state='committed']").first();
}

function activeEditor(page: Page) {
  return activeCard(page).locator(".request-editor");
}

function expectNoErrors(capture: ConsoleCapture) {
  expect(capture.errors).toEqual([]);
}

async function openExampleRequest(page: Page) {
  await page.locator("button.request-item", { hasText: "Example Request" }).click();
  await expect(activeEditor(page)).toBeVisible();
}

test.describe("request script workflows", () => {
  test("runs pre-request and post-response scripts around Send", async ({ page }) => {
    const capture = await openMockApp(page);
    await openExampleRequest(page);

    const editor = activeEditor(page);
    await editor.getByRole("button", { name: "Scripts" }).click();
    await page.getByLabel("Pre-request script").fill([
      "pm.request.url = 'https://mock.local/scripted';",
      "pm.request.method = 'POST';",
      "pm.request.headers.upsert({ key: 'X-Script', value: 'pre' });",
      "pm.request.params.add({ key: 'source', value: 'pre-script' });",
      "pm.variables.set('local_path', 'scripted');",
      "pm.environment.set('trace_value', 'trace-from-script');",
      "pm.request.params.add({ key: 'local', value: '{{local_path}}' });",
      "pm.request.body.update({ from: 'pre' });",
      "console.log('pre script complete');",
    ].join("\n"));
    await page.getByLabel("Post-response script").fill([
      "pm.test('status is OK', () => pm.expect(pm.response.code).to.equal(200));",
      "pm.test('path is scripted', () => pm.expect(pm.response.json().path).to.equal('/scripted'));",
      "console.info('post script complete');",
    ].join("\n"));

    await expect.poll(() => capture.infos.some((line) =>
      line.includes("[mock:tauriClient]") &&
      line.includes("invoke success") &&
      line.includes("update_request") &&
      line.includes("trace=far-api:update_request"),
    )).toBe(true);

    await editor.locator("button.send-btn").click();
    await expect(editor.locator(".response-status")).toContainText("200 OK", { timeout: 10_000 });
    const responseText = await editor.locator("pre.response-body").textContent();
    expect(responseText).toContain('"path": "/scripted"');
    expect(responseText).toContain('"source": "pre-script"');
    expect(responseText).toContain('"local": "scripted"');
    expect(responseText).toContain('"X-Trace": "trace-from-script"');
    expect(responseText).toContain('"X-Script": "pre"');
    expect(responseText).toContain('"{\\n  \\"from\\": \\"pre\\"\\n}"');

    await expect(editor.locator(".script-test.passed", { hasText: "status is OK" })).toBeVisible();
    await expect(editor.locator(".script-test.passed", { hasText: "path is scripted" })).toBeVisible();
    await expect(editor.locator(".script-console", { hasText: "pre script complete" })).toBeVisible();
    await expect(editor.locator(".script-console", { hasText: "post script complete" })).toBeVisible();

    await expect.poll(() => capture.infos.some((line) =>
      line.includes("[mock:scriptRunner]") &&
      line.includes("pre-request script success"),
    )).toBe(true);
    await expect.poll(() => capture.infos.some((line) =>
      line.includes("[mock:scriptRunner]") &&
      line.includes("post-response script success"),
    )).toBe(true);
    await expect.poll(() => capture.infos.some((line) =>
      line.includes("[mock:tauriClient]") &&
      line.includes("invoke success") &&
      line.includes("http_request") &&
      line.includes("trace=far-api:http_request"),
    )).toBe(true);
    await expect.poll(() => capture.infos.some((line) =>
      line.includes("[mock:tauriClient]") &&
      line.includes("invoke success") &&
      line.includes("add_history") &&
      line.includes("trace=far-api:add_history"),
    )).toBe(true);

    expectNoErrors(capture);
  });

  test("shows script failures and does not send the request", async ({ page }) => {
    const capture = await openMockApp(page);
    await openExampleRequest(page);

    const editor = activeEditor(page);
    await editor.getByRole("button", { name: "Scripts" }).click();
    await page.getByLabel("Pre-request script").fill("throw new Error('blocked by script');");
    await editor.locator("button.send-btn").click();

    await expect(editor.locator(".response-status")).toContainText("Error", { timeout: 5_000 });
    await expect(editor.locator("pre.response-body")).toContainText("blocked by script");
    await expect(editor.locator(".script-test.failed", { hasText: "pre-request script" })).toBeVisible();

    await expect.poll(() => capture.infos.some((line) =>
      line.includes("[mock:scriptRunner]") &&
      line.includes("pre-request script start"),
    )).toBe(true);
    expect(capture.infos.some((line) =>
      line.includes("[mock:tauriClient]") &&
      line.includes("invoke success") &&
      line.includes("http_request"),
    )).toBe(false);
    expectNoErrors(capture);
  });
});
