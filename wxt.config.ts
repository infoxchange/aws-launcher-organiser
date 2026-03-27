import { defineConfig } from "wxt";

export default defineConfig({
  manifest: {
    name: "AWS Launcher Organiser",
    description: "Organize AWS accounts on the launcher page",
    version: "0.0.0", // This is set when releasing
    permissions: ["storage", "alarms"],
    host_permissions: ["<all_urls>"],
    browser_specific_settings: {
      gecko: {
        id: "@aws-launcher-organiser",
        // @ts-expect-error - Introduced recently so not in WXT types yet
        // https://extensionworkshop.com/documentation/develop/firefox-builtin-data-consent/
        data_collection_permissions: {
          required: ["none"],
        },
      },
    },
  },
  analysis: {
    enabled: true,
  },
  webExt: {
    chromiumArgs: ["--user-data-dir=./.wxt/chrome-data"],
  },
});
