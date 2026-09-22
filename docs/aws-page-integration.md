# Reading the AWS access portal

The extension has no AWS API. Everything it knows comes from scraping the DOM of the AWS access
portal (`https://*.awsapps.com/start/`), a Cloudscape single-page app that AWS rewrites without
notice or versioning.

This document covers how that coupling is contained, what AWS's markup actually looks like, and
what to do when it changes.

## All selectors live in one module

`src/utils/aws-page/` is the only place allowed to know what AWS's DOM looks like.

- `selectors.ts` — every selector, named.
- `parse.ts` — pure functions that read a DOM, each taking an explicit `root: ParentNode`
  rather than reaching for the global `document`.

Everything else — `account-extractor.tsx`, the content script, the components — goes through it.

Three things follow from that, and they are the reason for the split:

1. **Unit tests need no browser.** Because the functions take a `root`, they can parse a captured
   fixture under happy-dom in milliseconds.
2. **The drift check and the tests measure the same thing.** `probeSelectors()` is shared, so
   "does this selector still match?" has one implementation.
3. **A breakage names itself.** `describeBrokenSelectors()` turns "no accounts found" into a
   message naming the selector that stopped matching.

### Never select on hashed Cloudscape classes

Class names like `awsui_content_mx3cw_1ehno_391` contain a build hash that changes on every AWS
release. One of these was used to read role-loading error text and had long since stopped
matching anything.

Where a class is genuinely the only signal available, match a **stable fragment** of it rather
than the whole thing — `DISABLED_CLASS_FRAGMENT` matches `button-disabled` within
`awsui_button-disabled_fvjdu_5ng4o_79` — and never rely on it alone.

## AWS behaviours worth knowing

### Pagination controls are not disabled with `disabled`

On the final page, the Next button looks like this:

```html
<button aria-label="Next page" tabindex="-1" aria-disabled="true"
        class="awsui_arrow_… awsui_button_… awsui_button-disabled_fvjdu_5ng4o_79">
```

There is **no `disabled` attribute**. A check for one returns "enabled" forever on the last page.

This caused the worst bug the extension has had: extraction never terminated, re-scraping the
final page up to its 100-page safety limit and reporting 979 accounts where the org had 307. Role
loading then broke as a side effect, because the duplicate accounts carried page numbers that do
not exist, and `navigateToPage` spent five seconds per dead click while holding the page lock.

`isControlDisabled()` therefore checks the `disabled` attribute, `aria-disabled`, **and** the
class fragment. Losing any one signal cannot resurrect the bug.

### Expanded role rows masquerade as account rows

When an account is expanded, AWS injects the roles as a sibling `<tr>` that carries the **same**
`data-selection-item="item"` marker as a real account row, distinguished only by
`aria-level="2"`:

```
<tr data-selection-item="item" aria-level="1">  account   → account-list-cell, account-federation-link
<tr data-selection-item="item" aria-level="2">  its roles → federation-link, role-creation-action-button
```

So the row selector alone over-counts accounts by one per expanded row. `isAccountRow()` decides
on the presence of the account name cell, with `aria-level` as a secondary signal — content is
the more durable of the two, since a flattened tree would drop the levels but still need a name.

### Pagination state, page numbers and totals

- The active page button uses `aria-current="true"` — not the standard `aria-current="page"`.
- `[data-testid="pagination-bar"]` no longer exists; the controls are a plain `<ul>` of
  `<li><button aria-label="Page N">`.
- There is no `aria-rowcount` and no total-accounts figure anywhere in the DOM, so the only way
  to know the real total is to page through and count. That makes deduplication load-bearing
  rather than defensive.

### The page renders progressively, and pagination arrives last

Rows stream into the table and the pagination controls appear *after* them. There is a window,
roughly a second on a real portal, where the account table is partly populated and there is no
Next button at all.

Reading the page during that window produces two failures at once: a truncated account list, and
— because `getNextPageButton()` returns null — a `hasNextPage()` of false, which is
indistinguishable from being on the last page. Extraction stops after page one having found a
fraction of the accounts. Observed live: 99 of 100 rows and no pagination, against 100 rows and
4 pages a few seconds later.

`hasPaginationControls()` exists to tell those two states apart, and extraction waits via
`waitForPortalReady()` for the loading indicator to clear, the row count to hold steady, and the
pagination controls to exist before reading anything.

`simulator.js` reproduces this delay deliberately, so the race is reproducible in CI rather than
only against the live portal.

### The pagination controls vanish on every page change, not just at load

They are removed and re-added while the portal re-renders. Two consequences, both of which
caused real bugs:

- **A missing control is not a disabled control.** `getCurrentPageNumber()` returns `null` when
  it cannot tell, rather than defaulting to page 1. It previously defaulted, so code on page 4
  believed it was on page 1, tried to move *forward* to reach page 3, hit the disabled Next
  button and gave up — silently leaving the portal on page 4. The account it then looked for was
  not there, producing `Account row not found for id: …` for a scattering of accounts whenever
  several pages' worth of roles loaded at once.
- **A failed page turn is not proof the page is unreachable.** `navigateToPage()` retries until a
  deadline, re-reading the current page each time, instead of breaking on the first failure.

Extraction re-checks that pagination is ready before concluding there are no further pages, for
the same reason.

### Roles load asynchronously, and must be scoped to their own row

Expanding an account triggers a network request; the role row appears some time later. Code must
**wait for that specific row** and parse only within it.

Never fall back to searching the document when the row has not appeared. Every other expanded
account's roles are in the document too, so a document-wide search attributes all of them to
whichever account is being read — which is what made accounts appear to have many more roles
than they really do.

Resolve the row by account id on **every** poll rather than holding an element reference. The
portal re-renders its table, which detaches the original `<tr>`; waiting on a detached node's
`nextElementSibling` waits forever, and shows up as "the expanded row never rendered" for
accounts that are otherwise fine. If a re-render also collapsed the row, expand it again.

### Two tab panels

`[role="tabpanel"]` matches twice (accounts and applications). The accounts table is inside the
first, which is what `document.querySelector` returns — correct today, but by luck rather than by
design.

## Pagination must prove it moved

`goToNextPage()` compares a fingerprint of the account IDs on the page before and after the
click, and returns `false` if nothing changed. Callers treat that as "pagination is finished".

The previous implementation resolved `true` on timeout, so a click that did nothing was
indistinguishable from a successful page turn. Combined with the `aria-disabled` miss, that is
what let extraction loop.

On top of that, `extractAccountsProgressive` deduplicates by account ID and stops if a page
contributes nothing new — so even an unforeseen pagination change cannot inflate the count again.

## When AWS changes the page

1. `npm run fixture:check` — names which selectors stopped matching.
2. `npm run fixture:capture` — the structure report shows the new markup, redacted.
3. Update `selectors.ts` / `parse.ts`, and add a unit test pinning the new shape.
4. `npm run fixture:sanitise && npm run fixture:verify-clean` — refresh fixtures. Review the
   `git diff`; that diff *is* the record of what AWS changed.

See [docs/testing.md](testing.md) for the fixture workflow in full.
