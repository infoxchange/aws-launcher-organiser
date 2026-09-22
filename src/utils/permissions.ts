/**
 * Utility functions for managing dynamic host permissions
 *
 * @see docs/permissions.md § "Requests go through the background script"
 * Uses message passing to communicate with background script for permission checks/requests
 * This is necessary because browser.permissions API is not available in content scripts
 *
 * Note on Firefox: Permission dialogs may not appear in controlled/headless Firefox (e.g., with Playwright)
 * In such cases, we proceed with the fetch anyway since optional_host_permissions are pre-declared
 */

/**
 * Extract the host permission pattern from a URL
 * @param url - The full URL to extract host permission from
 * @returns A host permission pattern like "https://example.com/*"
 */
export function getHostPermissionPattern(url: string): string {
  try {
    const urlObj = new URL(url);
    return `${urlObj.protocol}//${urlObj.hostname}/*`;
  } catch {
    throw new Error(`Invalid URL: ${url}`);
  }
}

/**
 * Send a message to the background script
 * @param message The message to send
 * @returns Promise resolving to the response, or undefined if the handler sent none
 */
async function sendBackgroundMessage<T>(message: unknown): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(response);
      }
    });
  });
}

/**
 * Request permission for a specific URL.
 * Must be called directly from a user input handler (e.g. button click) to satisfy
 * browser requirements, particularly Firefox.
 * @param url - The URL to request permission for
 * @returns Promise<boolean> - true if permission was granted, false otherwise
 */
export async function requestUrlPermission(url: string): Promise<boolean> {
  const pattern = getHostPermissionPattern(url);
  console.log("[permissions] Requesting permission for:", pattern);
  try {
    const response = await sendBackgroundMessage<{ granted?: boolean }>({
      type: "REQUEST_PERMISSION",
      pattern,
    });
    console.log("[permissions] Permission response:", response);
    const granted = response?.granted ?? false;
    console.log("[permissions] Permission granted:", granted);
    return granted;
  } catch (err) {
    console.error(
      "[permissions] Permission request failed (may be normal in headless Firefox):",
      err
    );
    return false;
  }
}

/**
 * Check if permission already exists for a URL.
 * @param url - The URL to check permission for
 * @returns Promise<boolean> - true if permission exists, false otherwise
 */
export async function hasUrlPermission(url: string): Promise<boolean> {
  const pattern = getHostPermissionPattern(url);
  try {
    const response = await sendBackgroundMessage<{ hasPermission?: boolean }>({
      type: "CHECK_PERMISSION",
      pattern,
    });
    return response?.hasPermission ?? false;
  } catch (err) {
    console.error("[permissions] Failed to check permission:", err);
    return false;
  }
}

/**
 * Test a connection to a remote config URL
 * Delegates to background script to perform fetch with proper permissions
 * @param url - The URL to test
 * @param authToken - Optional bearer token
 * @returns Promise with validation result
 */
export async function testRemoteConfigUrl(
  url: string,
  authToken?: string
): Promise<{ success: boolean; data?: unknown; error?: string }> {
  try {
    const response = await sendBackgroundMessage<{
      success: boolean;
      data?: unknown;
      error?: string;
    }>({
      type: "TEST_REMOTE_CONFIG",
      url,
      authToken,
    });
    return response ?? { success: false, error: "No response from background" };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Ensure permission exists for a URL, requesting it if necessary
 * In headless/controlled browsers (e.g., Playwright Firefox), permission dialogs don't appear,
 * but the fetch may still work with optional_host_permissions pre-declared in the manifest
 * @param url - The URL to ensure permission for
 * @returns Promise<boolean> - true if permission exists or was granted, false otherwise
 */
export async function ensureUrlPermission(url: string): Promise<boolean> {
  const hasPermission = await hasUrlPermission(url);
  if (hasPermission) {
    return true;
  }

  // Try to request permission, but don't fail if it doesn't work
  // (may not appear in headless Firefox, but fetch might still succeed)
  const granted = await requestUrlPermission(url);
  return granted;
}
