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

test.describe("cURL import workflows", () => {
  test("imports pasted cURL into the active request and sends it", async ({ page }) => {
    const capture = await openMockApp(page);
    await openExampleRequest(page);

    const editor = activeEditor(page);
    const curl = "curl -X PATCH 'https://mock.local/curl-paste?from=clipboard' -H 'Content-Type: application/json' -H 'X-Trace: paste-trace' --data '{\"ok\":true}'";

    await editor.locator("input.url-input").evaluate((input, text) => {
      const clipboardData = new DataTransfer();
      clipboardData.setData("text", text);
      input.dispatchEvent(new ClipboardEvent("paste", {
        bubbles: true,
        cancelable: true,
        clipboardData,
      }));
    }, curl);

    await expect(editor.locator("input.url-input")).toHaveValue("https://mock.local/curl-paste");
    await expect(editor.locator(".method-trigger")).toContainText("PATCH");
    await editor.getByRole("button", { name: "Params" }).click();
    await expect(editor.locator(".kv-row").first().locator(".kv-key")).toHaveValue("from");
    await expect(editor.locator(".kv-row").first().locator(".kv-value")).toHaveValue("clipboard");
    await editor.getByRole("button", { name: "Headers" }).click();
    await expect(editor.locator(".kv-row").nth(0).locator(".kv-key")).toHaveValue("Content-Type");
    await expect(editor.locator(".kv-row").nth(0).locator(".kv-value")).toHaveValue("application/json");
    await expect(editor.locator(".kv-row").nth(1).locator(".kv-key")).toHaveValue("X-Trace");
    await expect(editor.locator(".kv-row").nth(1).locator(".kv-value")).toHaveValue("paste-trace");
    await editor.getByRole("button", { name: "Body" }).click();
    await expect(editor.locator(".body-textarea")).toHaveValue("{\"ok\":true}");

    await expect.poll(() => capture.infos.some((line) =>
      line.includes("[tauriClient] invoke start") && line.includes("update_request"),
    )).toBe(true);
    await expect.poll(() => capture.infos.some((line) =>
      line.includes("[mock:tauriClient]") &&
      line.includes("invoke success") &&
      line.includes("update_request") &&
      line.includes("trace=far-api:update_request"),
    )).toBe(true);

    await editor.locator("button.send-btn").click();
    await expect(editor.locator(".response-status")).toContainText("200 OK", { timeout: 10_000 });
    const responseText = await editor.locator("pre.response-body").textContent();
    expect(responseText).toContain('"path": "/curl-paste"');
    expect(responseText).toContain('"from": "clipboard"');
    expect(responseText).toContain('"X-Trace": "paste-trace"');
    expect(responseText).toContain('"{\\"ok\\":true}"');

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

  test("imports from the cURL modal and supports cancel and validation errors", async ({ page }) => {
    const capture = await openMockApp(page);
    await openExampleRequest(page);

    const editor = activeEditor(page);
    await editor.getByTitle("Import cURL").click();
    await expect(page.getByRole("dialog", { name: "Import cURL" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "Import cURL" })).toHaveCount(0);

    await editor.getByTitle("Import cURL").click();
    await page.getByLabel("cURL command").fill("curl -X TRACE https://mock.local/invalid");
    await page.getByRole("button", { name: "Import", exact: true }).click();
    await expect(page.getByText(/Unsupported HTTP method/)).toBeVisible();

    await page.getByLabel("cURL command").fill("curl --url https://mock.local/modal-import -H 'Accept: application/json'");
    await page.getByRole("button", { name: "Import", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "Import cURL" })).toHaveCount(0);
    await expect(editor.locator("input.url-input")).toHaveValue("https://mock.local/modal-import");
    await expect(editor.locator(".method-trigger")).toContainText("GET");
    await editor.getByRole("button", { name: "Headers" }).click();
    await expect(editor.locator(".kv-row").first().locator(".kv-key")).toHaveValue("Accept");
    await expect(editor.locator(".kv-row").first().locator(".kv-value")).toHaveValue("application/json");

    await expect.poll(() => capture.infos.some((line) =>
      line.includes("[mock:tauriClient]") &&
      line.includes("invoke success") &&
      line.includes("update_request") &&
      line.includes("trace=far-api:update_request"),
    )).toBe(true);

    expectNoErrors(capture);
  });
});
