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

function collection(page: Page, name: string): Locator {
  return page.locator(".collection-item", { has: page.locator(".collection-header", { hasText: name }) }).first();
}

function collectionHeader(page: Page, name: string): Locator {
  return collection(page, name).locator(".collection-header").first();
}

function requestItem(page: Page, name: string): Locator {
  return page.locator(".request-item", { hasText: name }).first();
}

function folderItem(page: Page, name: string): Locator {
  return page.locator(".folder-item", { hasText: name }).first();
}

function requestNamesInCollection(page: Page, collectionName: string): Locator {
  return collection(page, collectionName).locator(".request-name");
}

function requestNamesInFolder(page: Page, folderName: string): Locator {
  return folderItem(page, folderName).locator("..").locator(".request-name");
}

async function createCollection(page: Page, expectedName = "New Collection") {
  await page.getByTitle("New Collection").click();
  await expect(collectionHeader(page, expectedName)).toBeVisible();
}

async function createRequestWithModal(page: Page, requestName: string, collectionName = "My Collection") {
  await page.getByTitle("New Request").click();
  await expect(page.getByLabel("Request name")).toBeVisible();
  await page.getByLabel("Request name").fill(requestName);
  await page.getByLabel("Request location").selectOption({ label: collectionName });
  await page.getByRole("button", { name: "Create Request" }).click();
  await expect(collection(page, collectionName).locator(".request-item", { hasText: requestName })).toBeVisible();
}

function expectNoErrors(capture: ConsoleCapture) {
  expect(capture.errors).toEqual([]);
}

async function pressLocatorCenter(page: Page, locator: Locator) {
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  if (!box) {
    return;
  }

  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.up();
}

async function pressLocatorBlankBottom(page: Page, locator: Locator) {
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  if (!box) {
    return;
  }

  await page.mouse.move(box.x + box.width / 2, box.y + box.height - 8);
  await page.mouse.down();
  await page.mouse.up();
}

async function installWindowDragProbe(page: Page) {
  await page.evaluate(() => {
    (window as any).__farWindowDragCalls = [];
    (window as any).__FAR_API_WINDOW_DRAG__ = {
      startDragging(source: string, traceId: string) {
        (window as any).__farWindowDragCalls.push({ source, traceId });
      },
    };
  });
}

async function resetWindowDragProbe(page: Page) {
  await page.evaluate(() => {
    (window as any).__farWindowDragCalls = [];
  });
}

async function installClipboardProbe(page: Page) {
  await page.evaluate(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (value: string) => {
          (window as any).__farApiCopiedText = value;
        },
      },
    });
  });
}

async function expectWindowDragSources(page: Page, expectedSources: string[]) {
  await expect.poll(async () => page.evaluate(() =>
    ((window as any).__farWindowDragCalls ?? []).map((call: { source: string }) => call.source),
  )).toEqual(expectedSources);
}

test.describe("Collections user workflows", () => {
  test("creates collections and requests, collapses and expands a collection", async ({ page }) => {
    const capture = await openMockApp(page);

    await createCollection(page);

    await collectionHeader(page, "New Collection").hover();
    await collection(page, "New Collection").getByTitle("Add Request").click();
    await expect(page.getByLabel("Request name")).toBeVisible();
    await page.getByRole("button", { name: "Create Request" }).click();
    await expect(collection(page, "New Collection").locator(".request-item", { hasText: "New Request" })).toBeVisible();

    await collectionHeader(page, "New Collection").click();
    await expect(collection(page, "New Collection").locator(".request-item", { hasText: "New Request" })).toHaveCount(0);

    await collectionHeader(page, "New Collection").click();
    await expect(collection(page, "New Collection").locator(".request-item", { hasText: "New Request" })).toBeVisible();

    await expect.poll(() => capture.infos.some((line) =>
      line.includes("[tauriClient] invoke start") && line.includes("create_collection"),
    )).toBe(true);
    await expect.poll(() => capture.infos.some((line) =>
      line.includes("[mock:tauriClient]") &&
      line.includes("invoke success") &&
      line.includes("create_collection"),
    )).toBe(true);
    await expect.poll(() => capture.infos.some((line) =>
      line.includes("[mock:tauriClient]") &&
      line.includes("trace=far-api:create_collection") &&
      line.includes("command=create_collection"),
    )).toBe(true);
    expectNoErrors(capture);
  });

  test("uses the toolbar plus to create a request in a selected collection", async ({ page }) => {
    const capture = await openMockApp(page);

    await createCollection(page);
    await createRequestWithModal(page, "Toolbar Request", "New Collection");

    await expect(collection(page, "New Collection").locator(".request-item", { hasText: "Toolbar Request" })).toBeVisible();
    await expect(collection(page, "My Collection").locator(".request-item", { hasText: "Toolbar Request" })).toHaveCount(0);
    await expect.poll(() => capture.infos.some((line) =>
      line.includes("[tauriClient] invoke start") && line.includes("create_request"),
    )).toBe(true);

    expectNoErrors(capture);
  });

  test("covers collection modal close/cancel/overlay paths and context menu dismissal", async ({ page }) => {
    const capture = await openMockApp(page);

    await page.getByTitle("New Request").click();
    await expect(page.getByRole("dialog", { name: "New Request" })).toBeVisible();
    await page.getByLabel("Close request modal").click();
    await expect(page.getByRole("dialog", { name: "New Request" })).toHaveCount(0);

    await page.getByTitle("New Request").click();
    await expect(page.getByRole("dialog", { name: "New Request" })).toBeVisible();
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByRole("dialog", { name: "New Request" })).toHaveCount(0);

    await page.getByTitle("New Request").click();
    await expect(page.getByRole("dialog", { name: "New Request" })).toBeVisible();
    await page.locator(".collection-modal-overlay").click({ position: { x: 4, y: 4 } });
    await expect(page.getByRole("dialog", { name: "New Request" })).toHaveCount(0);

    await page.getByTitle("New Folder").click();
    await expect(page.getByRole("dialog", { name: "New Folder" })).toBeVisible();
    await page.getByLabel("Close folder modal").click();
    await expect(page.getByRole("dialog", { name: "New Folder" })).toHaveCount(0);

    await page.getByTitle("New Folder").click();
    await expect(page.getByRole("dialog", { name: "New Folder" })).toBeVisible();
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByRole("dialog", { name: "New Folder" })).toHaveCount(0);

    await page.getByTitle("New Folder").click();
    await expect(page.getByRole("dialog", { name: "New Folder" })).toBeVisible();
    await page.locator(".collection-modal-overlay").click({ position: { x: 4, y: 4 } });
    await expect(page.getByRole("dialog", { name: "New Folder" })).toHaveCount(0);

    await page.getByTitle("Import Collection").click();
    await expect(page.getByRole("dialog", { name: "Import Collection" })).toBeVisible();
    await page.getByLabel("Close import modal").click();
    await expect(page.getByRole("dialog", { name: "Import Collection" })).toHaveCount(0);

    await page.getByTitle("Import Collection").click();
    await expect(page.getByRole("dialog", { name: "Import Collection" })).toBeVisible();
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByRole("dialog", { name: "Import Collection" })).toHaveCount(0);

    await collectionHeader(page, "My Collection").click({ button: "right" });
    await expect(page.locator(".context-menu")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator(".context-menu")).toHaveCount(0);

    await requestItem(page, "Example Request").click({ button: "right" });
    await expect(page.locator(".context-menu")).toBeVisible();
    await page.mouse.click(1, 1);
    await expect(page.locator(".context-menu")).toHaveCount(0);

    expectNoErrors(capture);
  });

  test("uses double click rename for collections and requests", async ({ page }) => {
    const capture = await openMockApp(page);

    await collectionHeader(page, "My Collection").dblclick();
    await page.getByLabel("Rename collection").fill("Renamed Collection");
    await page.keyboard.press("Enter");
    await expect(collectionHeader(page, "Renamed Collection")).toBeVisible();

    await requestItem(page, "Example Request").dblclick();
    await page.getByLabel("Rename request").fill("Renamed Request");
    await page.keyboard.press("Enter");
    await expect(requestItem(page, "Renamed Request")).toBeVisible();

    expectNoErrors(capture);
  });

  test("supports rename cancel and blur commit paths", async ({ page }) => {
    const capture = await openMockApp(page);

    await collectionHeader(page, "My Collection").dblclick();
    await page.getByLabel("Rename collection").fill("Cancelled Collection");
    await page.keyboard.press("Escape");
    await expect(collectionHeader(page, "My Collection")).toBeVisible();
    await expect(collectionHeader(page, "Cancelled Collection")).toHaveCount(0);

    await requestItem(page, "Example Request").dblclick();
    await page.getByLabel("Rename request").fill("Blurred Request");
    await createCollection(page);
    await expect(requestItem(page, "Blurred Request")).toBeVisible();

    expectNoErrors(capture);
  });

  test("uses context menu rename and delete for collections and requests", async ({ page }) => {
    const capture = await openMockApp(page);

    await createCollection(page);
    await collectionHeader(page, "New Collection").click({ button: "right" });
    await page.getByRole("button", { name: "Rename" }).click();
    await page.getByLabel("Rename collection").fill("Context Collection");
    await page.keyboard.press("Enter");
    await expect(collectionHeader(page, "Context Collection")).toBeVisible();

    await requestItem(page, "Example Request").click({ button: "right" });
    await page.getByRole("button", { name: "Rename" }).click();
    await page.getByLabel("Rename request").fill("Context Request");
    await page.keyboard.press("Enter");
    await expect(requestItem(page, "Context Request")).toBeVisible();

    await requestItem(page, "Context Request").click({ button: "right" });
    await page.getByRole("button", { name: "Delete" }).click();
    await expect(requestItem(page, "Context Request")).toHaveCount(0);

    await collectionHeader(page, "Context Collection").click({ button: "right" });
    await page.getByRole("button", { name: "Delete" }).click();
    await expect(collectionHeader(page, "Context Collection")).toHaveCount(0);

    expectNoErrors(capture);
  });

  test("moves requests and collections with drag and drop", async ({ page }) => {
    const capture = await openMockApp(page);

    await createCollection(page);

    await collectionHeader(page, "New Collection").hover();
    await collection(page, "New Collection").getByTitle("Add Request").click();
    await expect(page.getByLabel("Request name")).toBeVisible();
    await page.getByRole("button", { name: "Create Request" }).click();
    await expect(collection(page, "New Collection").locator(".request-item", { hasText: "New Request" })).toBeVisible();

    await requestItem(page, "Example Request").dragTo(
      collection(page, "New Collection").locator(".request-item", { hasText: "New Request" }),
    );
    await expect(requestNamesInCollection(page, "New Collection")).toHaveText([
      "Example Request",
      "New Request",
    ]);
    await expect(collection(page, "My Collection").locator(".request-item", { hasText: "Example Request" })).toHaveCount(0);

    await collection(page, "New Collection")
      .locator(".request-item", { hasText: "New Request" })
      .dragTo(collection(page, "New Collection").locator(".request-item", { hasText: "Example Request" }));
    await expect(requestNamesInCollection(page, "New Collection")).toHaveText([
      "New Request",
      "Example Request",
    ]);

    await requestItem(page, "Example Request").dragTo(collectionHeader(page, "New Collection"));
    await expect(collection(page, "New Collection").locator(".request-item", { hasText: "Example Request" })).toBeVisible();
    await expect(requestNamesInCollection(page, "New Collection")).toHaveText([
      "New Request",
      "Example Request",
    ]);

    await collectionHeader(page, "New Collection").dragTo(collectionHeader(page, "My Collection"));
    await expect(page.locator(".collection-header").first()).toContainText("New Collection");

    expectNoErrors(capture);
  });

  test("uses folders for create, rename, collapse, drag move, and delete", async ({ page }) => {
    const capture = await openMockApp(page);

    await page.getByTitle("New Folder").click();
    await expect(page.getByRole("dialog", { name: "New Folder" })).toBeVisible();
    await page.getByRole("button", { name: "Create Folder" }).click();
    await expect(folderItem(page, "New Folder")).toBeVisible();

    await folderItem(page, "New Folder").dblclick();
    await page.getByLabel("Rename folder").fill("Admin");
    await page.keyboard.press("Enter");
    await expect(folderItem(page, "Admin")).toBeVisible();

    await page.getByTitle("New Request").click();
    await page.getByLabel("Request name").fill("Folder Request");
    await page.getByLabel("Request location").selectOption({ label: "Admin" });
    await page.getByRole("button", { name: "Create Request" }).click();
    await expect(folderItem(page, "Admin").locator("..").locator(".request-item", { hasText: "Folder Request" })).toBeVisible();

    await folderItem(page, "Admin").click();
    await expect(folderItem(page, "Admin").locator("..").locator(".request-item", { hasText: "Folder Request" })).toHaveCount(0);
    await folderItem(page, "Admin").click();
    await expect(folderItem(page, "Admin").locator("..").locator(".request-item", { hasText: "Folder Request" })).toBeVisible();

    await requestItem(page, "Example Request").dragTo(folderItem(page, "Admin"));
    await expect(requestNamesInFolder(page, "Admin")).toHaveText([
      "Folder Request",
      "Example Request",
    ]);
    await expect(collection(page, "My Collection").locator("> .collection-children > .request-item", { hasText: "Example Request" })).toHaveCount(0);

    await requestItem(page, "Example Request").dragTo(collectionHeader(page, "My Collection"));
    await expect(collection(page, "My Collection").locator("> .collection-children > .request-item", { hasText: "Example Request" })).toBeVisible();

    await folderItem(page, "Admin").click({ button: "right" });
    await page.locator(".context-menu").getByRole("button", { name: "New Folder" }).click();
    await expect(folderItem(page, "New Folder")).toBeVisible();

    await folderItem(page, "New Folder").click({ button: "right" });
    await page.getByRole("button", { name: "Delete" }).click();
    await expect(folderItem(page, "New Folder")).toHaveCount(0);

    await folderItem(page, "Admin").click({ button: "right" });
    await page.getByRole("button", { name: "Delete" }).click();
    await expect(folderItem(page, "Admin")).toHaveCount(0);
    await expect(requestItem(page, "Folder Request")).toHaveCount(0);

    await expect.poll(() => capture.infos.some((line) =>
      line.includes("[tauriClient] invoke start") && line.includes("create_folder"),
    )).toBe(true);
    await expect.poll(() => capture.infos.some((line) =>
      line.includes("[mock:tauriClient]") &&
      line.includes("trace=far-api:create_folder") &&
      line.includes("command=create_folder"),
    )).toBe(true);

    expectNoErrors(capture);
  });

  test("does not expose selectable text cursors on collection rows", async ({ page }) => {
    const capture = await openMockApp(page);

    await page.getByTitle("New Folder").click();
    await page.getByRole("button", { name: "Create Folder" }).click();
    await expect(folderItem(page, "New Folder")).toBeVisible();

    await expect(collectionHeader(page, "My Collection")).toHaveCSS("user-select", "none");
    await expect(folderItem(page, "New Folder")).toHaveCSS("user-select", "none");
    await expect(requestItem(page, "Example Request")).toHaveCSS("user-select", "none");
    await expect(page.locator(".welcome-title")).toHaveCSS("user-select", "none");
    await expect(page.locator(".feature-card").first()).toHaveCSS("user-select", "none");
    await expect(page.locator(".layout-v2-tab-section__tab").first()).toHaveCSS("user-select", "none");
    await expect(page.locator(".panel-toolbar").first()).toHaveCSS("user-select", "none");
    await expect(collectionHeader(page, "My Collection")).toHaveCSS("cursor", "pointer");
    await expect(folderItem(page, "New Folder")).toHaveCSS("cursor", "pointer");
    await expect(requestItem(page, "Example Request")).toHaveCSS("cursor", "pointer");
    await expect(collectionHeader(page, "My Collection").locator(".collection-name")).toHaveCSS("cursor", "pointer");
    await expect(folderItem(page, "New Folder").locator(".folder-name")).toHaveCSS("cursor", "pointer");
    await expect(requestItem(page, "Example Request").locator(".request-name")).toHaveCSS("cursor", "pointer");

    expectNoErrors(capture);
  });

  test("creates folders in selected locations and moves folders with drag and drop", async ({ page }) => {
    const capture = await openMockApp(page);

    await createCollection(page);

    await page.getByTitle("New Folder").click();
    await expect(page.getByRole("dialog", { name: "New Folder" })).toBeVisible();
    await page.getByLabel("Folder name").fill("Team Folder");
    await page.getByLabel("Folder location").selectOption({ label: "New Collection" });
    await page.getByRole("button", { name: "Create Folder" }).click();
    await expect(collection(page, "New Collection").locator(".folder-item", { hasText: "Team Folder" })).toBeVisible();
    await expect(collection(page, "My Collection").locator(".folder-item", { hasText: "Team Folder" })).toHaveCount(0);

    await page.getByTitle("New Folder").click();
    await page.getByLabel("Folder name").fill("Root Folder");
    await page.getByLabel("Folder location").selectOption({ label: "My Collection" });
    await page.getByRole("button", { name: "Create Folder" }).click();
    await expect(collection(page, "My Collection").locator(".folder-item", { hasText: "Root Folder" })).toBeVisible();

    await folderItem(page, "Team Folder").dragTo(collectionHeader(page, "My Collection"));
    await expect(collection(page, "My Collection").locator(".folder-item", { hasText: "Team Folder" })).toBeVisible();
    await expect(collection(page, "New Collection").locator(".folder-item", { hasText: "Team Folder" })).toHaveCount(0);

    await folderItem(page, "Team Folder").dragTo(folderItem(page, "Root Folder"));
    await expect(folderItem(page, "Root Folder").locator("..").locator(".folder-item", { hasText: "Team Folder" })).toBeVisible();

    await folderItem(page, "Team Folder").dragTo(requestItem(page, "Example Request"));
    await expect(collection(page, "My Collection").locator("> .collection-children > .folder-node").first().locator(".folder-item", { hasText: "Team Folder" })).toBeVisible();

    await expect.poll(() => capture.infos.some((line) =>
      line.includes("[tauriClient] invoke start") && line.includes("move_folder"),
    )).toBe(true);
    await expect.poll(() => capture.infos.some((line) =>
      line.includes("[mock:tauriClient]") &&
      line.includes("trace=far-api:move_folder") &&
      line.includes("command=move_folder"),
    )).toBe(true);

    expectNoErrors(capture);
  });

  test("exports a collection as Postman v2.1 JSON", async ({ page }) => {
    const capture = await openMockApp(page);
    await installClipboardProbe(page);

    await page.getByTitle("New Folder").click();
    await page.getByLabel("Folder name").fill("Export Folder");
    await page.getByRole("button", { name: "Create Folder" }).click();
    await expect(folderItem(page, "Export Folder")).toBeVisible();

    await page.getByTitle("New Request").click();
    await page.getByLabel("Request name").fill("Exported Request");
    await page.getByLabel("Request location").selectOption({ label: "Export Folder" });
    await page.getByRole("button", { name: "Create Request" }).click();
    await expect(folderItem(page, "Export Folder").locator("..").locator(".request-item", { hasText: "Exported Request" })).toBeVisible();

    await requestItem(page, "Exported Request").click();
    const editor = page.locator(".layout-v2-tab-section__card[data-layout-presentation-state='committed'] .request-editor").first();
    await expect(editor).toBeVisible();
    await editor.locator(".method-trigger").click();
    await page.locator(".method-option", { hasText: "POST" }).click();
    await editor.locator(".url-input").fill("https://mock.local/export");
    await editor.getByRole("button", { name: "Params" }).click();
    await editor.locator(".kv-add").click();
    await editor.locator(".kv-row").last().locator(".kv-key").fill("debug");
    await editor.locator(".kv-row").last().locator(".kv-value").fill("true");
    await editor.getByRole("button", { name: "Headers" }).click();
    await editor.locator(".kv-add").click();
    await editor.locator(".kv-row").last().locator(".kv-key").fill("Content-Type");
    await editor.locator(".kv-row").last().locator(".kv-value").fill("application/json");
    await editor.getByRole("button", { name: "Body" }).click();
    await editor.locator(".body-type-selector label", { hasText: "JSON" }).click();
    await editor.locator(".body-textarea").fill("{\"hello\":\"export\"}");
    await editor.getByRole("button", { name: "Auth" }).click();
    await editor.getByLabel("Auth type").selectOption("bearer");
    await editor.getByLabel("Bearer token").fill("{{api_token}}");
    await editor.getByRole("button", { name: "Scripts" }).click();
    await editor.getByLabel("Pre-request script").fill("pm.environment.set('trace_id', 'abc');");
    await editor.getByLabel("Post-response script").fill("pm.test('status ok', () => pm.response.to.have.status(200));");
    await expect.poll(() => capture.infos.some((line) =>
      line.includes("[tauriClient] invoke start") && line.includes("update_request"),
    )).toBe(true);

    await collectionHeader(page, "My Collection").click({ button: "right" });
    await page.locator(".context-menu").getByRole("button", { name: "Export" }).click();
    await expect(page.getByRole("dialog", { name: "Export My Collection" })).toBeVisible();
    await expect(page.locator(".export-modal-file")).toHaveText("my-collection.postman_collection.json");

    const exported = JSON.parse(await page.getByLabel("Export JSON content").inputValue());
    expect(exported.info.schema).toBe("https://schema.getpostman.com/json/collection/v2.1.0/collection.json");
    expect(exported.info.name).toBe("My Collection");
    const folder = exported.item.find((item: { name: string }) => item.name === "Export Folder");
    expect(folder.item[0].name).toBe("Exported Request");
    expect(folder.item[0].request.method).toBe("POST");
    expect(folder.item[0].request.url.raw).toBe("https://mock.local/export?debug=true");
    expect(folder.item[0].request.auth.type).toBe("bearer");
    expect(folder.item[0].request.body.raw).toBe("{\"hello\":\"export\"}");
    expect(folder.item[0].event.map((event: { listen: string }) => event.listen)).toEqual(["prerequest", "test"]);

    await page.getByRole("button", { name: "Copy" }).click();
    await expect(page.locator(".export-modal-status--copied")).toHaveText("Copied");
    await expect.poll(() => page.evaluate(() => (window as any).__farApiCopiedText ?? "")).toContain("collection/v2.1.0");
    await page.getByLabel("Close export modal").click();
    await expect(page.getByRole("dialog", { name: "Export My Collection" })).toHaveCount(0);

    await expect.poll(() => capture.infos.some((line) =>
      line.includes("[logger:apiSpecExporter]") && line.includes("collection export prepared"),
    )).toBe(true);
    expectNoErrors(capture);
  });

  test("uses iconbar and sidebar blank space as native window drag regions", async ({ page }) => {
    const capture = await openMockApp(page);
    await installWindowDragProbe(page);

    const activityBar = page.locator(".layout-v2-activity-bar").first();
    const activityBlank = page.locator(".layout-v2-activity-bar__tail-drop-target").first();
    const activityIcon = activityBar.locator("[data-layout-role='activity-icon']").first();
    const sidebarContent = page.locator(".layout-v2-panel-section__content").first();
    const sidebarPaneBody = page.locator(".layout-v2-panel-section__pane-body").first();
    const collectionsPanel = page.locator(".collections-panel").first();
    const collectionsTree = page.locator(".collections-tree").first();
    const toolbarButton = page.getByTitle("New Request");
    const collectionRow = collectionHeader(page, "My Collection");
    const requestRow = requestItem(page, "Example Request");

    await expect(activityBar).toHaveAttribute("data-tauri-drag-region", /^(true)?$/);
    await expect(sidebarContent).toHaveCSS("-webkit-app-region", "drag");
    await expect(sidebarPaneBody).toHaveCSS("-webkit-app-region", "drag");
    await expect(collectionsPanel).toHaveCSS("-webkit-app-region", "drag");
    await expect(collectionsTree).toHaveCSS("-webkit-app-region", "drag");
    await expect(activityIcon).toHaveCSS("-webkit-app-region", "no-drag");
    await expect(toolbarButton).toHaveCSS("-webkit-app-region", "no-drag");
    await expect(collectionRow).toHaveCSS("-webkit-app-region", "no-drag");
    await expect(requestRow).toHaveCSS("-webkit-app-region", "no-drag");

    await pressLocatorCenter(page, activityBlank);
    await expectWindowDragSources(page, ["activity-bar"]);
    await expect.poll(() => capture.infos.some((line) =>
      line.includes("[mock:window] start_dragging"),
    )).toBe(true);
    await expect.poll(() => capture.infos.some((line) =>
      line.includes("[windowDrag] start") && line.includes("activity-bar"),
    )).toBe(true);

    await pressLocatorBlankBottom(page, collectionsTree);
    await expectWindowDragSources(page, ["activity-bar", "sidebar"]);
    await expect.poll(() => capture.infos.some((line) =>
      line.includes("[windowDrag] start") && line.includes("sidebar"),
    )).toBe(true);

    await resetWindowDragProbe(page);
    await pressLocatorCenter(page, activityIcon);
    await pressLocatorCenter(page, requestRow);
    await pressLocatorCenter(page, collectionRow);
    await expectWindowDragSources(page, []);

    await pressLocatorCenter(page, toolbarButton);
    await expectWindowDragSources(page, []);
    await expect(page.getByRole("dialog", { name: "New Request" })).toBeVisible();
    await page.getByRole("button", { name: "Cancel" }).click();

    expectNoErrors(capture);
  });

  test("forwards global console warnings to the backend log bridge", async ({ page }) => {
    const capture = await openMockApp(page);

    await page.evaluate(() => {
      console.warn("playwright bridge probe %s", "warning", { requestId: "req-1" });
    });

    await expect.poll(() => capture.warnings.some((line) =>
      line.includes("[mock:console]") &&
      line.includes("playwright bridge probe warning") &&
      line.includes("{\"requestId\":\"req-1\"}") &&
      line.includes("href=") &&
      line.includes("ts="),
    )).toBe(true);

    expectNoErrors(capture);
  });
});
