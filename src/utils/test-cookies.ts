/**
 * Cookie management for integration tests
 * Uses simple cookie persistence (same approach as debug-accounts-simple.mjs which works)
 */

import fs from "node:fs";
import path from "node:path";
import type { BrowserContext } from "playwright";

const COOKIES_DIR = path.join(process.cwd(), ".test-cookies");
const COOKIES_FILE = path.join(COOKIES_DIR, "cookies.json");

/**
 * Ensure cookies directory exists
 */
function ensureCookiesDir(): void {
  if (!fs.existsSync(COOKIES_DIR)) {
    fs.mkdirSync(COOKIES_DIR, { recursive: true });
  }
}

/**
 * Save cookies for future test runs
 * Uses simple cookies approach that works with AWS SSO
 */
export async function saveCookies(context: BrowserContext): Promise<void> {
  try {
    ensureCookiesDir();
    // Use simple cookies approach - same as debug-accounts-simple.mjs
    const cookies = await context.cookies();
    fs.writeFileSync(COOKIES_FILE, JSON.stringify(cookies, null, 2));
    console.log("  Saved cookies and context state");
  } catch (error) {
    console.warn("⚠ Could not save cookies:", error instanceof Error ? error.message : error);
  }
}

/**
 * Load cookies from previous runs
 */
export async function loadCookies(context: BrowserContext): Promise<boolean> {
  try {
    if (!fs.existsSync(COOKIES_FILE)) {
      return false;
    }

    const data = fs.readFileSync(COOKIES_FILE, "utf-8");
    const cookies = JSON.parse(data);

    // Restore cookies using simple approach
    if (Array.isArray(cookies) && cookies.length > 0) {
      await context.addCookies(cookies);
      console.log(`  Loaded ${cookies.length} cookies`);
      return true;
    }

    return false;
  } catch (error) {
    console.warn("⚠ Could not load cookies:", error instanceof Error ? error.message : error);
  }
  return false;
}

/**
 * Clear cached cookies
 */
export function clearCookies(): void {
  try {
    if (fs.existsSync(COOKIES_FILE)) {
      fs.unlinkSync(COOKIES_FILE);
    }
  } catch (error) {
    console.warn("Could not clear cookies:", error);
  }
}

/**
 * Check if we have cached cookies
 */
export function hasCachedCookies(): boolean {
  return fs.existsSync(COOKIES_FILE);
}
