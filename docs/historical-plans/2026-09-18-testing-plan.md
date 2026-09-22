# Testing plan

**Goal:** catch AWS start-page changes before users do, and catch cross-browser permission
bugs, without needing a live AWS login for every test run.

Written 2026-09-18. This is a working plan, not a permanent document — it is kept in
`docs/historical-plans/` as a record of the reasoning, not as live documentation.

The Firefox harness rationale is drafted separately in
`tests/FIREFOX_EXTENSION_HARNESS.md`, because it must
survive as long as the harness itself does. **That content should not stay in its own file — it
belongs as a section in `docs/temporary-code.md`**, alongside the project's other deliberately
temporary code and its removal conditions. See [Phase 4](#phases).

## Why the current tests can't catch what broke

The extension's entire dependency on AWS is ~14 DOM selectors, all inline in
`src/utils/account-extractor.tsx` and `entrypoints/content.ts`:

| Selector | Used for | Fragility |
| --- | --- | --- |
| `[role="tabpanel"]` | mount point | medium |
| `table[role="treegrid"]` | accounts table | medium |
| `tr[data-selection-item="item"]` | account rows | medium |
| `th [data-testid="account-list-cell"]` | account name | medium |
| `td[0]` / `td[1]` (positional) | account ID / email | **high** — a column reorder breaks this silently |
| `button[aria-label="Next page"]` / `"Previous page"` / `[aria-label^="Page"][aria-current="true"]` | pagination | medium |
| `button[aria-expanded]` within row | expand roles | medium |
| `a[data-testid="federation-link"]` | role links | low |
| `[data-testid="role-creation-action-button"]` | access keys | low |
| `[data-testid="error-component-alert"]` / `[data-testid="retry-button"]` | role error / retry | low |
| `.awsui_content_mx3cw_1ehno_391` | role error message text | **certain to break** — hashed Cloudscape class, changes every AWS release |
| text match `"Loading accounts"` | loading gate | **high** — a copy change breaks it |

The existing integration tests only run against live AWS, need a manual login and a personal
`.test-config/config.json`, run headed with `slowMo: 100`, and assert against whatever account
count the developer happens to have. So they cannot run in CI, cannot run offline, cannot run
in Firefox, and when AWS changes something they just time out without saying which selector died.

## Four test layers

```
tests/
  fixtures/aws-start-page/
    meta.json           # capture date, selector census, expected accounts/pages
    dom/                # scenario snapshots: multi-page, single-page,
                        #   roles-expanded, roles-error, empty-org
    har/session.har.gz  # optional, Mode A only
    storage-state.json  # sanitised
  unit/                 # L1  happy-dom, no browser        — ms,      CI
  simulated/            # L2  Playwright + fixtures        — seconds, CI, Chrome + Firefox
  live/                 # L3  Playwright + real AWS        — manual, gated
  support/
    firefox-extension.ts  # RDP install helper (rationale: docs/temporary-code.md)
    serve-fixture.ts      # routes https://fixture.awsapps.com/** from disk
scripts/
  capture-fixture.ts    # log in once, record everything, sanitise
  check-fixture-drift.ts # live selector census vs meta.json
```

Fixtures are a **single copy** at a stable path, not dated directories. Old captures have no
consumer — AWS ships one start page to everyone, so there is no scenario where we run the suite
against September's structure *and* November's. More importantly, a stable path means
`git diff tests/fixtures/` after a re-capture answers the one question that matters: *what did
AWS actually change?* Dated directories turn every re-capture into an add + delete with no
diff at all. Subdivision is by **scenario**, not date.

### L1 — selector unit tests (highest value per hour)

Extract every AWS-page selector into `src/utils/aws-page/` (`selectors.ts` + `parse.ts`), with
the DOM-reading functions taking a `root: ParentNode` instead of reaching for global `document`.
`extractAccountsFromCurrentPage`, `getCurrentPageNumber`, `hasNextPage` and the role-row parsing
then become pure functions, testable against a saved HTML snapshot in happy-dom.

Sub-second, runs inside the existing `npm test`, and reports exactly which field stopped
parsing. This layer alone would have caught the breakage that started this work.

### L2 — simulated end-to-end (the workhorse)

Real built extension, real browser, fixture page, **both Chrome and Firefox**, headless.

No local HTTPS server or certificate needed: intercept `https://fixture.awsapps.com/**` with
`context.route()` / `routeFromHAR()` and fulfil from disk. That hostname matches the content
script's `https://*.awsapps.com/start/` pattern, so the extension injects exactly as it does in
production. Verified working in Firefox on 2026-09-18.

Deterministic fixtures mean sharp assertions — `expect(accounts).toHaveLength(63)` with exact
names, IDs and emails — instead of today's `expectedAccountCount` read from personal config.

### L3 — live tests (parity check)

The **same spec files** as L2, parameterised by target, run manually against real AWS. This is
how we answer "does the simulation copy the real behaviour": the same assertions passing in both
modes, rather than a separately hand-written live suite that can drift.

### L4 — drift check

`npm run fixture:check` logs into real AWS and runs a selector census — for each named selector,
does it still match, and with what cardinality and shape — then diffs against `meta.json` and
prints a readable report. One page load, no extension, fast. This is the early-warning signal
for AWS shipping a new frontend.

## Fixture capture

`npm run fixture:capture` launches headed Chromium, waits for the developer to log in, then
drives a scripted tour (wait for table → paginate every page → expand two accounts for roles →
force a role error if reachable), saving a DOM snapshot per step plus a HAR.

**Mode B — DOM snapshots + simulator script (recommended baseline).** Serve captured DOM as a
static page with a ~100-line `simulator.js` reimplementing *only* the behaviours the extension
depends on: next/prev swaps the `tbody` for the next page's snapshot, the row expand button
inserts the captured role row after a delay, plus a "Loading accounts" state and an
error + retry state. Fast, deterministic, identical in both browsers. The simulator is a stated
behaviour contract; L3 is what keeps it honest.

**Mode A — HAR replay (higher fidelity, needs a spike).** `context.routeFromHAR()` plus seeded
`storageState` so AWS's *own* JS boots locally and renders the DOM authentically — pagination and
role loading then work for free, including behaviours we didn't think to model. Unresolved risk:
the start page may client-side gate on a bearer token's expiry and bounce to login before making
any API calls. Half-day spike; if it works it is strictly better, and Mode B remains the fast path.

### Sanitisation is mandatory

The repo is public (`infoxchange/aws-launcher-organiser`) and captures contain real account IDs,
emails, role names and tokens. The capture script applies a deterministic mapping (real ID →
synthetic 12-digit ID, consistent across DOM *and* HAR bodies so they stay coherent), strips
cookies, auth headers and SAML assertions, and drops images and fonts.

Add `fixture:verify-clean`, which greps the fixture directory for anything resembling a real
account ID, the company domain, or a JWT, and wire it into the pre-commit hook.

## Cross-browser

**Chrome** is straightforward: the current `launchPersistentContext` approach works; add
`channel: "chromium"` so extensions run headless in CI.

**Firefox** needs a custom RDP install helper, because Playwright has declared Firefox extension
automation out of scope. Full rationale, ticket links and deletion criteria are drafted in
`tests/FIREFOX_EXTENSION_HARNESS.md` — that content is
destined for a section in `docs/temporary-code.md` (Phase 4).

We test the **real extension** in both browsers rather than injecting a stubbed content script,
because the bugs worth catching live in the manifest and background page. This is not
theoretical — see below.

## Permissions

This is where the two browsers diverge most, and where a real bug already exists.

**Firefox: fully testable.** `extensions.webextOptionalPermissionPrompts=false` skips the prompt
UI and silently approves, settable via `firefoxUserPrefs`. Leave it `true` to test the prompt
path. This exercises the real `permissions.ts` → background round-trip.

**Chrome: the prompt cannot be automated.** Playwright closed
[#32755](https://github.com/microsoft/playwright/issues/32755) as out of scope. Two substitutes:

- `ExtensionSettings` enterprise policy with `runtime_allowed_hosts` — the officially recognised
  way to pre-grant optional host permissions with no user action
  ([w3c/webextensions#260](https://github.com/w3c/webextensions/issues/260)). Easy in a Linux CI
  container (`/etc/opt/chrome/policies/managed/*.json`), awkward on macOS.
- Pin the extension ID with a manifest `key` in test builds and pre-seed the persistent profile
  with the permission already granted.

So Chrome gets "already granted" and "never granted / denied" coverage, not the click-through.
That is enough, because the permission-gated paths (auto-update config fetch, `FETCH_IMAGE`)
fail closed.

### The bug this layer already found

`wxt.config.ts` declares `optional_host_permissions: ["<all_urls>"]`, but that key is
**MV3-only** — WXT silently drops it from the MV2 build, so the shipped Firefox manifest is
`"permissions": ["storage","alarms"]` with no host permissions, required or optional.
`permissions.request()` can therefore never grant anything on Firefox, and
`SettingsDialog.tsx:147` UA-sniffs Firefox and skips the request entirely, commenting
"optional_host_permissions should allow fetch".

Driving the real settings UI in headless Firefox on 2026-09-18:

| Config server | Manifest | Result |
| --- | --- | --- |
| sends `Access-Control-Allow-Origin: *` | as shipped | ✅ "Config updated — 1 top-level group(s), version 1." |
| no CORS headers | as shipped | ❌ "Error: NetworkError when attempting to fetch resource." |
| no CORS headers | `+ "<all_urls>"` | ✅ "Config updated — 1 top-level group(s), version 1." |

**Auto-update on Firefox only works if the remote config server happens to send permissive CORS
headers.** Point it at a bucket or internal endpoint that doesn't, and it fails with an opaque
network error. Row three proves the fix: a real host permission bypasses CORS.

Fix: declare `optional_permissions: ["<all_urls>"]` for the Firefox target via a per-browser
manifest in `wxt.config.ts`, then delete the UA-sniffing branch so `ensureUrlPermission` runs on
Firefox too.

This is tracked as a defect separate from this plan — it is a user-facing bug, not test work.

## Bugs to fix on the way through

- `tests/integration/extraction.test.ts:20` calls `cleanupTestContext` but line 9 only imports
  `createTestContext` — that `afterAll` throws a `ReferenceError`.
- `closeBrowser()` is never called (a comment claims "called from vitest test reporter", but no
  such reporter exists) — the persistent context leaks a browser process per run.
- `playwright` is in `dependencies`, should be `devDependencies`.
- `src/utils/test-*.ts` are test-only helpers living in `src/`; they belong under `tests/`.
- Add a runtime selector-failure signal: the error path already falls back to the original AWS
  list (`AccountTreeTable.tsx:872`) — have it name the selector that failed, so a user bug report
  identifies which one AWS changed.

## Phases

Status as of 2026-09-18: phases 0–4b are implemented and passing. What actually got built and
how it differs from the sketch above is recorded in "Outcome" at the end of this document.

| Phase | Work | Effort | Unlocks |
| --- | --- | --- | --- |
| 0 | Fix the bugs above; move helpers; tidy `test:*` scripts | 1–2 h | clean base |
| 1 | `src/utils/aws-page/` adapter + L1 unit tests against a hand-saved snapshot | 0.5–1 d | catches this class of breakage in CI, in milliseconds |
| 2 | `capture-fixture.ts` + sanitiser + `verify-clean` guard | 1–1.5 d | offline fixtures |
| 3 | L2 simulated suite, Mode B, Chrome, headless, in CI | 1 d | real CI coverage |
| 4 | Firefox via our RDP helper; same suite in both browsers. Fold the rationale drafted in `tests/FIREFOX_EXTENSION_HARNESS.md` into a section of `docs/temporary-code.md` (creating that file if it doesn't exist yet) and delete the standalone draft. | 0.5–1 d | cross-browser |
| 4b | Permission suite (see [Chrome permission strategy](#chrome-permission-strategy)): granted path via the test-only manifest variant in both browsers; denied path stubbed at unit level; manifest contract test over the shipped manifests. Covers `CHECK_PERMISSION`, `REQUEST_PERMISSION`, `TEST_REMOTE_CONFIG`, `FETCH_IMAGE` against real background contexts. | 0.5 d | the bug class above |
| 4c | MV3-vs-MV2 background lifetime test — force service-worker termination, assert content-script message round-trips still succeed | 0.5 d | the Chrome/Firefox background asymmetry |
| 5 | L3: parameterise the suite over `simulated` / `live`; `fixture:check` drift report | 0.5–1 d | proves the simulation is faithful |
| 6 | Mode A HAR spike — **optional**, only if Mode B proves insufficient | 0.5 d | higher fidelity if it lands |

Phases 1 and 2 are independent and deliver most of the value. Phases 3–5 turn it into a safety
net that catches AWS changes before users report them.

## CI

L1 + L2 run on every push (fixtures are committed, no auth needed). L3 and L4 stay manual,
gated behind an env var, because they need a real AWS login.

Note: `npm test` is `vitest` without `--run`, which works in CI only because vitest
auto-detects `process.env.CI`. Worth making explicit.

## Decisions

All settled as of 2026-09-18.

1. **Fixture fidelity: Mode B is the baseline.** Mode A (HAR replay) stays an optional
   experiment in Phase 6, run only if Mode B proves insufficient.
2. **Fixtures are committed to the public repo**, relying on the deterministic sanitiser plus
   the `fixture:verify-clean` pre-commit guard described above. Not git-lfs, not a private side
   repo — a stable in-repo path is what makes `git diff` after a re-capture readable, which is
   the whole point.
3. **Chrome permission pre-granting: use a test-only manifest variant**, not policy files and
   not profile seeding. See below.

### Chrome permission strategy

Chrome cannot answer its own extension permission prompt under automation, and the failure mode
is worse than an error. Verified 2026-09-18 with the current build: clicking **Test** in the
settings dialog logs `[permissions] Requesting permission for: http://127.0.0.1/*` and then
**hangs indefinitely** — the prompt opens, nothing can click it, the promise never resolves, and
the UI sits on a spinner forever.

So the granted path is exercised by building a **test-only variant of the extension** with the
host permission pre-declared as required, which needs no user interaction and no prompt:

| Target | Key to set in the test variant |
| --- | --- |
| Chrome MV3 | `host_permissions: ["<all_urls>"]` |
| Firefox MV2 | `permissions: ["<all_urls>"]` |

Both verified end to end: with the permission pre-declared, the settings-dialog connection test
reports `"Config updated — 1 top-level group(s), version 1."` against a config server sending
**no** CORS headers, in both browsers. With the shipped manifest it fails (Firefox:
`"Error: NetworkError when attempting to fetch resource."`; Chrome: hangs as above).

Note the MV2/MV3 asymmetry — host permissions live in `permissions` for MV2 but must be in
`host_permissions` for MV3. Putting `<all_urls>` in MV3's `permissions` array is silently
ineffective (`permissions.contains()` returns false), which is easy to get wrong.

Guard against drift between the variant and the real artifact with a **manifest contract test**:
assert that each shipped manifest declares exactly the expected permission keys. That covers
what the variant cannot — that the real thing asks for the right permissions.

**Rejected alternatives:**

- *Enterprise policy* (`ExtensionSettings` / `runtime_allowed_hosts`) — the only mechanism that
  grants an optional permission without altering the artifact, so keep it in mind as a CI-only
  extra where dropping a JSON file into `/etc/opt/chrome/policies/managed/` is trivial. Rejected
  as the primary because it needs root-ish setup on macOS and so behaves differently locally
  than in CI.
- *Pinned-`key` + pre-seeded profile* — depends on Chrome's internal `Secure Preferences` layout
  and its MAC validation. Undocumented, version-fragile, and needs the extension ID pinned too.

**Testing the denied path** belongs in unit tests, not browser tests: neither browser lets
automation click "deny", so stub the background's `REQUEST_PERMISSION` response as
`{ granted: false }` and assert the UI degrades correctly.

### Testing gotcha: Chrome loopback restrictions

Chrome's local-network-access rules block `public origin → loopback` fetches. A content-script
fetch from `https://fixture.awsapps.com` to `http://127.0.0.1:PORT` is refused with
*"Permission was denied for this request to access the `loopback` address space"*, independent of
extension permissions. Fetches from the background service worker **with** a host permission are
fine. Keep the config-fetch under test in the background, or the test will fail for a reason
unrelated to what it is asserting.

## Outcome

> **Post-implementation addendum — added 2026-09-18 by Claude, during implementation.**
> The rest of this document is the plan as written beforehand and is frozen. This section
> records what was actually built and where it diverged, so a reader does not have to diff the
> plan against the code to find out.

Differences from the plan as originally written, and why:

### Root cause found

AWS marks the final page's Next button with `aria-disabled="true"` plus a hashed
`…button-disabled…` class and `tabindex="-1"`, and **never** the `disabled` attribute. The old
`hasNextPage()` checked only the attribute, so it stayed true forever on the last page:
extraction ran to its 100-page safety limit, re-scraping page 4 with no dedupe, and reported
979 accounts instead of 307. Role loading then broke as a *consequence*, not a separate fault —
duplicated accounts carried `pageNumber` 5–100, so `getAccountRoles` asked `navigateToPage` for
pages that do not exist, 5 seconds per dead click, while holding the exclusive page lock.

The role selectors (`federation-link`, `role-creation-action-button`) had not changed at all.

### Fixes, all covered by tests

- `isControlDisabled()` checks `disabled`, `aria-disabled` and the class fragment, so losing any
  one signal cannot resurrect the bug.
- `goToNextPage()` returns `false` when the account list did not actually change, instead of
  `true` on timeout. Callers treat that as "pagination finished".
- Accounts are deduplicated by id, and extraction stops if a page yields nothing new.
- Account rows are distinguished from the expanded role row, which carries the same
  `data-selection-item="item"` marker — previously it was excluded only by accident, because it
  happens to lack an account-name cell.
- The hashed `.awsui_content_mx3cw_1ehno_391` error-message selector is gone; the alert's own
  text is read instead.
- Extraction failure now names the selector that stopped matching rather than reporting an empty
  list.

### Test layers built

| Layer | Location | Count | Runtime |
| --- | --- | --- | --- |
| L1 unit — page adapter vs fixtures | `src/utils/aws-page/parse.test.ts` | 25 | ~1s |
| L1 unit — permission plumbing | `src/utils/permissions.test.ts` | 15 | <1s |
| L2 simulated — extraction, both browsers | `tests/simulated/extraction.test.ts` | 10 | ~4min |
| L2 simulated — permissions, both browsers | `tests/simulated/permissions.test.ts` | 3 + 1 skipped | ~2min |

Unit tests live beside their source in `src/`, following the existing repo convention, rather
than in `tests/unit/` as sketched above.

### Deviations worth knowing

- **Fixture sizes.** Full sanitised pages are ~580KB each and table-only fragments ~485KB,
  because Cloudscape's class soup dominates. ~2.9MB of fixtures total. Acceptable, but if it
  becomes annoying, stripping class attributes down to the ones actually matched would shrink it
  by an order of magnitude — the `…button-disabled…` class is load-bearing, so it cannot be a
  blanket strip.
- **Scripts are stripped during sanitising.** This removes the main leak vector (bootstrap JSON
  embedding the tenant and account list) and Mode B does not want AWS's JS running anyway. It
  also means the fixtures are inert without `simulator.js`.
- **The capture report's redaction was too loose at first.** It printed any short digit-free
  string verbatim as a "structural label", which leaked an account name. Text is now never
  printed verbatim; attribute values are printed only from an explicit allowlist, with
  `aria-label` matched against known-safe shapes.
- **`tsx` + `page.evaluate` needs a shim.** esbuild's `keepNames` rewrites named inner functions
  as `__name(fn, "fn")`, and that helper does not exist in the page. Both Playwright-driving
  scripts install a one-line no-op `__name` shim.
- **The simulator must attach listeners synchronously.** The extension clicks Next within
  milliseconds of the content script running, so a simulator that `await`ed its fixture loads
  before wiring handlers lost that first click and looked exactly like "pagination finished
  after one page".
- **Chrome's permission prompt is worse than unclickable.** It hangs the connection test
  indefinitely, so the ungranted-permission case is skipped on Chrome and covered by unit tests.
- **The Firefox `optional_permissions` fix is only half a fix.** The manifest key is now correct
  per manifest version, but `permissions.request()` is called from the background page, which has
  no user gesture, and Firefox denies that outright. Genuinely granting an optional permission on
  Firefox needs an extension page — which would also invalidate the "no extension pages"
  assumption that lets the Firefox harness avoid patching Playwright's browser. Still open.

### Not yet built

- Phase 5: the live suite (`tests/live/`) sharing specs with `tests/simulated/`. The drift check
  (`npm run fixture:check`) is written but has not been run against the live portal.
- Phase 6: the Mode A HAR spike (optional).
- Fixture scenarios beyond what one capture produced: no single-page, empty-org or role-error
  fixtures yet, so the simulator does not emulate error/retry states.
