/**
 * Guard against committing real tenant data in fixtures.
 *
 * Usage:
 *   npm run fixture:verify-clean
 *
 * Exits non-zero (and names the offending file/line) if anything in tests/fixtures/ looks like
 * real data. Intended for the pre-commit hook as well as manual runs.
 *
 * This is deliberately paranoid: a false positive costs a minute, a false negative publishes
 * account IDs to a public repo.
 */

import fs from "node:fs";
import path from "node:path";

const FIXTURE_DIR = path.join(process.cwd(), "tests", "fixtures");

/** Values the sanitiser is known to produce, which must not be flagged. */
const ALLOWED = [
  /^fixture\.awsapps\.com$/,
  /^aws-account-\d+@example\.com$/,
  /^«REDACTED_TOKEN»$/,
  /^«REDACTED_BLOB»$/,
];

interface Finding {
  file: string;
  line: number;
  rule: string;
  sample: string;
}

const RULES: { name: string; re: RegExp; allow?: (m: string) => boolean }[] = [
  {
    name: "aws-account-id",
    // Synthetic ids all start 1000 and are multiples of our stride; anything else 12-digit is suspect.
    re: /\b\d{12}\b/g,
    allow: (m) => /^1000\d{8}$/.test(m),
  },
  {
    name: "email",
    re: /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g,
    allow: (m) => /@example\.com$/.test(m),
  },
  {
    name: "sso-host",
    re: /\b[a-z0-9-]+\.awsapps\.com\b/gi,
    allow: (m) => m.toLowerCase() === "fixture.awsapps.com",
  },
  {
    name: "jwt-like",
    re: /\b[A-Za-z0-9_-]{30,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\b/g,
  },
  {
    name: "long-opaque-blob",
    re: /\b[A-Za-z0-9+/]{200,}={0,2}\b/g,
  },
  {
    name: "script-tag",
    // Scripts are stripped by the sanitiser; if one survived, assume it carries page state.
    re: /<script\b/gi,
  },
  {
    name: "aws-access-key-id",
    re: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g,
  },
  {
    name: "bearer-token",
    re: /\b(?:Bearer|x-amz-sso_bearer_token)\b\s*[:=]?\s*\S{20,}/gi,
  },
];

function walkFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkFiles(full));
    else out.push(full);
  }
  return out;
}

function main() {
  const files = walkFiles(FIXTURE_DIR);
  if (files.length === 0) {
    console.log("ℹ No fixtures present — nothing to check.");
    return;
  }

  const findings: Finding[] = [];

  for (const file of files) {
    const rel = path.relative(process.cwd(), file);
    const text = fs.readFileSync(file, "utf8");
    const lines = text.split("\n");

    lines.forEach((line, i) => {
      for (const rule of RULES) {
        rule.re.lastIndex = 0;
        for (const match of line.matchAll(rule.re)) {
          const value = match[0];
          if (rule.allow?.(value)) continue;
          if (ALLOWED.some((re) => re.test(value))) continue;
          findings.push({
            file: rel,
            line: i + 1,
            rule: rule.name,
            // Truncate so the guard's own output cannot become the leak.
            sample: value.length > 24 ? `${value.slice(0, 12)}…(${value.length} chars)` : value,
          });
        }
      }
    });
  }

  console.log(`Checked ${files.length} fixture file(s) against ${RULES.length} rules.`);

  if (findings.length === 0) {
    console.log("✅ Clean — no real-looking data found in tests/fixtures/");
    return;
  }

  // Group so one systemic problem doesn't print thousands of lines.
  const byRule = new Map<string, Finding[]>();
  for (const f of findings) {
    const list = byRule.get(f.rule) ?? [];
    list.push(f);
    byRule.set(f.rule, list);
  }

  console.error(`\n❌ ${findings.length} possible leak(s) found:\n`);
  for (const [rule, list] of byRule) {
    console.error(`  ${rule} — ${list.length} occurrence(s)`);
    for (const f of list.slice(0, 5)) {
      console.error(`    ${f.file}:${f.line}  ${f.sample}`);
    }
    if (list.length > 5) console.error(`    …and ${list.length - 5} more`);
  }
  console.error(
    "\nFix the sanitiser (scripts/sanitise-fixture.ts) and regenerate — do NOT commit.\n"
  );
  process.exit(1);
}

main();
