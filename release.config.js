export default {
  branches: ["main", "add-ci"],
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
        prepareCmd: 'NEXT_VERSION="${nextRelease.version}" node scripts/update-version.js',
        // verifyReleaseCmd runs during dry-run in the build job, updating package.json and wxt.config.ts
        // before building, so we can build the extension with the correct version numbers before we actually publish it
        verifyReleaseCmd: 'NEXT_VERSION="${nextRelease.version}" node scripts/update-version.js',
      },
    ],
    "@semantic-release/changelog",
    "@semantic-release/github",
    [
      "@semantic-release/exec",
      {
        // Chrome support will be added once https://github.com/aklinker1/publish-browser-extension/pull/50 is resolved
        // publishCmd: 'npm exec wxt -- submit --chrome-zip .output/*-chrome.zip --firefox-zip .output/*-firefox.zip --firefox-sources-zip .output/*-sources.zip'
        publishCmd:
          "npm exec wxt -- submit --dry-run --firefox-zip .output/*-firefox.zip --firefox-sources-zip .output/*-sources.zip",
      },
    ],
  ],
};
