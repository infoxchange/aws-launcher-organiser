import { defineBackground } from "wxt/utils/define-background";
import { RemoteConfigSchema, STORAGE_KEY } from "../src/utils/configStore";
import { getHostPermissionPattern } from "../src/utils/permissions";

const ALARM_NAME = "auto-update-config";
const imageCache = new Map<string, string>();

interface PersistedState {
  groups: unknown[];
  autoUpdateEnabled: boolean;
  autoUpdateUrl: string;
  autoUpdateAuthToken: string;
}

async function readState(): Promise<{
  raw: string;
  state: PersistedState;
  version: number;
} | null> {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  const raw = result[STORAGE_KEY] as string | undefined;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { state: PersistedState; version: number };
    return { raw, state: parsed.state, version: parsed.version };
  } catch {
    return null;
  }
}

async function checkForConfigUpdates() {
  const stored = await readState();
  if (!stored) return;

  const { state, version } = stored;
  if (!state.autoUpdateEnabled || !state.autoUpdateUrl) return;

  // Request permission for the URL before attempting to fetch
  const pattern = getHostPermissionPattern(state.autoUpdateUrl);
  const hasPermission = await new Promise<boolean>((resolve) => {
    chrome.permissions.contains({ origins: [pattern] }, (result) => {
      resolve(result === true);
    });
  });

  if (!hasPermission) {
    const granted = await new Promise<boolean>((resolve) => {
      chrome.permissions.request({ origins: [pattern] }, (result) => {
        resolve(result === true);
      });
    });

    if (!granted) {
      console.warn("[auto-update] Permission denied for URL:", state.autoUpdateUrl);
      return;
    }
  }

  const headers: Record<string, string> = {};
  if (state.autoUpdateAuthToken) {
    headers.Authorization = `Bearer ${state.autoUpdateAuthToken}`;
  }

  let json: unknown;
  try {
    const response = await fetch(state.autoUpdateUrl, { headers });
    if (!response.ok) {
      console.warn(`[auto-update] Fetch failed: ${response.status} ${response.statusText}`);
      return;
    }
    json = await response.json();
  } catch (err) {
    console.warn("[auto-update] Fetch error:", err);
    return;
  }

  const parsed = RemoteConfigSchema.safeParse(json);
  if (!parsed.success) {
    console.warn("[auto-update] Invalid config schema:", parsed.error.message);
    return;
  }

  const newState: PersistedState = { ...state, groups: parsed.data.groups };
  await chrome.storage.local.set({
    [STORAGE_KEY]: JSON.stringify({ state: newState, version }),
  });
  console.log("[auto-update] Config updated successfully");
}

/**
 * Fetch and cache image as data URL to avoid CORS issues in content scripts
 */
async function fetchImageAsDataUrl(src: string): Promise<string> {
  // Check cache first
  const cached = imageCache.get(src);
  if (cached) {
    return cached;
  }

  try {
    const response = await fetch(src);
    if (!response.ok) {
      throw new Error(`Failed to fetch image: ${response.statusText}`);
    }
    const blob = await response.blob();
    const reader = new FileReader();
    return new Promise<string>((resolve, reject) => {
      reader.onload = () => {
        const dataUrl = reader.result as string;
        imageCache.set(src, dataUrl);
        resolve(dataUrl);
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } catch (error) {
    console.error(`Failed to fetch image from ${src}:`, error);
    throw error;
  }
}

export default defineBackground({
  main() {
    console.log("Background service worker loaded");

    // Handle permission-related and config test messages from UI components
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (message.type === "CHECK_PERMISSION") {
        // Check if permission exists for the given pattern
        console.log("[background] Checking permission for:", message.pattern);
        chrome.permissions.contains({ origins: [message.pattern] }, (result) => {
          console.log("[background] Permission check result:", result);
          sendResponse({ hasPermission: result === true });
        });
        // Return true to indicate we'll send a response asynchronously
        return true;
      }

      if (message.type === "REQUEST_PERMISSION") {
        // Request permission for the given pattern
        console.log("[background] Requesting permission for:", message.pattern);
        chrome.permissions.request({ origins: [message.pattern] }, (granted) => {
          console.log("[background] Permission request callback, granted:", granted);
          sendResponse({ granted: granted === true });
        });
        // Return true to indicate we'll send a response asynchronously
        return true;
      }

      if (message.type === "TEST_REMOTE_CONFIG") {
        // Test connection to a remote config URL
        (async () => {
          try {
            const headers: Record<string, string> = {};
            if (message.authToken) {
              headers.Authorization = `Bearer ${message.authToken}`;
            }

            const response = await fetch(message.url, { headers });
            if (!response.ok) {
              sendResponse({
                success: false,
                error: `HTTP ${response.status}: ${response.statusText}`,
              });
              return;
            }

            let json: unknown;
            try {
              json = await response.json();
            } catch {
              sendResponse({
                success: false,
                error: "Response is not valid JSON.",
              });
              return;
            }

            sendResponse({ success: true, data: json });
          } catch (err) {
            sendResponse({
              success: false,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        })();
        // Return true to indicate we'll send a response asynchronously
        return true;
      }

      if (message.type === "FETCH_IMAGE") {
        fetchImageAsDataUrl(message.src)
          .then((dataUrl) => {
            sendResponse({ success: true, dataUrl });
          })
          .catch((error) => {
            sendResponse({ success: false, error: error.message });
          });
        // Return true to indicate we'll send a response asynchronously
        return true;
      }
    });

    // Recreate alarm on service worker startup (service workers can be killed/restarted)
    chrome.alarms.get(ALARM_NAME, (alarm) => {
      if (!alarm) {
        chrome.alarms.create(ALARM_NAME, {
          delayInMinutes: 60, // first run in 1 hour
          periodInMinutes: 24 * 60, // then every 24 hours
        });
      }
    });

    chrome.alarms.onAlarm.addListener((alarm) => {
      if (alarm.name === ALARM_NAME) {
        checkForConfigUpdates().catch(console.error);
      }
    });

    // Also check on startup if auto-update is enabled
    checkForConfigUpdates().catch(console.error);
  },
});
