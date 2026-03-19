import { defineBackground } from "wxt/utils/define-background";
import { RemoteConfigSchema, STORAGE_KEY } from "../src/utils/configStore";

const ALARM_NAME = "auto-update-config";

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

export default defineBackground({
  main(_ctx) {
    console.log("Background service worker loaded");

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
