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

    // Handle permission-related messages from UI components
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (message.type === "CHECK_URL_PERMISSION") {
        try {
          const pattern = getHostPermissionPattern(message.url);
          console.log(`[permissions] Checking permission for: ${pattern}`);
          chrome.permissions.contains({ origins: [pattern] }, (result) => {
            console.log(`[permissions] Check result for ${pattern}:`, result);
            if (chrome.runtime.lastError) {
              console.error(`[permissions] Check error:`, chrome.runtime.lastError);
              sendResponse({ hasPermission: false, error: chrome.runtime.lastError.message });
            } else {
              sendResponse({ hasPermission: result === true });
            }
          });
        } catch (error) {
          console.error(`[permissions] Check exception:`, error);
          sendResponse({
            hasPermission: false,
            error: error instanceof Error ? error.message : String(error),
          });
        }
        return true; // indicate we'll send a response asynchronously
      }

      if (message.type === "REQUEST_URL_PERMISSION") {
        try {
          const pattern = getHostPermissionPattern(message.url);
          console.log(`[permissions] Requesting permission for: ${pattern}`);
          chrome.permissions.request({ origins: [pattern] }, (granted) => {
            console.log(`[permissions] Request result for ${pattern}:`, granted);
            if (chrome.runtime.lastError) {
              console.error(`[permissions] Request error:`, chrome.runtime.lastError);
              sendResponse({ granted: false, error: chrome.runtime.lastError.message });
            } else {
              sendResponse({ granted: granted === true });
            }
          });
        } catch (error) {
          console.error(`[permissions] Request exception:`, error);
          sendResponse({
            granted: false,
            error: error instanceof Error ? error.message : String(error),
          });
        }
        return true; // indicate we'll send a response asynchronously
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
