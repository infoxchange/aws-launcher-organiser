import { execSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { toJSONSchema } from "zod";
import { RemoteConfigSchema } from "../src/utils/config-schema.js";

try {
  const schema = toJSONSchema(RemoteConfigSchema);

  const outputPath = resolve("./config-schema.json");
  writeFileSync(outputPath, JSON.stringify(schema, null, 2));
  console.log(`✓ Generated schema at ${outputPath}`);

  // Format with biome
  execSync("biome format --write config-schema.json", { stdio: "inherit" });
  console.log("✓ Formatted schema with biome");
} catch (err) {
  console.error("Failed to generate schema:", err);
  process.exit(1);
}
