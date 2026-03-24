#!/usr/bin/env node

import fs from "fs";
import path from "path";

const version = process.env.NEXT_VERSION;

if (!version) {
  console.error("NEXT_VERSION environment variable not set");
  process.exit(1);
}

// Update package.json
const packageJsonPath = path.resolve("./package.json");
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));
packageJson.version = version;
fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2) + "\n");
console.log(`Updated package.json to version ${version}`);

// Update wxt.config.ts
const wxtConfigPath = path.resolve("./wxt.config.ts");
let wxtConfig = fs.readFileSync(wxtConfigPath, "utf-8");
wxtConfig = wxtConfig.replace(/version: "[^"]*"/, `version: "${version}"`);
fs.writeFileSync(wxtConfigPath, wxtConfig);
console.log(`Updated wxt.config.ts to version ${version}`);
