/**
 * E2E regression test for the ResponseViewer hook order fix.
 *
 * Verifies that clicking "Send" transitions the UI from empty → loading → response
 * without any React hook order violation errors appearing in the console.
 *
 * Requires the Tauri dev server running on http://127.0.0.1:1420
 */
import { test, expect } from "@playwright/test";

const MOCK_PAGE = "/web-mock/mock-tauri-test.html";

test.describe("ResponseViewer hook order regression", () => {
  test("sending a request transitions through all states without errors", async ({
    page,
  }) => {
    // Collect console errors during the test
    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") {
        consoleErrors.push(msg.text());
      }
    });

    // Collect page errors (uncaught exceptions)
    const pageErrors: string[] = [];
    page.on("pageerror", (err) => {
      pageErrors.push(err.message);
    });

    await page.goto(MOCK_PAGE);

    // Wait for the app to finish loading (welcome tab should appear)
    await page.waitForSelector(".welcome-tab", { timeout: 10_000 });

    // Click on a request item in the collections panel to open a request tab
    const requestItem = page.locator("button.request-item").first();
    await expect(requestItem).toBeVisible({ timeout: 5_000 });
    await requestItem.click();

    // Wait for the request editor to appear with the response empty state
    await expect(page.locator(".response-viewer.response-empty")).toBeVisible({
      timeout: 5_000,
    });

    // Ensure URL input has a value (fill if empty)
    const urlInput = page.locator("input.url-input");
    await expect(urlInput).toBeVisible({ timeout: 3_000 });
    const currentVal = await urlInput.inputValue();
    if (!currentVal || currentVal.trim() === "") {
      await urlInput.fill("https://httpbin.org/get");
    }

    // Click the Send button
    const sendBtn = page.locator("button.send-btn");
    await expect(sendBtn).toBeVisible({ timeout: 3_000 });
    await sendBtn.click();

    // Should transition through loading → response
    // Wait for a response status to appear
    const statusIndicator = page.locator(".response-status").first();
    await expect(statusIndicator).toBeVisible({ timeout: 15_000 });

    // Verify status is displayed
    const statusText = await statusIndicator.textContent();
    expect(statusText).toBeTruthy();

    // CRITICAL: No hook order errors should have appeared
    const hookErrors = consoleErrors.filter(
      (e) =>
        e.includes("change in the order of Hooks") ||
        e.includes("Rendered more hooks than during the previous render") ||
        e.includes("Rendered fewer hooks than expected")
    );
    expect(hookErrors).toEqual([]);

    // No uncaught exceptions related to hooks
    const hookPageErrors = pageErrors.filter(
      (e) =>
        e.includes("Rendered more hooks") ||
        e.includes("Rendered fewer hooks")
    );
    expect(hookPageErrors).toEqual([]);
  });

  test("switching between tabs in response viewer works correctly", async ({
    page,
  }) => {
    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") {
        consoleErrors.push(msg.text());
      }
    });

    await page.goto(MOCK_PAGE);
    await page.waitForSelector(".welcome-tab", { timeout: 10_000 });

    // Open a request tab
    const requestItem = page.locator("button.request-item").first();
    await expect(requestItem).toBeVisible({ timeout: 5_000 });
    await requestItem.click();

    // Wait for response empty state
    await expect(page.locator(".response-viewer.response-empty")).toBeVisible({
      timeout: 5_000,
    });

    // Send a request
    const sendBtn = page.locator("button.send-btn");
    await expect(sendBtn).toBeVisible({ timeout: 3_000 });
    await sendBtn.click();

    // Wait for response
    const statusIndicator = page.locator(".response-status").first();
    await expect(statusIndicator).toBeVisible({ timeout: 15_000 });

    // Switch to Headers tab (the one inside response-viewer, not request config)
    const responseViewer = page.locator(".response-viewer");
    const headersTab = responseViewer.locator('button:text("Headers")');
    await expect(headersTab).toBeVisible({ timeout: 3_000 });
    await headersTab.click();

    // Should see header rows
    await expect(
      page.locator(".response-headers-list .header-key").first()
    ).toBeVisible({ timeout: 3_000 });
    await expect(page.locator(".response-header-row").first()).toHaveCSS("user-select", "text");

    // Switch back to Body tab
    const bodyTab = responseViewer.locator('button:text("Body")');
    await expect(bodyTab).toBeVisible({ timeout: 3_000 });
    await bodyTab.click();

    // Should see response body
    await expect(page.locator("pre.response-body").first()).toBeVisible({
      timeout: 3_000,
    });
    await expect(page.locator("pre.response-body").first()).toHaveCSS("user-select", "text");
    await expect(responseViewer.locator(".response-tabs")).toHaveCSS("user-select", "none");
    await expect(page.locator("input.url-input")).toHaveCSS("user-select", "text");

    // No hook errors
    const hookErrors = consoleErrors.filter(
      (e) =>
        e.includes("change in the order of Hooks") ||
        e.includes("Rendered more hooks")
    );
    expect(hookErrors).toEqual([]);
  });

  test("resolves environment variables and auth helpers before sending", async ({ page }) => {
    const consoleErrors: string[] = [];
    const infos: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") {
        consoleErrors.push(msg.text());
      }
      if (msg.type() === "info") {
        infos.push(msg.text());
      }
    });
    page.on("pageerror", (err) => {
      consoleErrors.push(err.message);
    });

    await page.goto(MOCK_PAGE);
    await page.waitForSelector(".welcome-tab", { timeout: 10_000 });

    await page.locator("button.request-item", { hasText: "Example Request" }).click();
    await expect(page.locator(".request-editor")).toBeVisible();

    await page.locator("input.url-input").fill("{{base_url}}/anything");
    await page.getByRole("button", { name: "Headers" }).click();
    const headerRows = page.locator(".kv-row");
    await headerRows.first().locator(".kv-key").fill("X-Trace");
    await headerRows.first().locator(".kv-value").fill("{{trace_value}}");

    await page.getByRole("button", { name: "Auth" }).click();
    await page.getByLabel("Auth type").selectOption("bearer");
    await page.getByLabel("Bearer token").fill("{{api_token}}");

    await page.getByRole("button", { name: "Body" }).click();
    await page.locator(".body-textarea").fill('{"env":"{{workspace}}"}');

    await page.locator("button.send-btn").click();

    await expect(page.locator(".response-status")).toContainText("200 OK", { timeout: 10_000 });
    const responseText = await page.locator("pre.response-body").textContent();
    expect(responseText).toContain('"url": "https://mock.local/anything?from=dev"');
    expect(responseText).toContain('"Authorization": "Bearer secret-token"');
    expect(responseText).toContain('"X-Trace": "trace-dev"');
    expect(responseText).toContain('"{\\"env\\":\\"dev\\"}"');

    await expect.poll(() => infos.some((line) =>
      line.includes("[mock:tauriClient]") &&
      line.includes("invoke success") &&
      line.includes("http_request") &&
      line.includes("trace=far-api:http_request"),
    )).toBe(true);

    expect(consoleErrors).toEqual([]);
  });
});
