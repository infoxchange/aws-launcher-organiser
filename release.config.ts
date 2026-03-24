import { execSync } from "node:child_process";
import type { Options } from "semantic-release";

function getGitShortCommit(): string {
  try {
    return execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim();
  } catch (error) {
    console.error("Failed to get git commit hash:", error);
    return "unknown";
  }
}

function getCurrentBranchName(): string {
  try {
    return execSync("git rev-parse --abbrev-ref HEAD", { encoding: "utf8" }).trim();
  } catch (error) {
    console.error("Failed to get current branch name:", error);
    return "unknown";
  }
}

function sanitizeBranchName(name: string): string {
  // Replace forward slashes and other invalid npm version characters
  return name.replace(/[/\\]/, "-");
}

const gitCommit = getGitShortCommit();
const branchName = getCurrentBranchName();
const escapedBranchName = sanitizeBranchName(branchName);

const config: Options = {
  branches: [
    "main",
    {
      name: "test-publish/*",
      prerelease: `${escapedBranchName}-${gitCommit}`,
    },
    "add-ci",
  ],
  plugins: [
    [
      "@semantic-release/commit-analyzer",
      {
        preset: "conventionalcommits",
        releaseRules: [
          { breaking: true, release: "major" },
          { type: "feat", release: "minor" },
          { revert: true, release: "patch" },
          { type: "fix", release: "patch" },
          { type: "perf", release: "patch" },
          { type: "ci", release: "patch" },
          { type: "refactor", release: "patch" },
          { type: "chore", release: "patch" },
          { type: "wip", release: "patch" },
          { type: "docs", scope: "help-text", release: "patch" },
          { type: "test", release: false },
          { scope: "no-release", release: false },
        ],
      },
    ],
    "@semantic-release/release-notes-generator",
    [
      "@semantic-release/exec",
      {
        // biome-ignore lint/suspicious/noTemplateCurlyInString: semantic-release interpolates this at runtime
        prepareCmd: 'NEXT_VERSION="${nextRelease.version}" npx tsx scripts/update-version.ts',
        // verifyReleaseCmd runs during dry-run in the build job, updating package.json and wxt.config.ts
        // before building, so we can build the extension with the correct version numbers before we actually publish it
        // biome-ignore lint/suspicious/noTemplateCurlyInString: semantic-release interpolates this at runtime
        verifyReleaseCmd: 'NEXT_VERSION="${nextRelease.version}" npx tsx scripts/update-version.ts',
      },
    ],
    "@semantic-release/changelog",
    "@semantic-release/github",
    [
      "@semantic-release/exec",
      {
        // Chrome support will be added once https://github.com/aklinker1/publish-browser-extension/pull/50 is resolved
        // publishCmd: 'npm exec wxt -- submit --chrome-zip .output/*-chrome.zip --firefox-zip .output/*-firefox.zip --firefox-sources-zip .output/*-sources.zip'
        publishCmd: "npx tsx scripts/submit-extension.ts",
      },
    ],
  ],
};

export default config;
