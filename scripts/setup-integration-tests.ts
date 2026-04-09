#!/usr/bin/env tsx

/**
 * Setup script for integration tests
 * Prompts for SSO URL and expected account count, then caches them
 * Run this once before running `npm run test:integration`
 */

import { createInterface } from "node:readline";
import { getExpectedAccountCount, getSsoUrl, loadConfig } from "../src/utils/test-config";

async function main() {
  console.log("\n🔧 AWS Launcher Organiser - Integration Test Setup\n");
  console.log("This script will configure your integration tests.\n");

  try {
    // Check if config already exists
    const existingConfig = loadConfig();
    if (existingConfig?.ssoUrl && existingConfig?.expectedAccountCount) {
      console.log("✓ Existing configuration found:");
      console.log(`  SSO URL: ${existingConfig.ssoUrl}`);
      console.log(`  Expected accounts: ${existingConfig.expectedAccountCount}\n`);

      const rl = createInterface({
        input: process.stdin,
        output: process.stdout,
      });

      return new Promise<void>((resolve) => {
        rl.question("Do you want to update the configuration? (y/n): ", async (answer) => {
          rl.close();

          if (answer.toLowerCase() !== "y") {
            console.log("\n✓ Configuration unchanged. Ready to run tests!\n");
            resolve();
            return;
          }

          // Get new values
          console.log("");
          await getSsoUrl();
          await getExpectedAccountCount();

          console.log("\n✓ Configuration updated!\n");
          console.log("You can now run: npm run test:integration\n");
          resolve();
        });
      });
    }

    // Get new config
    console.log("Please provide the following information:\n");
    await getSsoUrl();
    await getExpectedAccountCount();

    console.log("✓ Configuration saved!\n");
    console.log("You can now run: npm run test:integration\n");
  } catch (error) {
    console.error("\n✗ Setup failed:", error);
    process.exit(1);
  }
}

main();
