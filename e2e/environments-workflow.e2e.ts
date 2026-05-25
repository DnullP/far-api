import { expect, type Page, test } from "@playwright/test";

const MOCK_PAGE = "/web-mock/mock-tauri-test.html";

interface ConsoleCapture {
  errors: string[];
  infos: string[];
}

async function openMockApp(page: Page): Promise<ConsoleCapture> {
  const capture: ConsoleCapture = { errors: [], infos: [] };
  page.on("console", (msg) => {
    if (msg.type() === "error") {
      capture.errors.push(msg.text());
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

async function openEnvironments(page: Page) {
  await page.getByRole("button", { name: "Environments" }).click();
  await expect(page.locator(".env-panel")).toBeVisible();
}

function expectNoErrors(capture: ConsoleCapture) {
  expect(capture.errors).toEqual([]);
}

test.describe("Environment user workflows", () => {
  test("creates, edits, activates, and deletes environments through the list and overlay modal", async ({ page }) => {
    const capture = await openMockApp(page);

    await openEnvironments(page);
    await page.getByTitle("New Environment").click();
    await expect(page.getByLabel("Environment name")).toBeVisible();
    await page.getByLabel("Environment name").fill("Staging");
    await page.getByLabel("Variable key").first().fill("base_url");
    await page.getByLabel("Variable value").first().fill("https://staging.example.com");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.locator(".env-item", { hasText: "Staging" })).toBeVisible();

    await page.locator(".env-item", { hasText: "Staging" }).getByTitle("Edit Environment").click();
    await expect(page.getByLabel("Environment name")).toHaveValue("Staging");
    await page.getByLabel("Environment name").fill("Production");
    await page.getByRole("button", { name: "Add Variable" }).click();
    await page.getByLabel("Variable key").last().fill("api_key");
    await page.getByLabel("Variable value").last().fill("secret");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.locator(".env-item", { hasText: "Production" })).toBeVisible();
    await expect(page.locator(".env-item", { hasText: "Staging" })).toHaveCount(0);

    await page.locator(".env-item", { hasText: "Production" }).getByTitle("Activate Environment").click();
    await expect(page.locator(".env-item.active", { hasText: "Production" })).toBeVisible();

    await page.locator(".env-item", { hasText: "Production" }).getByTitle("Delete Environment").click();
    await expect(page.locator(".env-item", { hasText: "Production" })).toHaveCount(0);
    await expect.poll(() => capture.infos.some((line) =>
      line.includes("[tauriClient] invoke start") && line.includes("create_environment"),
    )).toBe(true);

    expectNoErrors(capture);
  });
});
