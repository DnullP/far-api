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

function requestNamesInCollection(page: Page, collectionName: string): Locator {
  return collection(page, collectionName).locator(".request-name");
}

async function createCollection(page: Page, expectedName = "New Collection") {
  await page.getByTitle("New Collection").click();
  await expect(collectionHeader(page, expectedName)).toBeVisible();
}

async function createRequestWithModal(page: Page, requestName: string, collectionName = "My Collection") {
  await page.getByTitle("New Request").click();
  await expect(page.getByLabel("Request name")).toBeVisible();
  await page.getByLabel("Request name").fill(requestName);
  await page.getByLabel("Request collection").selectOption({ label: collectionName });
  await page.getByRole("button", { name: "Create Request" }).click();
  await expect(collection(page, collectionName).locator(".request-item", { hasText: requestName })).toBeVisible();
}

function expectNoErrors(capture: ConsoleCapture) {
  expect(capture.errors).toEqual([]);
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

  test("does not expose selectable text cursors on collection rows", async ({ page }) => {
    const capture = await openMockApp(page);

    await expect(collectionHeader(page, "My Collection")).toHaveCSS("user-select", "none");
    await expect(requestItem(page, "Example Request")).toHaveCSS("user-select", "none");
    await expect(collectionHeader(page, "My Collection")).toHaveCSS("cursor", "pointer");
    await expect(requestItem(page, "Example Request")).toHaveCSS("cursor", "pointer");
    await expect(collectionHeader(page, "My Collection").locator(".collection-name")).toHaveCSS("cursor", "pointer");
    await expect(requestItem(page, "Example Request").locator(".request-name")).toHaveCSS("cursor", "pointer");

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
