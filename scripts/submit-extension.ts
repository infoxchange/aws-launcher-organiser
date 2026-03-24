#!/usr/bin/env node

import { execSync } from "child_process";

const branch = process.env.GITHUB_REF?.replace("refs/heads/", "") || "";
const isDryRun = branch.startsWith("test-publish/");

const dryRunFlag = isDryRun ? "--dry-run" : "";
const cmd =
  `npm exec wxt -- submit ${dryRunFlag} --firefox-zip .output/*-firefox.zip --firefox-sources-zip .output/*-sources.zip`.trim();

console.log(`Branch: ${branch}`);
console.log(`Dry run: ${isDryRun}`);
console.log(`Command: ${cmd}`);

execSync(cmd, { stdio: "inherit" });
