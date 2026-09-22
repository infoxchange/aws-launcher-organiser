import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "wxt";

// Firefox does not automatically create this dir so we have to
const firefoxProfilePath = resolve(import.meta.dirname, ".wxt/firefox-profile");
mkdirSync(firefoxProfilePath, { recursive: true });

export default defineConfig({
  manifest: ({ manifestVersion }) => ({
    name: "AWS Launcher Organiser",
    description: "Organize AWS accounts on the launcher page",
    version: "0.0.0", // This is set when releasing
    // @see docs/permissions.md § "The manifest key differs by manifest version"
    // Optional host permissions are declared under different keys per manifest version, and
    // getting this wrong fails silently — `permissions.contains()` simply returns false and
    // the background fetch is then blocked by CORS. MV3 uses optional_host_permissions; MV2
    // (Firefox) has no such key and must list hosts in optional_permissions instead.
    permissions: ["storage", "alarms"],
    ...(manifestVersion === 3
      ? { host_permissions: [], optional_host_permissions: ["<all_urls>"] }
      : { optional_permissions: ["<all_urls>"] }),
    browser_specific_settings: {
      gecko: {
        id: "@aws-launcher-organiser",
        // https://extensionworkshop.com/documentation/develop/firefox-builtin-data-consent/
        data_collection_permissions: {
          required: ["none"],
        },
      },
    },
  }),
  analysis: {
    enabled: true,
  },
  webExt: {
    chromiumArgs: ["--user-data-dir=./.wxt/chrome-data"],
    firefoxProfile: firefoxProfilePath,
    keepProfileChanges: true,
  },
});
