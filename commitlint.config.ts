import type { UserConfig } from "@commitlint/types";

export default {
  ignores: [
    (message) =>
      // Allow "wip" commits except when publishing a production release or on PR CI jobs
      process.env.GITHUB_EVENT_NAME !== "pull_request" &&
      (process.env.GITHUB_WORKFLOW !== "Publish" ||
        (process.env.GITHUB_REF_NAME?.startsWith("test-publish/") ?? true)) &&
      (message === "wip" || message.startsWith("wip:")),
  ],
  extends: ["@commitlint/config-conventional"],
} satisfies UserConfig;
