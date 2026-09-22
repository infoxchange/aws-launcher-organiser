# Testing

How this extension is tested, why the layers are split the way they are, and how to regenerate
the fixtures the tests run against.

## The problem this design solves

The extension has no API. It reads the AWS access portal by scraping its DOM, so AWS can break it
at any time by shipping new markup — and has. When that happens the failure is silent and
shapeless: accounts stop appearing, or appear in the wrong number, with nothing pointing at the
cause.

Tests therefore have two jobs that pull in opposite directions:

1. run constantly, offline, in CI, with no AWS login; and
2. reflect what AWS's page *actually* looks like today.

The split below buys (1) with captured fixtures, and keeps (2) honest with a capture workflow and
a drift check against the live portal.

## The layers

| Layer | Where | What it proves | Needs |
| --- | --- | --- | --- |
| Unit | `src/**/*.test.ts` | Selectors and parsing against captured AWS markup; grouping, sorting and permission logic | nothing |
| Simulated | `tests/simulated/` | The real built extension, in real Chrome and Firefox, against captured fixtures | a build |
| Live | `tests/live/` | The **same contract specs** as the simulated suite, against the real portal | AWS login |
| Legacy live | `tests/integration/` | Older live tests, asserting against a personally-configured account count | AWS login |
| Drift check | `npm run fixture:check` | Whether AWS's markup still matches what the fixtures captured | AWS login |

Unit and simulated tests run in CI. Live tests and the drift check need an AWS session, so they
stay manual.

```bash
npm test                      # unit
npm run test:simulated        # both browsers, builds first
npm run test:simulated:chrome # Chrome only — faster while iterating
npm run test:live             # same contract specs, against real AWS
npm run test:integration      # older live suite
```

### Why unit tests sit next to the source

`src/utils/aws-page/parse.test.ts` lives beside `parse.ts` rather than under `tests/`, following
the convention already used by `account-extractor.test.ts` and `sortAccounts.test.ts`. Only tests
that need a browser live under `tests/`.

## Fixtures

Fixtures are sanitised captures of the real AWS access portal, committed to the repo, in
`tests/fixtures/aws-start-page/`:

```
meta.json                  capture date, expected totals, per-file selector census
dom/page-N.html            full sanitised page, scripts stripped
dom/table-page-N.html      just the table + pagination — what unit tests parse
dom/roles-expanded.html    a page with one account's roles expanded
simulator.js               behaviour layer (see below)
```

### One copy, not dated snapshots

There is a single set of fixtures at a stable path. AWS serves one version of the portal to
everyone, so there is no scenario where the suite runs against September's markup *and*
November's — old captures have no consumer.

More importantly, a stable path is what makes `git diff tests/fixtures/` after a re-capture
answer the question that matters: **what did AWS actually change?** Dated directories would turn
every re-capture into an add plus a delete, with no diff at all.

### Regenerating them

```bash
npm run fixture:capture       # opens a browser; log in when prompted
npm run fixture:sanitise      # .fixture-capture/ -> tests/fixtures/
npm run fixture:verify-clean  # refuses to pass if anything looks real
```

`fixture:capture` writes raw, **unsanitised** DOM to `.fixture-capture/`, which is gitignored and
must never be committed. It also writes `structure-report.txt`, a redacted structural summary
that is safe to paste into an issue or a chat.

The capture runs with the extension **not** loaded, so the fixtures contain AWS's own DOM rather
than our injected UI.

### Sanitising, and why the guard is paranoid

This repo is public. Captures contain real account IDs, names, emails and tokens.
`fixture:sanitise` replaces them with deterministic synthetic values — the Nth distinct account ID
maps to the same synthetic ID in every file, so cross-page references stay coherent — and strips
every `<script>` tag, which is both the main leak vector (bootstrap JSON embedding the tenant and
account list) and unnecessary, since the simulator supplies behaviour instead.

`fixture:verify-clean` then greps the result for anything resembling real data and fails the
commit if it finds any. It runs from the pre-commit hook and in CI.

Account *names* have no detectable pattern, so the guard cannot check them. That is why the
sanitiser replaces them structurally, via the name cell, rather than by regex — and why a
re-capture is worth eyeballing before committing.

### The simulator

Captured DOM is inert: AWS's JavaScript is stripped, so clicking Next or expanding a row does
nothing. `simulator.js` re-implements **only** the behaviours the extension depends on —
pagination, including the disabled-state markup AWS really uses, and asynchronous role expansion.

It is a stated contract about how the portal behaves, and it is checked rather than assumed:
`tests/shared/portal-contract.ts` holds the specs, and **both** the simulated suite and the live
suite run them. If the simulator drifts from how AWS really behaves, the live run fails on the
same assertion the simulated run passes.

The sharpest of those specs asserts that the final page's Next button is disabled via
`aria-disabled` and a `button-disabled` class, and **not** via the `disabled` attribute. That is
the exact shape the simulator reproduces, so if AWS ever switches to a plain `disabled`
attribute, the live run says so.

Specs in the shared contract are phrased without magic numbers — self-consistency and shape —
because the live org's account count is not known ahead of time. The simulated suite adds the
exact-count assertions separately, since `meta.json` tells it what was captured.

Three things it gets right on purpose, because getting them wrong produced confusing failures:

- **The portal renders progressively.** Rows stream in and the pagination controls appear after
  them. Fixtures that render instantly hid a real bug: extraction read a partly-populated table
  and, seeing no Next button yet, concluded there were no further pages. The simulated suite
  passed while the live portal returned a third of the accounts. The simulator now holds back
  most rows and the pagination controls briefly, so that race fails in CI. It also blacks out
  the pagination controls for a moment on **every** page change, which is what the real portal
  does and what made navigation give up on the wrong page.

- **Listeners attach synchronously**, before fixture pages finish loading. The extension clicks
  Next within milliseconds of the content script running; a simulator that awaited its loads first
  would silently drop that click, which looks exactly like "pagination finished after one page".
- **Roles appear after a delay**, so the extension has to wait for the row rather than assuming
  it is synchronously present.

Not simulated: sorting, filtering, the applications tab, and the role-loading retry loop. Those
need their own captured fixtures first — see "Hand-authored fixtures" below.

### Hand-authored fixtures

`dom/table-roles-error.html` is **not** a capture. A role-loading failure cannot be produced on
demand, so its markup is reconstructed from the selectors the extension already used. Tests built
on it therefore cover our error-handling control flow — is the alert detected, is the message
read without a hashed class, is the retry button found — and **not** AWS's real error markup.

The file carries that warning in a comment at the top. `fixture:sanitise` only writes the files
it derives from a capture, so hand-authored fixtures survive a regeneration untouched. If a real
error state is ever captured, it should replace this one.

### Why not HAR replay

An alternative was recorded considered and rejected: replay a HAR of the real session so AWS's own
JavaScript boots and renders the DOM authentically, giving pagination and role loading for free.

It was left unbuilt because the simulator turned out to be sufficient and much cheaper to reason
about — and because HAR replay carries an unresolved risk that the portal gates on a bearer
token's expiry client-side and bounces to login before making any API calls. Revisit only if the
simulator starts needing to model behaviour it cannot fake convincingly.

### Staleness

`meta.json` records the capture date, and the simulated suite warns when fixtures are more than
90 days old. The date lives in the file rather than in git history because a test run can read a
JSON field but cannot consult a log.

## Races the fixture suite cannot reproduce

Some bugs need a read to land inside a window of a few hundred milliseconds. The
"Account row not found for id: …" failure was one: the portal removes its pagination controls
while re-rendering, and code that read the current page during that window guessed wrong.

Scrolling a fixture page harder does not make that reliable. Two attempts at reproducing it in
`tests/simulated/roles.test.ts` passed even with the fix reverted, which means a green run there
proves nothing about that bug.

**Where a race comes down to a decision, extract the decision and unit-test it.**
`decideNavigationStep()` is a pure function precisely so the wrong answer — "current page
unknown, so assume page 1" — can be pinned deterministically. Reverting the fix fails those
tests in milliseconds, where the browser test stayed green.

The browser test still earns its place: it covers roles being scoped to the right account, and no
role-loading errors under cross-page churn. It just is not the guard for that specific race.

## Drift check

```bash
npm run fixture:check
```

Logs into the real portal, counts every selector the extension depends on, and diffs the result
against the fixture's census. One page load, no extension. When something has moved it names the
selector, instead of letting it surface weeks later as an empty account list.

It also dumps the Next-page button's attributes, because the specific failure that broke
pagination — a control marked disabled without the `disabled` attribute — is invisible to a
count-only census.

## Serving fixtures to a browser

`tests/support/serve-fixture.ts` intercepts requests for `https://fixture.awsapps.com/**` and
fulfils them from disk. No local server and no TLS certificate.

The hostname matters: it has to match the content script's `https://*.awsapps.com/start/` pattern
so the extension injects exactly as it does in production. Anything not found on disk is aborted
rather than passed through, so a fixture test can never accidentally reach real AWS.

## Loading the real extension

`tests/support/launch-extension.ts` launches Chrome or Firefox with the built extension. Firefox
needs a workaround — Playwright cannot load extensions there — documented in
[docs/temporary-code.md § "Firefox extension test harness"](temporary-code.md).

Tests use the **real built artifact**, never a stubbed content script. The bugs worth catching
live in the manifest and the background page, and a stub has neither. See
[docs/permissions.md](permissions.md) for a case where exactly that mattered.
