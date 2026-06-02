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

function expectNoErrors(capture: ConsoleCapture) {
  expect(capture.errors).toEqual([]);
}

async function dragWithin(page: Page, selector: string, deltaX: number, deltaY: number) {
  const box = await page.locator(selector).boundingBox();
  expect(box).not.toBeNull();
  if (!box) {
    return;
  }

  const startX = box.x + box.width / 2;
  const startY = box.y + Math.min(24, box.height / 2);
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + deltaX, startY + deltaY, { steps: 6 });
  await page.mouse.up();
}

test.describe("collection runner workflows", () => {
  test("runs a collection with iterations and reports script test results", async ({ page }) => {
    const capture = await openMockApp(page);

    await page.locator("button.request-item", { hasText: "Example Request" }).click();
    const editor = page.locator(".layout-v2-tab-section__card[data-layout-presentation-state='committed'] .request-editor");
    await expect(editor).toBeVisible();
    await editor.getByRole("button", { name: "Scripts" }).click();
    await page.getByLabel("Pre-request script").fill([
      "pm.request.headers.upsert({ key: 'X-Runner', value: 'runner-pre' });",
      "pm.request.params.add({ key: 'runner', value: 'yes' });",
    ].join("\n"));
    await page.getByLabel("Post-response script").fill("pm.test('runner status ok', () => pm.expect(pm.response.code).to.equal(200));");
    await expect.poll(() => capture.infos.some((line) =>
      line.includes("[mock:tauriClient]") &&
      line.includes("invoke success") &&
      line.includes("update_request"),
    )).toBe(true);

    await page.getByTitle("Run First Collection").click();
    const runner = page.getByRole("dialog", { name: "Run Collection" });
    await expect(runner).toBeVisible();
    await runner.getByLabel("Runner iterations").fill("2");
    await runner.getByRole("button", { name: "Run", exact: true }).click();

    await expect(page.locator(".runner-summary", { hasText: "2 requests" })).toBeVisible({ timeout: 10_000 });
    await expect(page.locator(".runner-summary", { hasText: "2 passed" })).toBeVisible();
    await expect(page.locator(".runner-result", { hasText: "#1" })).toContainText("200 OK");
    await expect(page.locator(".runner-result", { hasText: "#2" })).toContainText("200 OK");
    await expect(page.locator(".runner-tests", { hasText: "PASS runner status ok" })).toHaveCount(2);
    await expect(page.locator(".runner-history", { hasText: "Recent Reports" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Open runner report My Collection" })).toBeVisible();

    await expect.poll(() => capture.infos.some((line) =>
      line.includes("[mock:collectionRunner]") &&
      line.includes("run start"),
    )).toBe(true);
    await expect.poll(() => capture.infos.some((line) =>
      line.includes("[mock:collectionRunner]") &&
      line.includes("run complete"),
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
      line.includes("add_runner_report") &&
      line.includes("trace=far-api:add_runner_report"),
    )).toBe(true);
    await expect.poll(() => capture.infos.some((line) =>
      line.includes("[mock:tauriClient]") &&
      line.includes("invoke success") &&
      line.includes("list_runner_reports") &&
      line.includes("trace=far-api:list_runner_reports"),
    )).toBe(true);

    expectNoErrors(capture);
  });

  test("runs a folder from the context menu", async ({ page }) => {
    const capture = await openMockApp(page);

    await page.locator(".collection-header", { hasText: "My Collection" }).hover();
    await page.locator(".collection-header", { hasText: "My Collection" }).getByTitle("Add Folder").click();
    await page.getByRole("button", { name: "Create Folder" }).click();
    await expect(page.locator(".folder-item", { hasText: "New Folder" })).toBeVisible();

    await page.locator(".folder-item", { hasText: "New Folder" }).click({ button: "right" });
    await page.locator(".context-menu").getByRole("button", { name: "Run", exact: true }).click();
    const runner = page.getByRole("dialog", { name: "Run Collection" });
    await expect(runner).toBeVisible();
    await runner.getByRole("button", { name: "Run", exact: true }).click();
    await expect(page.locator(".runner-summary", { hasText: "0 requests" })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole("button", { name: "Open runner report New Folder" })).toBeVisible();

    await expect.poll(() => capture.infos.some((line) =>
      line.includes("[mock:tauriClient]") &&
      line.includes("invoke success") &&
      line.includes("create_folder") &&
      line.includes("trace=far-api:create_folder"),
    )).toBe(true);

    expectNoErrors(capture);
  });

  test("opens and deletes a saved runner report", async ({ page }) => {
    const capture = await openMockApp(page);

    await page.getByTitle("Run First Collection").click();
    const runner = page.getByRole("dialog", { name: "Run Collection" });
    await expect(runner).toBeVisible();
    await runner.getByRole("button", { name: "Run", exact: true }).click();

    await expect(page.locator(".runner-summary", { hasText: "1 requests" })).toBeVisible({ timeout: 10_000 });
    const reportButton = page.getByRole("button", { name: "Open runner report My Collection" });
    await expect(reportButton).toBeVisible();
    await runner.getByLabel("Runner iterations").fill("3");
    await reportButton.click();
    await expect(page.locator(".runner-summary", { hasText: "1 requests" })).toBeVisible();

    await page.getByRole("button", { name: "Delete runner report My Collection" }).click();
    await expect(reportButton).toHaveCount(0);
    await expect(page.locator(".runner-history-empty", { hasText: "No saved runner reports yet." })).toBeVisible();

    await expect.poll(() => capture.infos.some((line) =>
      line.includes("[mock:tauriClient]") &&
      line.includes("invoke success") &&
      line.includes("delete_runner_report") &&
      line.includes("trace=far-api:delete_runner_report"),
    )).toBe(true);

    expectNoErrors(capture);
  });

  test("covers runner modal close, overlay, Escape, and disabled-safe gestures", async ({ page }) => {
    const capture = await openMockApp(page);

    await page.getByTitle("Run First Collection").click();
    await expect(page.getByRole("dialog", { name: "Run Collection" })).toBeVisible();
    await page.getByLabel("Close runner").click();
    await expect(page.getByRole("dialog", { name: "Run Collection" })).toHaveCount(0);

    await page.getByTitle("Run First Collection").click();
    await expect(page.getByRole("dialog", { name: "Run Collection" })).toBeVisible();
    await page.getByRole("dialog", { name: "Run Collection" }).getByRole("button", { name: "Close", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "Run Collection" })).toHaveCount(0);

    await page.getByTitle("Run First Collection").click();
    await expect(page.getByRole("dialog", { name: "Run Collection" })).toBeVisible();
    await page.locator(".collection-modal-overlay").click({ position: { x: 4, y: 4 } });
    await expect(page.getByRole("dialog", { name: "Run Collection" })).toHaveCount(0);

    await page.getByTitle("Run First Collection").click();
    const runner = page.getByRole("dialog", { name: "Run Collection" });
    await expect(runner).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(runner).toHaveCount(0);

    await page.getByTitle("Run First Collection").click();
    await expect(runner).toBeVisible();
    await runner.getByLabel("Runner iterations").fill("2");
    await runner.getByLabel("Runner iterations").click({ button: "right" });
    await runner.dblclick();
    await dragWithin(page, ".collection-runner-modal", 18, 18);
    await expect(runner).toBeVisible();
    await runner.getByRole("button", { name: "Run", exact: true }).click();
    await expect(page.locator(".runner-summary", { hasText: "2 requests" })).toBeVisible({ timeout: 10_000 });

    const reportButton = page.getByRole("button", { name: "Open runner report My Collection" });
    await reportButton.click({ button: "right" });
    await expect(reportButton).toBeVisible();
    await reportButton.dblclick();
    await expect(page.locator(".runner-summary", { hasText: "2 requests" })).toBeVisible();

    expectNoErrors(capture);
  });
});
