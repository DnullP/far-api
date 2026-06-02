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

function collection(page: Page, name: string) {
  return page.locator(".collection-item", { has: page.locator(".collection-header", { hasText: name }) }).first();
}

async function importByJson(page: Page, json: unknown) {
  await page.getByTitle("Import Collection").click();
  await expect(page.getByRole("dialog", { name: "Import Collection" })).toBeVisible();
  await page.getByLabel("Import JSON content").fill(JSON.stringify(json));
  await expect(page.getByText(/requests$/)).toBeVisible();
  await page.getByRole("button", { name: "Import", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Import Collection" })).toHaveCount(0);
}

function openApiDocument() {
  return {
    openapi: "3.0.3",
    info: { title: "OpenAPI Demo" },
    servers: [{ url: "https://mock.local/api" }],
    paths: {
      "/users": {
        get: {
          summary: "List Users",
          parameters: [{ name: "limit", in: "query", schema: { type: "integer", default: 20 } }],
        },
        post: {
          summary: "Create User",
          requestBody: {
            content: {
              "application/json": {
                example: { name: "Kai" },
              },
            },
          },
        },
      },
    },
  };
}

function swaggerDocument() {
  return {
    swagger: "2.0",
    info: { title: "Swagger Demo" },
    schemes: ["https"],
    host: "mock.local",
    basePath: "/legacy",
    consumes: ["application/x-www-form-urlencoded"],
    paths: {
      "/login": {
        post: {
          summary: "Legacy Login",
          parameters: [
            { name: "username", in: "formData", type: "string", default: "kai" },
            { name: "X-Client", in: "header", type: "string", default: "far-api" },
          ],
        },
      },
    },
  };
}

function postmanDocument() {
  return {
    info: {
      name: "Postman Demo",
      schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
    },
    auth: {
      type: "bearer",
      bearer: [{ key: "token", value: "{{api_token}}" }],
    },
    item: [
      {
        name: "Postman Echo",
        request: {
          method: "POST",
          url: "https://mock.local/postman?debug=true",
          header: [{ key: "Content-Type", value: "application/json" }],
          body: {
            mode: "raw",
            raw: "{\"postman\":true}",
            options: { raw: { language: "json" } },
          },
        },
      },
    ],
  };
}

function hoppscotchDocument() {
  return {
    v: 1,
    name: "Hoppscotch Demo",
    auth: {
      authType: "bearer",
      authActive: true,
      token: "{{hoppscotch_token}}",
    },
    requests: [
      {
        v: "1",
        name: "Hoppscotch List",
        method: "GET",
        endpoint: "https://mock.local/hoppscotch?debug=true",
        params: [{ key: "limit", value: "10", active: true }],
      },
    ],
    folders: [
      {
        name: "Nested",
        requests: [
          {
            v: "1",
            name: "Hoppscotch Create",
            method: "POST",
            endpoint: "https://mock.local/hoppscotch",
            headers: [{ key: "Content-Type", value: "application/json", active: true }],
            body: {
              contentType: "application/json",
              body: "{\"from\":\"hoppscotch\"}",
            },
          },
        ],
      },
    ],
  };
}

test.describe("API spec import workflows", () => {
  test("imports OpenAPI, Swagger, Postman, and Hoppscotch JSON from the modal", async ({ page }) => {
    const capture = await openMockApp(page);

    await importByJson(page, openApiDocument());
    await expect(collection(page, "OpenAPI Demo").locator(".request-item", { hasText: "List Users" })).toBeVisible();
    await expect(collection(page, "OpenAPI Demo").locator(".request-item", { hasText: "Create User" })).toBeVisible();

    await importByJson(page, swaggerDocument());
    await expect(collection(page, "Swagger Demo").locator(".request-item", { hasText: "Legacy Login" })).toBeVisible();

    await importByJson(page, postmanDocument());
    await expect(collection(page, "Postman Demo").locator(".request-item", { hasText: "Postman Echo" })).toBeVisible();

    await importByJson(page, hoppscotchDocument());
    await expect(collection(page, "Hoppscotch Demo").locator(".request-item", { hasText: "Hoppscotch List" })).toBeVisible();
    await expect(collection(page, "Hoppscotch Demo").locator(".folder-item", { hasText: "Nested" })).toBeVisible();
    await expect(collection(page, "Hoppscotch Demo").locator(".request-item", { hasText: "Hoppscotch Create" })).toBeVisible();

    await collection(page, "Postman Demo").locator(".request-item", { hasText: "Postman Echo" }).click();
    await expect(page.locator(".layout-v2-tab-section__card[data-layout-presentation-state='committed'] input.url-input")).toHaveValue("https://mock.local/postman");

    await collection(page, "Hoppscotch Demo").locator(".request-item", { hasText: "Hoppscotch Create" }).click();
    await expect(page.locator(".layout-v2-tab-section__card[data-layout-presentation-state='committed'] input.url-input")).toHaveValue("https://mock.local/hoppscotch");

    await expect.poll(() => capture.infos.some((line) =>
      line.includes("[tauriClient] invoke start") && line.includes("create_collection"),
    )).toBe(true);
    await expect.poll(() => capture.infos.some((line) =>
      line.includes("[mock:tauriClient]") &&
      line.includes("invoke success") &&
      line.includes("create_folder") &&
      line.includes("trace=far-api:create_folder"),
    )).toBe(true);
    await expect.poll(() => capture.infos.some((line) =>
      line.includes("[mock:tauriClient]") &&
      line.includes("invoke success") &&
      line.includes("create_request") &&
      line.includes("trace=far-api:create_request"),
    )).toBe(true);
    await expect.poll(() => capture.infos.some((line) =>
      line.includes("[mock:tauriClient]") &&
      line.includes("invoke success") &&
      line.includes("update_request") &&
      line.includes("trace=far-api:update_request"),
    )).toBe(true);

    expectNoErrors(capture);
  });

  test("imports from a JSON file and shows validation errors", async ({ page }) => {
    const capture = await openMockApp(page);

    await page.getByTitle("Import Collection").click();
    await page.getByLabel("Import JSON content").fill("{");
    await expect(page.getByText("Import content must be valid JSON.")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "Import Collection" })).toHaveCount(0);

    await page.getByTitle("Import Collection").click();
    await page.getByLabel("Import JSON file").setInputFiles({
      name: "hoppscotch-demo.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(hoppscotchDocument())),
    });
    await expect(page.locator(".collection-import-summary", { hasText: "Hoppscotch Demo" })).toBeVisible();
    await expect(page.locator(".collection-import-summary", { hasText: "hoppscotch" })).toBeVisible();
    await page.getByRole("button", { name: "Import", exact: true }).click();
    await expect(collection(page, "Hoppscotch Demo").locator(".folder-item", { hasText: "Nested" })).toBeVisible();
    await expect(collection(page, "Hoppscotch Demo").locator(".request-item", { hasText: "Hoppscotch Create" })).toBeVisible();

    expectNoErrors(capture);
  });
});
