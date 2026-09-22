/**
 * Launch a browser with the real built extension loaded, in Chrome or Firefox.
 *
 * Chrome is straightforward. Firefox needs a workaround because Playwright does not support
 * loading extensions there: the add-on is installed over the Remote Debugging Protocol after
 * launch. See docs/temporary-code.md § "Firefox extension test harness" for why this exists, the two
 * packaging workarounds it carries, and the conditions under which it can be deleted.
 */

import fs from "node:fs";
import path from "node:path";
import { type BrowserContext, chromium, firefox } from "playwright";

export type TargetBrowser = "chrome" | "firefox";

export function extensionPath(browser: TargetBrowser): string {
  return path.join(process.cwd(), ".output", browser === "chrome" ? "chrome-mv3" : "firefox-mv2");
}

function assertBuilt(browser: TargetBrowser): string {
  const dir = extensionPath(browser);
  if (!fs.existsSync(path.join(dir, "manifest.json"))) {
    throw new Error(
      `\n❌ No built extension at ${dir}\n\nBuild it first:\n  npm run build:${browser}\n`
    );
  }
  return dir;
}

export interface LaunchOptions {
  /** Defaults to true; set false when debugging interactively. */
  headless?: boolean;
  /**
   * Pre-grant the optional host permission. Chrome cannot answer its own permission prompt under
   * automation (Playwright #32755), so tests that need a granted permission use a manifest
   * variant instead — see docs/permissions.md § "Testing permissions".
   */
  grantHostPermissions?: boolean;
  /**
   * Firefox only. When false the optional-permission prompt is shown (and will hang unattended);
   * when true, requests are silently approved. Defaults to true.
   */
  autoApproveFirefoxPermissions?: boolean;
}

/**
 * Copy the built extension to a temp dir with the host permission declared as required.
 *
 * The key differs by manifest version and getting it wrong fails silently — MV3 needs
 * `host_permissions`, MV2 needs hosts inside `permissions`. Putting `<all_urls>` in MV3's
 * `permissions` array does nothing at all.
 */
function withGrantedHostPermissions(browser: TargetBrowser, sourceDir: string): string {
  const target = fs.mkdtempSync(path.join(process.cwd(), ".output", `test-ext-${browser}-`));
  fs.cpSync(sourceDir, target, { recursive: true });

  const manifestFile = path.join(target, "manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"));

  if (manifest.manifest_version === 3) {
    manifest.host_permissions = ["<all_urls>"];
  } else {
    manifest.permissions = [...(manifest.permissions ?? []), "<all_urls>"];
  }

  fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2));
  return target;
}

export interface LaunchedExtension {
  context: BrowserContext;
  close: () => Promise<void>;
}

async function launchChrome(options: LaunchOptions): Promise<LaunchedExtension> {
  const built = assertBuilt("chrome");
  const dir = options.grantHostPermissions ? withGrantedHostPermissions("chrome", built) : built;

  const context = await chromium.launchPersistentContext("", {
    // Extensions require a persistent context; the new headless mode supports them.
    headless: false,
    args: [
      ...(options.headless === false ? [] : ["--headless=new"]),
      `--disable-extensions-except=${dir}`,
      `--load-extension=${dir}`,
    ],
  });

  return {
    context,
    close: async () => {
      await context.close();
      if (dir !== built) fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

async function launchFirefox(options: LaunchOptions): Promise<LaunchedExtension> {
  const built = assertBuilt("firefox");
  const dir = options.grantHostPermissions ? withGrantedHostPermissions("firefox", built) : built;

  // Installed over the Remote Debugging Protocol after Playwright launches Firefox — the
  // mechanism web-ext itself uses.
  // @see docs/temporary-code.md § "Firefox extension test harness"
  const { withExtension } = await import("playwright-webextext/dist/factory.js");

  const context = await withExtension(firefox, dir).launchPersistentContext("", {
    headless: options.headless !== false,
    firefoxUserPrefs: {
      // Optional-permission prompts cannot be clicked by automation; suppressing them makes
      // permissions.request() resolve as granted so the granted path is testable.
      "extensions.webextOptionalPermissionPrompts": options.autoApproveFirefoxPermissions === false,
      "xpinstall.signatures.required": false,
    },
  });

  return {
    context,
    close: async () => {
      await context.close();
      if (dir !== built) fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

export async function launchWithExtension(
  browser: TargetBrowser,
  options: LaunchOptions = {}
): Promise<LaunchedExtension> {
  return browser === "chrome" ? launchChrome(options) : launchFirefox(options);
}
