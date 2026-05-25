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

function activeCard(page: Page) {
  return page.locator(".layout-v2-tab-section__card[data-layout-presentation-state='committed']").first();
}

function activeEditor(page: Page) {
  return activeCard(page).locator(".request-editor");
}

async function sendExampleRequest(page: Page) {
  await page.locator("button.request-item", { hasText: "Example Request" }).click();
  const editor = activeEditor(page);
  await expect(editor).toBeVisible();

  await editor.locator("input.url-input").fill("{{base_url}}/history-search");
  await editor.getByRole("button", { name: "Headers" }).click();
  await editor.locator(".kv-row").first().locator(".kv-key").fill("X-Trace");
  await editor.locator(".kv-row").first().locator(".kv-value").fill("{{trace_value}}");

  await editor.getByRole("button", { name: "Body" }).click();
  await editor.locator(".body-textarea").fill('{"history":"{{workspace}}"}');

  await editor.locator("button.send-btn").click();
  await expect(editor.locator(".response-status")).toContainText("200 OK", { timeout: 10_000 });
}

async function openHistoryPanel(page: Page) {
  await page.locator("button[data-layout-panel-id='panel-rest-history']").click();
  await expect(page.locator(".panel-title", { hasText: "History" })).toBeVisible();
}

test.describe("History user workflows", () => {
  test("searches, replays, deletes, and clears history with traceable backend calls", async ({ page }) => {
    const capture = await openMockApp(page);

    await sendExampleRequest(page);

    await expect.poll(() => capture.infos.some((line) =>
      line.includes("[tauriClient] invoke start") && line.includes("add_history"),
    )).toBe(true);
    await expect.poll(() => capture.infos.some((line) =>
      line.includes("[mock:tauriClient]") &&
      line.includes("invoke success") &&
      line.includes("add_history") &&
      line.includes("trace=far-api:add_history"),
    )).toBe(true);

    await openHistoryPanel(page);

    const search = page.getByLabel("Search history");
    await expect(search).toBeVisible();
    await expect(page.locator(".history-entry", { hasText: "https://mock.local/history-search" })).toBeVisible();

    await search.fill("history-search");
    await expect(page.locator(".history-entry")).toHaveCount(1);
    await expect(page.locator(".history-entry", { hasText: "200 OK" })).toBeVisible();

    await search.fill("no-history-match");
    await expect(page.getByText("No history matches your search.")).toBeVisible();
    await page.getByTitle("Clear Search").click();
    await expect(page.locator(".history-entry", { hasText: "https://mock.local/history-search" })).toBeVisible();

    await expect(page.locator(".history-entry")).toHaveCSS("user-select", "none");
    await expect(page.locator(".history-entry")).toHaveCSS("cursor", "pointer");
    await expect(page.locator(".history-entry").locator(".history-url")).toHaveCSS("cursor", "pointer");

    const historyEntry = page.locator(".history-entry", { hasText: "https://mock.local/history-search" }).first();
    await historyEntry.click();
    await expect(activeEditor(page)).toBeVisible();
    await expect(activeEditor(page).locator("input.url-input")).toHaveValue("https://mock.local/history-search");

    await openHistoryPanel(page);
    await page.locator(".history-entry", { hasText: "https://mock.local/history-search" }).first().hover();
    await page.getByTitle("Replay Request").first().click();
    await expect(activeEditor(page).locator("input.url-input")).toHaveValue("https://mock.local/history-search");

    await openHistoryPanel(page);
    await page.locator(".history-entry", { hasText: "https://mock.local/history-search" }).first().press("Enter");
    await expect(activeEditor(page).locator("input.url-input")).toHaveValue("https://mock.local/history-search");

    await openHistoryPanel(page);
    await page.locator(".history-entry", { hasText: "https://mock.local/history-search" }).first().press("Space");
    await expect(activeEditor(page).locator("input.url-input")).toHaveValue("https://mock.local/history-search");

    await activeEditor(page).locator("button.send-btn").click();
    await expect(activeEditor(page).locator(".response-status")).toContainText("200 OK", { timeout: 10_000 });
    await expect.poll(() => capture.infos.some((line) =>
      line.includes("[mock:tauriClient]") &&
      line.includes("invoke success") &&
      line.includes("http_request") &&
      line.includes("trace=far-api:http_request"),
    )).toBe(true);

    await openHistoryPanel(page);
    await expect(page.locator(".history-entry")).toHaveCount(2);
    await page.locator(".history-entry", { hasText: "https://mock.local/history-search" }).first().hover();
    await page.getByTitle("Delete History Entry").first().click();
    await expect.poll(() => capture.infos.some((line) =>
      line.includes("[mock:tauriClient]") &&
      line.includes("invoke success") &&
      line.includes("delete_history_entry") &&
      line.includes("trace=far-api:delete_history_entry"),
    )).toBe(true);
    await expect(page.locator(".history-entry")).toHaveCount(1);

    await page.getByTitle("Clear History").click();
    await expect(page.getByText("No request history yet.")).toBeVisible();
    await expect.poll(() => capture.infos.some((line) =>
      line.includes("[mock:tauriClient]") &&
      line.includes("invoke success") &&
      line.includes("clear_history") &&
      line.includes("trace=far-api:clear_history"),
    )).toBe(true);

    expectNoErrors(capture);
  });
});
