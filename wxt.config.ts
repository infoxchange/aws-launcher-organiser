import { defineConfig } from "wxt";

export default defineConfig({
  manifest: {
    name: "AWS Launcher Organiser",
    description: "Organize AWS accounts on the launcher page",
    version: "0.1.0",
    browser_specific_settings: {
      gecko: {
        "id": "@aws-launcher-organiser",
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
