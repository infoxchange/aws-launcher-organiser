/**
 * Integration test for the auto-update settings UI
 *
 * Usage:
 *   AUTO_UPDATE_URL=https://... AUTO_UPDATE_TOKEN=xxx npm run test:integration:auto-update
 *
 * Required env vars:
 *   AUTO_UPDATE_URL   - The config URL to enter in the settings dialog
 *
 * Optional env vars:
 *   AUTO_UPDATE_TOKEN - Bearer token for the config URL
 */

import path from "node:path";
import { type BrowserContext, type ConsoleMessage, chromium } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { isLoginPage, waitForLoginCompletion } from "../support/test-browser";
import { loadConfig, type TestConfig } from "../support/test-config";
import { loadCookies, saveCookies } from "../support/test-cookies";

const AUTO_UPDATE_URL = process.env.AUTO_UPDATE_URL;
const AUTO_UPDATE_TOKEN = process.env.AUTO_UPDATE_TOKEN ?? "";

if (!AUTO_UPDATE_URL) {
  throw new Error(
    "\n❌ AUTO_UPDATE_URL environment variable is required.\n\n" +
      "Usage:\n" +
      "  AUTO_UPDATE_URL=https://example.com/config.json npm run test:integration:auto-update\n" +
      "  AUTO_UPDATE_URL=https://... AUTO_UPDATE_TOKEN=xxx npm run test:integration:auto-update\n"
  );
}

describe("Auto-update settings - connection test", () => {
  let context: BrowserContext;
  let config: TestConfig;

  beforeAll(async () => {
    const loaded = loadConfig();
    if (!loaded?.ssoUrl) {
      throw new Error(
        "\n❌ Integration test configuration not found!\n\n" +
          "Please run the setup script first:\n" +
          "  npm run test:integration:setup\n"
      );
    }
    config = loaded;

    const extensionPath = path.join(process.cwd(), ".output", "chrome-mv3");

    context = await chromium.launchPersistentContext("", {
      headless: false,
      slowMo: 100,
      args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
    });

    await loadCookies(context);
  });

  afterAll(async () => {
    await saveCookies(context);
    await context.close();
  });

  it("should successfully connect to the auto-update URL", async () => {
    const page = await context.newPage();

    page.on("console", (msg) => {
      console.log(`[BROWSER ${msg.type().toUpperCase()}] ${msg.text()}`);
    });

    // Capture page errors
    page.on("pageerror", (err) => {
      console.error(`[PAGE ERROR] ${err.message}`);
      console.error(err.stack);
    });

    // Navigate to the SSO page
    await page.goto(config.ssoUrl);

    // Handle login if needed
    if (await isLoginPage(page)) {
      console.log("⚠ Login page detected — please log in manually...");
      await waitForLoginCompletion(page, 300000);
      console.log("✓ Login completed");
    }

    // Wait for extension to inject its UI
    await page.waitForSelector("#aws-account-tree-table", { timeout: 30000 });
    console.log("✓ Extension UI loaded");

    // Click the settings button
    await page.evaluate(() => {
      (document.querySelector(".settings-button") as HTMLButtonElement)?.click();
    });

    // Wait for settings dialog
    await page.waitForSelector(".settings-dialog", { timeout: 10000 });
    console.log("✓ Settings dialog open");

    await new Promise((resolve) => setTimeout(resolve, 500)); // Wait for input checkbox to be initialized

    // Enable auto-update toggle (check state and click if needed)
    const toggleSuccess = await page.evaluate(() => {
      const checkbox = document.querySelector("#auto-update-toggle") as HTMLInputElement | null;
      if (!checkbox) {
        throw new Error("Could not find auto-update toggle");
      }

      // Check current state
      const isChecked = checkbox.checked;
      console.log(`Toggle current state: ${isChecked ? "ON" : "OFF"}`, isChecked);

      // Only click if it's off
      if (!isChecked) {
        checkbox.click();
        console.log("✓ Toggle clicked to ON");
      } else {
        console.log("✓ Toggle already ON, skipping click");
      }

      return true;
    });

    if (!toggleSuccess) {
      throw new Error("Failed to check/toggle auto-update");
    }

    // Wait a bit for the toggle animation and content to appear
    await page.waitForTimeout(500);

    // Wait for URL input to appear
    await page.waitForSelector("#auto-update-url", { timeout: 5000 });

    // Fill in the URL
    await page.fill("#auto-update-url", AUTO_UPDATE_URL);
    console.log(`✓ Entered URL: ${AUTO_UPDATE_URL}`);

    // Fill in the token if provided
    if (AUTO_UPDATE_TOKEN) {
      await page.fill("#auto-update-token", AUTO_UPDATE_TOKEN);
      console.log("✓ Entered auth token");
    }

    // Wait for background extraction to complete - typically takes a few seconds for 300+ accounts
    console.log("⏳ Waiting for account extraction to complete...");
    let extractionComplete = false;
    const extractionListener = (msg: ConsoleMessage) => {
      if (msg.text().includes("✓ Total accounts extracted")) {
        extractionComplete = true;
        page.off("console", extractionListener);
      }
    };
    page.on("console", extractionListener);

    // Also set a timeout fallback
    await page.waitForTimeout(5000);
    if (extractionComplete) {
      console.log("✓ Account extraction completed (detected via console)");
    } else {
      console.log("✓ Proceeding after timeout (extraction may still be running)");
    }
    page.off("console", extractionListener);

    // Click the Test button
    const buttonFound = await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll("button"));
      const testButton = buttons.find((b) => b.textContent?.trim() === "Test");
      if (testButton) {
        testButton.click();
        return true;
      }
      return false;
    });

    if (!buttonFound) {
      throw new Error("Test button not found");
    }
    console.log("✓ Clicked Test button");

    // Wait for permission prompt to appear and user to click it
    // The browser is running in headless=false mode, so you should see a Chrome permission popup
    console.log(
      "\n⏳ IMPORTANT: If a permission popup appears, CLICK 'Allow' to grant access to the config URL"
    );
    console.log(
      "   The test will wait 10 seconds for you to respond to any permission prompts...\n"
    );

    // Wait a bit longer to give the user time to click the permission prompt
    await page.waitForTimeout(10000);

    // Check if testStatus has changed from idle
    await page.evaluate(() => {
      const message = document.querySelector(".test-result-message");
      if (message) {
        console.log(`Result message appeared: ${message.textContent?.trim().substring(0, 80)}`);
      }
      return !!message;
    });

    // Wait a moment for the result message to finalize
    await page.waitForTimeout(1000);

    const messageFound = await page
      .waitForSelector(".test-result-message", { timeout: 5000 })
      .catch(() => null);

    const result = await page.evaluate(() => {
      const el = document.querySelector(".test-result-message");

      if (!el) {
        // Fallback to generic message selector in case styling changed
        const alt = document.querySelector(".p-message, .p-inline-message");
        if (alt) {
          return {
            text: alt.textContent?.trim() ?? "",
            isSuccess:
              alt.classList.contains("p-message-success") ||
              alt.classList.contains("p-inline-message-success"),
            isError:
              alt.classList.contains("p-message-error") ||
              alt.classList.contains("p-inline-message-error"),
          };
        }
      }

      return {
        text: el?.textContent?.trim() ?? "",
        isSuccess: el
          ? el.classList.contains("p-message-success") ||
            el.classList.contains("p-inline-message-success")
          : false,
        isError: el
          ? el.classList.contains("p-message-error") ||
            el.classList.contains("p-inline-message-error")
          : false,
      };
    });

    console.log(`\n📋 Test result: ${result.text}`);

    if (!messageFound) {
      throw new Error(`Message element not found. Last result: ${result.text}`);
    }

    expect(result.isSuccess, `Expected success but got: ${result.text}`).toBe(true);
  });
});
