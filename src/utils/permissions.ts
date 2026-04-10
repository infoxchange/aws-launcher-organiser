/**
 * Utility functions for managing dynamic host permissions
 * These use message passing to communicate with the background service worker
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
 * Request permission for a specific URL via the background service worker
 * @param url - The URL to request permission for
 * @returns Promise<boolean> - true if permission was granted, false if denied
 * @throws Error if permission request fails
 */
export async function requestUrlPermission(url: string): Promise<boolean> {
  return new Promise((resolve, reject) => {
    try {
      chrome.runtime.sendMessage(
        { type: "REQUEST_URL_PERMISSION", url },
        (response: { granted?: boolean; error?: string } | undefined) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else if (response?.error) {
            reject(new Error(response.error));
          } else {
            resolve(response?.granted === true);
          }
        }
      );
    } catch (error) {
      reject(error);
    }
  });
}

/**
 * Check if permission already exists for a URL via the background service worker
 * @param url - The URL to check permission for
 * @returns Promise<boolean> - true if permission exists, false otherwise
 * @throws Error if permission check fails
 */
export async function hasUrlPermission(url: string): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error("Permission check timed out - background service worker did not respond"));
    }, 5000);

    try {
      chrome.runtime.sendMessage(
        { type: "CHECK_URL_PERMISSION", url },
        (response: { hasPermission?: boolean; error?: string } | undefined) => {
          clearTimeout(timeout);
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else if (response?.error) {
            reject(new Error(response.error));
          } else {
            resolve(response?.hasPermission === true);
          }
        }
      );
    } catch (error) {
      clearTimeout(timeout);
      reject(error);
    }
  });
}

/**
 * Ensure permission exists for a URL, requesting it if necessary
 * @param url - The URL to ensure permission for
 * @returns Promise<boolean> - true if permission exists or was granted, false if denied
 */
export async function ensureUrlPermission(url: string): Promise<boolean> {
  const hasPermission = await hasUrlPermission(url);
  if (hasPermission) {
    return true;
  }

  return requestUrlPermission(url);
}
