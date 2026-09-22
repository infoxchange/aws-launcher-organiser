import type { Configuration } from "lint-staged";

/**
 * @see docs/temporary-code.md § "Whole-project typecheck in the pre-commit hook"
 *
 * The type check is a function rather than a command string so lint-staged appends no
 * filenames to it: `tsc` ignores tsconfig.json entirely the moment it is given file
 * arguments, and the per-file wrappers that work around that miss errors a staged change
 * causes in files that are not themselves staged.
 */
export default {
  "*.{ts,tsx,js,jsx}": ["biome check --verbose --error-on-warnings --write"],
  "*.{ts,tsx}": () => "tsc --noEmit",
  "*.json": ["biome format --write"],
  "*": ["npm run generate-schema -- && git add config-schema.json || true"],
  "tests/fixtures/**": ["npm run fixture:verify-clean --"],
} satisfies Configuration;
