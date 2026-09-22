/**
 * Unit tests for the permission message plumbing.
 *
 * The *denied* path lives here rather than in a browser test because neither browser lets
 * automation click "deny" on a permission prompt: Chrome cannot respond to the prompt at all and
 * hangs, and Firefox denies background-initiated requests without ever showing one. Stubbing the
 * background's reply is the only way to assert how the UI copes.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ensureUrlPermission,
  getHostPermissionPattern,
  hasUrlPermission,
  requestUrlPermission,
  testRemoteConfigUrl,
} from "./permissions";

type Responder = (message: { type: string; [key: string]: unknown }) => unknown;

/** Install a fake `chrome.runtime` whose sendMessage replies via `responder`. */
function stubChrome(responder: Responder, lastError?: string) {
  const sendMessage = vi.fn((message: never, callback: (response: unknown) => void) => {
    // Real Chrome always replies asynchronously; mimic that so the tests exercise the same
    // ordering the extension sees in production.
    setTimeout(() => {
      (
        globalThis as { chrome: { runtime: { lastError?: { message: string } } } }
      ).chrome.runtime.lastError = lastError ? { message: lastError } : undefined;
      callback(lastError ? undefined : responder(message));
    }, 0);
  });

  (globalThis as unknown as { chrome: unknown }).chrome = {
    runtime: { sendMessage, lastError: undefined },
  };

  return sendMessage;
}

describe("getHostPermissionPattern", () => {
  it("reduces a URL to an origin pattern", () => {
    expect(getHostPermissionPattern("https://example.com/config.json")).toBe(
      "https://example.com/*"
    );
  });

  it("keeps the scheme, since http and https are distinct permissions", () => {
    expect(getHostPermissionPattern("http://127.0.0.1:8080/c.json")).toBe("http://127.0.0.1/*");
  });

  it("throws on input that is not a URL", () => {
    expect(() => getHostPermissionPattern("not a url")).toThrow(/Invalid URL/);
  });
});

/** @see docs/permissions.md § "Requests go through the background script" */
describe("permission checks", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
    (globalThis as { chrome?: unknown }).chrome = undefined;
  });

  it("reports an existing permission", async () => {
    stubChrome(() => ({ hasPermission: true }));
    await expect(hasUrlPermission("https://example.com/c.json")).resolves.toBe(true);
  });

  it("reports a missing permission", async () => {
    stubChrome(() => ({ hasPermission: false }));
    await expect(hasUrlPermission("https://example.com/c.json")).resolves.toBe(false);
  });

  it("treats a background error as 'no permission' rather than throwing", async () => {
    stubChrome(() => ({}), "Receiving end does not exist");
    await expect(hasUrlPermission("https://example.com/c.json")).resolves.toBe(false);
  });

  it("returns false when the user denies the request", async () => {
    stubChrome(() => ({ granted: false }));
    await expect(requestUrlPermission("https://example.com/c.json")).resolves.toBe(false);
  });

  it("returns true when the user grants the request", async () => {
    stubChrome(() => ({ granted: true }));
    await expect(requestUrlPermission("https://example.com/c.json")).resolves.toBe(true);
  });

  it("does not request a permission it already holds", async () => {
    const sendMessage = stubChrome(() => ({ hasPermission: true }));
    await expect(ensureUrlPermission("https://example.com/c.json")).resolves.toBe(true);

    const sentTypes = sendMessage.mock.calls.map(
      (call) => (call[0] as unknown as { type: string }).type
    );
    expect(sentTypes).toEqual(["CHECK_PERMISSION"]);
  });

  it("requests the permission when it is missing", async () => {
    const sendMessage = stubChrome((message) =>
      message.type === "CHECK_PERMISSION" ? { hasPermission: false } : { granted: true }
    );
    await expect(ensureUrlPermission("https://example.com/c.json")).resolves.toBe(true);

    const sentTypes = sendMessage.mock.calls.map(
      (call) => (call[0] as unknown as { type: string }).type
    );
    expect(sentTypes).toEqual(["CHECK_PERMISSION", "REQUEST_PERMISSION"]);
  });

  it("reports failure when the permission is refused", async () => {
    stubChrome((message) =>
      message.type === "CHECK_PERMISSION" ? { hasPermission: false } : { granted: false }
    );
    await expect(ensureUrlPermission("https://example.com/c.json")).resolves.toBe(false);
  });
});

describe("testRemoteConfigUrl", () => {
  afterEach(() => {
    (globalThis as { chrome?: unknown }).chrome = undefined;
  });

  it("passes the background's success result through", async () => {
    stubChrome(() => ({ success: true, data: { version: 1, groups: [] } }));
    await expect(testRemoteConfigUrl("https://example.com/c.json")).resolves.toEqual({
      success: true,
      data: { version: 1, groups: [] },
    });
  });

  it("surfaces the background's error message", async () => {
    stubChrome(() => ({
      success: false,
      error: "NetworkError when attempting to fetch resource.",
    }));
    const result = await testRemoteConfigUrl("https://example.com/c.json");
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/NetworkError/);
  });

  it("reports a failure when the background never answers", async () => {
    stubChrome(() => undefined, "Could not establish connection");
    const result = await testRemoteConfigUrl("https://example.com/c.json");
    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it("forwards the auth token to the background", async () => {
    const sendMessage = stubChrome(() => ({ success: true, data: {} }));
    await testRemoteConfigUrl("https://example.com/c.json", "secret-token");

    const message = sendMessage.mock.calls[0][0] as unknown as Record<string, unknown>;
    expect(message.type).toBe("TEST_REMOTE_CONFIG");
    expect(message.authToken).toBe("secret-token");
  });
});
