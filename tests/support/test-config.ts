/**
 * Configuration management for integration tests
 * Handles SSO URL storage and retrieval
 */

import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";

const CONFIG_DIR = path.join(process.cwd(), ".test-config");
const CONFIG_FILE = path.join(CONFIG_DIR, "config.json");

export interface TestConfig {
  ssoUrl: string;
  expectedAccountCount?: number;
}

/**
 * Ensure config directory exists
 */
function ensureConfigDir(): void {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

/**
 * Load configuration from file
 */
export function loadConfig(): TestConfig | null {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const data = fs.readFileSync(CONFIG_FILE, "utf-8");
      return JSON.parse(data);
    }
  } catch (error) {
    console.warn("Could not load test config:", error);
  }
  return null;
}

/**
 * Save configuration to file
 */
export function saveConfig(config: TestConfig): void {
  ensureConfigDir();
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

/**
 * Prompt user for SSO URL interactively
 */
export async function promptForSsoUrl(): Promise<string> {
  return new Promise((resolve, reject) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    // Handle errors
    rl.on("error", (error) => {
      console.error("Input error:", error);
      reject(error);
    });

    console.log("\n🔐 AWS Launcher Organiser Integration Tests\n");
    console.log("Please enter your AWS SSO URL (e.g., https://yourdomain.awsapps.com/start/):");
    console.log("");

    rl.question("SSO URL: ", (url) => {
      rl.close();

      // Validate and normalize URL
      const normalizedUrl = normalizeUrl(url);
      if (!normalizedUrl) {
        console.error("✗ Invalid SSO URL. Please try again.\n");
        return promptForSsoUrl().then(resolve).catch(reject);
      }

      console.log(`✓ Using SSO URL: ${normalizedUrl}\n`);
      resolve(normalizedUrl);
    });
  });
}

/**
 * Normalize and validate SSO URL
 */
export function normalizeUrl(url: string): string | null {
  try {
    // Add https:// if not present
    let normalizedUrl = url.startsWith("http") ? url : `https://${url}`;

    // Ensure it ends with /
    if (!normalizedUrl.endsWith("/")) {
      normalizedUrl += "/";
    }

    // Validate it's a valid URL
    new URL(normalizedUrl);
    return normalizedUrl;
  } catch {
    return null;
  }
}

/**
 * Get SSO URL, prompting if not configured
 */
export async function getSsoUrl(): Promise<string> {
  const config = loadConfig();

  if (config?.ssoUrl) {
    return config.ssoUrl;
  }

  const url = await promptForSsoUrl();
  const existingConfig = loadConfig() || {};
  saveConfig({ ...existingConfig, ssoUrl: url });
  return url;
}

/**
 * Prompt user for expected account count
 */
export async function promptForAccountCount(): Promise<number> {
  return new Promise((resolve, reject) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    rl.on("error", (error) => {
      console.error("Input error:", error);
      reject(error);
    });

    console.log("\n📊 Expected account count\n");
    console.log("How many accounts should we expect to find?");
    console.log("(This is used to validate test results)");
    console.log("");

    rl.question("Expected account count: ", (input) => {
      rl.close();

      const count = parseInt(input, 10);
      if (Number.isNaN(count) || count <= 0) {
        console.error("✗ Please enter a valid number greater than 0.\n");
        return promptForAccountCount().then(resolve).catch(reject);
      }

      console.log(`✓ Expecting ${count} account(s)\n`);
      resolve(count);
    });
  });
}

/**
 * Get expected account count, prompting if not configured
 */
export async function getExpectedAccountCount(): Promise<number> {
  const config = loadConfig();

  if (config?.expectedAccountCount) {
    return config.expectedAccountCount;
  }

  const count = await promptForAccountCount();
  const existingConfig = loadConfig() || { ssoUrl: "" };
  saveConfig({ ...existingConfig, expectedAccountCount: count });
  return count;
}

/**
 * Clear saved configuration (useful for testing or reconfiguring)
 */
export function clearConfig(): void {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      fs.unlinkSync(CONFIG_FILE);
    }
  } catch (error) {
    console.warn("Could not clear test config:", error);
  }
}
