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
    await expect(page.locator(".env-item.active", { hasText: "Production" })).toHaveCSS("user-select", "none");
    await expect(page.locator(".env-name", { hasText: "Production" })).toHaveCSS("user-select", "none");
    await expect(page.locator(".env-panel .panel-toolbar")).toHaveCSS("user-select", "none");

    await page.locator(".env-item", { hasText: "Production" }).getByTitle("Delete Environment").click();
    await expect(page.locator(".env-item", { hasText: "Production" })).toHaveCount(0);
    await expect.poll(() => capture.infos.some((line) =>
      line.includes("[tauriClient] invoke start") && line.includes("create_environment"),
    )).toBe(true);

    expectNoErrors(capture);
  });

  test("covers environment modal close, cancel, variable controls, and no-op row gestures", async ({ page }) => {
    const capture = await openMockApp(page);

    await openEnvironments(page);

    await page.getByTitle("New Environment").click();
    await expect(page.getByRole("dialog", { name: "New Environment" })).toBeVisible();
    await page.getByLabel("Close environment modal").click();
    await expect(page.getByRole("dialog", { name: "New Environment" })).toHaveCount(0);

    await page.getByTitle("New Environment").click();
    await expect(page.getByRole("dialog", { name: "New Environment" })).toBeVisible();
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByRole("dialog", { name: "New Environment" })).toHaveCount(0);

    await page.getByTitle("New Environment").click();
    await expect(page.getByRole("dialog", { name: "New Environment" })).toBeVisible();
    await page.locator(".env-modal-overlay").click({ position: { x: 4, y: 4 } });
    await expect(page.getByRole("dialog", { name: "New Environment" })).toHaveCount(0);

    await page.getByTitle("New Environment").click();
    await expect(page.getByRole("dialog", { name: "New Environment" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "New Environment" })).toHaveCount(0);

    await page.getByTitle("New Environment").click();
    await page.getByLabel("Environment name").fill("Gesture Env");
    await page.getByLabel("Variable key").first().fill("enabled_key");
    await page.getByLabel("Variable value").first().fill("enabled_value");
    await page.getByLabel("Enable enabled_key").uncheck();
    await expect(page.getByLabel("Enable enabled_key")).not.toBeChecked();
    await page.getByLabel("Enable enabled_key").check();
    await page.getByRole("button", { name: "Add Variable" }).click();
    await page.getByLabel("Variable key").last().fill("removed_key");
    await page.getByTitle("Remove Variable").last().click();
    await expect(page.getByLabel("Variable key")).toHaveCount(1);
    await page.getByRole("button", { name: "Save" }).click();

    const envRow = page.locator(".env-item", { hasText: "Gesture Env" });
    await expect(envRow).toBeVisible();
    await envRow.click({ button: "right" });
    await expect(envRow).toBeVisible();
    await envRow.dblclick();
    await expect(page.getByRole("dialog", { name: "Edit Environment" })).toHaveCount(0);
    await envRow.dragTo(page.locator(".env-panel .panel-toolbar"));
    await expect(envRow).toBeVisible();

    await envRow.getByTitle("Edit Environment").click();
    await expect(page.getByRole("dialog", { name: "Edit Environment" })).toBeVisible();
    await page.getByLabel("Environment name").click({ button: "right" });
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "Edit Environment" })).toHaveCount(0);

    await envRow.getByTitle("Delete Environment").click();
    await expect(envRow).toHaveCount(0);

    expectNoErrors(capture);
  });

  test("exports an environment as Postman JSON with copy, download, and close paths", async ({ page }) => {
    const capture = await openMockApp(page);
    await installClipboardProbe(page);

    await openEnvironments(page);
    await page.getByTitle("New Environment").click();
    await page.getByLabel("Environment name").fill("Production");
    await page.getByLabel("Variable key").first().fill("base_url");
    await page.getByLabel("Variable value").first().fill("https://api.example.com");
    await page.getByRole("button", { name: "Add Variable" }).click();
    await page.getByLabel("Variable key").last().fill("api_key");
    await page.getByLabel("Variable value").last().fill("secret");
    await page.getByLabel("Enable api_key").last().uncheck();
    await page.getByRole("button", { name: "Save" }).click();

    const envRow = page.locator(".env-item", { hasText: "Production" });
    await expect(envRow).toBeVisible();
    await envRow.hover();
    await envRow.getByTitle("Export Environment").click();
    await expect(page.getByRole("dialog", { name: "Export Production" })).toBeVisible();
    await expect(page.locator(".export-modal-file")).toHaveText("production.postman_environment.json");

    const exported = JSON.parse(await page.getByLabel("Export JSON content").inputValue());
    expect(exported.name).toBe("Production");
    expect(exported._postman_variable_scope).toBe("environment");
    expect(exported.values).toEqual([
      expect.objectContaining({ key: "base_url", value: "https://api.example.com", enabled: true }),
      expect.objectContaining({ key: "api_key", value: "secret", enabled: false }),
    ]);

    await page.getByRole("button", { name: "Copy" }).click();
    await expect(page.locator(".export-modal-status--copied")).toHaveText("Copied");
    await expect.poll(() => page.evaluate(() => (window as any).__farApiCopiedText ?? "")).toContain("_postman_variable_scope");

    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download" }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe("production.postman_environment.json");

    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "Export Production" })).toHaveCount(0);

    await envRow.hover();
    await envRow.getByTitle("Export Environment").click();
    await expect(page.getByRole("dialog", { name: "Export Production" })).toBeVisible();
    await page.locator(".export-modal-overlay").click({ position: { x: 4, y: 4 } });
    await expect(page.getByRole("dialog", { name: "Export Production" })).toHaveCount(0);

    await expect.poll(() => capture.infos.some((line) =>
      line.includes("[logger:apiSpecExporter]") && line.includes("environment export prepared"),
    )).toBe(true);
    expectNoErrors(capture);
  });
});
