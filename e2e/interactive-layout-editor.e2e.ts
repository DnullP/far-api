import { expect, type Locator, type Page, test } from "@playwright/test";

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

function activeEditor(page: Page): Locator {
  return page.locator(".layout-v2-tab-section__card[data-layout-presentation-state='committed'] .request-editor").first();
}

async function openExampleRequest(page: Page): Promise<Locator> {
  await page.locator("button.request-item", { hasText: "Example Request" }).click();
  const editor = activeEditor(page);
  await expect(editor).toBeVisible();
  return editor;
}

async function dragBy(page: Page, locator: Locator, deltaX: number, deltaY: number) {
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  if (!box) {
    return;
  }

  const startX = box.x + box.width / 2;
  const startY = box.y + box.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + deltaX, startY + deltaY, { steps: 8 });
  await page.mouse.up();
}

test.describe("interactive layout and request editor baseline", () => {
  test("covers activity icons, panel tabs, workbench tabs, and settings modal gestures", async ({ page }) => {
    const capture = await openMockApp(page);

    const restActivity = page.locator("[data-layout-role='activity-icon'][data-layout-icon-id='protocol-rest']");
    const graphQLActivity = page.locator("[data-layout-role='activity-icon'][data-layout-icon-id='protocol-graphql']");
    const rpcActivity = page.locator("[data-layout-role='activity-icon'][data-layout-icon-id='protocol-rpc']");
    const settingsActivity = page.locator("[data-layout-role='activity-icon'][data-layout-icon-id='settings']");

    await graphQLActivity.click();
    await expect(page.getByText("GraphQL workspace is reserved")).toBeVisible();
    await graphQLActivity.click({ button: "right" });
    await expect(page.getByText("GraphQL workspace is reserved")).toBeVisible();
    await graphQLActivity.dblclick();
    await expect(page.getByText("GraphQL workspace is reserved")).toBeVisible();

    await rpcActivity.click();
    await expect(page.getByText("RPC workspace is reserved")).toBeVisible();
    await restActivity.dragTo(rpcActivity);
    await expect(restActivity).toBeVisible();
    await expect(rpcActivity).toBeVisible();

    await restActivity.click();
    await expect(page.locator(".collections-panel")).toBeVisible();

    const collectionsPanel = page.locator("[data-layout-role='panel'][data-layout-panel-id='panel-rest-collections']");
    const envPanel = page.locator("[data-layout-role='panel'][data-layout-panel-id='panel-rest-env']");
    const historyPanel = page.locator("[data-layout-role='panel'][data-layout-panel-id='panel-rest-history']");
    await envPanel.click();
    await expect(page.locator(".env-panel")).toBeVisible();
    await envPanel.click({ button: "right" });
    await expect(page.locator(".env-panel")).toBeVisible();
    await envPanel.dblclick();
    await expect(page.locator(".env-panel")).toBeVisible();
    await envPanel.dragTo(historyPanel);
    await expect(page.getByRole("button", { name: "Environments" })).toBeVisible();
    await historyPanel.click();
    await expect(page.locator(".history-panel")).toBeVisible();
    await collectionsPanel.click();
    await expect(page.locator(".collections-panel")).toBeVisible();

    await openExampleRequest(page);
    const welcomeTab = page.locator(".layout-v2-tab-section__tab", { hasText: "Welcome" }).first();
    const requestTab = page.locator(".layout-v2-tab-section__tab", { hasText: "POST Example Request" }).first();
    await expect(requestTab).toBeVisible();

    await welcomeTab.click();
    await expect(page.locator(".welcome-tab")).toBeVisible();
    await requestTab.click();
    await expect(activeEditor(page)).toBeVisible();
    await requestTab.click({ button: "right" });
    await expect(activeEditor(page)).toBeVisible();
    await requestTab.dblclick();
    await expect(activeEditor(page)).toBeVisible();
    await requestTab.dragTo(welcomeTab);
    await expect(page.locator(".layout-v2-tab-section__tab", { hasText: "POST Example Request" })).toBeVisible();

    await settingsActivity.click();
    const settingsModal = page.locator(".settings-modal");
    await expect(settingsModal).toBeVisible();
    await page.getByRole("button", { name: "Light" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await page.getByRole("button", { name: "Light" }).click({ button: "right" });
    await expect(settingsModal).toBeVisible();
    await page.getByRole("button", { name: "Dark" }).dblclick();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await page.getByRole("button", { name: "Light" }).dragTo(page.getByRole("button", { name: "Dark" }));
    await expect(settingsModal).toBeVisible();
    await settingsModal.locator(".settings-close").click();
    await expect(settingsModal).toHaveCount(0);

    await settingsActivity.click();
    await expect(settingsModal).toBeVisible();
    await page.locator(".settings-overlay").click({ position: { x: 4, y: 4 } });
    await expect(settingsModal).toHaveCount(0);

    const closeRequestTab = page.locator(".layout-v2-tab-section__tab", { hasText: "POST Example Request" })
      .locator(".layout-v2-tab-section__tab-close")
      .first();
    await closeRequestTab.click();
    await expect(activeEditor(page)).toHaveCount(0);

    expectNoErrors(capture);
  });

  test("covers request editor click, keyboard, right-click, double-click, drag, and resize paths", async ({ page }) => {
    const capture = await openMockApp(page);
    const editor = await openExampleRequest(page);
    const reqTab = (name: string | RegExp) => editor.locator(".req-tabs button", { hasText: name });

    const methodTrigger = editor.locator(".method-trigger");
    await methodTrigger.click();
    await expect(editor.locator(".method-menu")).toBeVisible();
    await editor.locator(".method-option", { hasText: "PATCH" }).click();
    await expect(methodTrigger).toContainText("PATCH");
    await methodTrigger.click({ button: "right" });
    await expect(editor.locator(".method-menu")).toHaveCount(0);
    await methodTrigger.dblclick();
    await expect(editor.locator(".method-menu")).toHaveCount(0);

    await methodTrigger.click();
    await expect(editor.locator(".method-menu")).toBeVisible();
    await editor.locator("input.url-input").click();
    await expect(editor.locator(".method-menu")).toHaveCount(0);

    const urlInput = editor.locator("input.url-input");
    await urlInput.fill("https://mock.local/editor-enter?via=keyboard");
    await urlInput.press("Enter");
    await expect(editor.locator(".response-status")).toContainText("200 OK", { timeout: 10_000 });
    await expect(editor.locator("pre.response-body")).toContainText('"path": "/editor-enter"');

    await reqTab("Params").click();
    const paramsEditor = editor.locator(".req-tab-content .kv-editor");
    const firstParam = paramsEditor.locator(".kv-row").first();
    await firstParam.locator(".kv-check").uncheck();
    await firstParam.locator(".kv-check").check();
    await firstParam.locator(".kv-key").fill("page");
    await firstParam.locator(".kv-value").fill("1");
    await paramsEditor.locator(".kv-add").click();
    await expect(paramsEditor.locator(".kv-row")).toHaveCount(2);
    const secondParam = paramsEditor.locator(".kv-row").nth(1);
    await secondParam.locator(".kv-key").fill("sort");
    await secondParam.locator(".kv-value").fill("desc");
    await secondParam.click({ button: "right" });
    await secondParam.dblclick();
    await secondParam.dragTo(paramsEditor.locator(".kv-header"));
    await secondParam.getByTitle("Remove").click();
    await expect(paramsEditor.locator(".kv-row")).toHaveCount(1);

    await reqTab("Headers").click();
    const headersEditor = editor.locator(".req-tab-content .kv-editor");
    await headersEditor.locator(".kv-row").first().locator(".kv-key").fill("Content-Type");
    await headersEditor.locator(".kv-row").first().locator(".kv-value").fill("application/json");
    await expect(editor.locator(".req-tabs button", { hasText: "Headers" }).locator(".badge")).toHaveText("1");

    await reqTab("Auth").click();
    await page.getByLabel("Auth type").selectOption("bearer");
    await page.getByLabel("Bearer token").fill("{{api_token}}");
    await page.getByLabel("Auth type").selectOption("basic");
    await page.getByLabel("Basic username").fill("kai");
    await page.getByLabel("Basic password").fill("secret");
    await page.getByLabel("Auth type").selectOption("apiKey");
    await page.getByLabel("API key name").fill("X-API-Key");
    await page.getByLabel("API key value").fill("{{api_token}}");
    await page.getByLabel("API key placement").selectOption("query");
    await page.getByLabel("Auth type").selectOption("none");
    await expect(editor.locator(".auth-none")).toBeVisible();

    await reqTab("Body").click();
    const bodyMode = (name: string) => editor.locator(".body-type-selector label", { hasText: name }).locator("input");
    await bodyMode("None").check();
    await expect(editor.locator(".body-none")).toBeVisible();
    await bodyMode("JSON").check();
    await editor.locator(".body-textarea").fill('{"mode":"json"}');
    await expect(editor.locator(".body-textarea")).toHaveValue('{"mode":"json"}');
    await bodyMode("Form").check();
    const formEditor = editor.locator(".body-editor .kv-editor");
    await expect(formEditor).toBeVisible();
    if (await formEditor.locator(".kv-row").count() === 0) {
      await formEditor.locator(".kv-add").click();
    }
    await expect(formEditor.locator(".kv-row")).toHaveCount(1);
    await formEditor.locator(".kv-row").first().locator(".kv-key").fill("formKey");
    await formEditor.locator(".kv-row").first().locator(".kv-value").fill("formValue");
    await formEditor.locator(".kv-add").click();
    await expect(formEditor.locator(".kv-row")).toHaveCount(2);
    await formEditor.locator(".kv-row").nth(1).getByTitle("Remove").click();
    await expect(formEditor.locator(".kv-row")).toHaveCount(1);
    await bodyMode("Raw").check();
    await editor.locator(".body-textarea").fill("raw body");
    await expect(editor.locator(".body-textarea")).toHaveValue("raw body");
    await editor.locator(".body-type-selector").click({ button: "right" });
    await editor.locator(".body-type-selector").dblclick();
    await editor.locator(".body-type-selector").dragTo(editor.locator(".req-tabs"));
    await expect(bodyMode("Raw")).toBeChecked();

    await reqTab("Scripts").click();
    await page.getByLabel("Pre-request script").fill("pm.variables.set('path', 'editor');");
    await page.getByLabel("Post-response script").fill("pm.test('ok', () => pm.expect(pm.response.code).to.equal(200));");
    await page.getByLabel("Pre-request script").click({ button: "right" });
    await page.getByLabel("Post-response script").dblclick();
    await expect(reqTab("Scripts")).toContainText("1");

    const requestSection = editor.locator(".req-section");
    const beforeFlexBasis = await requestSection.evaluate((node) => parseFloat(getComputedStyle(node).flexBasis));
    await dragBy(page, editor.locator(".resize-handle"), 0, 80);
    const afterFlexBasis = await requestSection.evaluate((node) => parseFloat(getComputedStyle(node).flexBasis));
    expect(Math.abs(afterFlexBasis - beforeFlexBasis)).toBeGreaterThan(5);

    await editor.getByTitle("Import cURL").click();
    await expect(page.getByRole("dialog", { name: "Import cURL" })).toBeVisible();
    await page.getByLabel("Close cURL import").click();
    await expect(page.getByRole("dialog", { name: "Import cURL" })).toHaveCount(0);
    await editor.getByTitle("Import cURL").click();
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByRole("dialog", { name: "Import cURL" })).toHaveCount(0);
    await editor.getByTitle("Import cURL").click();
    const curlOverlay = page.locator(".curl-modal-overlay");
    await expect(curlOverlay).toBeVisible();
    const curlOverlayBox = await curlOverlay.boundingBox();
    expect(curlOverlayBox).not.toBeNull();
    await curlOverlay.click({ position: { x: (curlOverlayBox?.width ?? 16) - 8, y: 8 } });
    await expect(page.getByRole("dialog", { name: "Import cURL" })).toHaveCount(0);

    await expect.poll(() => capture.infos.some((line) =>
      line.includes("[mock:tauriClient]") &&
      line.includes("invoke success") &&
      line.includes("update_request") &&
      line.includes("trace=far-api:update_request"),
    )).toBe(true);
    await expect.poll(() => capture.infos.some((line) =>
      line.includes("[mock:tauriClient]") &&
      line.includes("invoke success") &&
      line.includes("http_request") &&
      line.includes("trace=far-api:http_request"),
    )).toBe(true);

    expectNoErrors(capture);
  });
});
