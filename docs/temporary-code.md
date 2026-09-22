# Temporary code

Code we have deliberately taken on that should not live here forever: workarounds for upstream
gaps, shims, and anything kept only until a specific external thing changes.

Each entry says **why it exists**, **what would have to be true to delete it**, and links the
tickets that would make that true — so the decision can be re-checked rather than re-litigated.

Add an entry when you add a workaround whose removal depends on something outside this repo.

---

## Firefox extension test harness

Loading the real built extension into real Firefox for tests.

**Status as of 2026-09-18.** Re-check on each Playwright major upgrade, and whenever the Firefox
build moves from MV2 to MV3.

### The problem

We want integration tests that load the **real built extension** into **real Firefox**, because
the bugs we most need to catch live in the manifest and the background page — not in the
content script's DOM logic. A stubbed content script cannot catch them.

Concrete example that motivated this harness: `optional_host_permissions` is an MV3-only
manifest key, so WXT silently drops it from the Firefox MV2 build. The shipped Firefox
manifest therefore declares **no host permissions at all**, and the auto-update config fetch
only succeeds when the remote server happens to send permissive CORS headers. That defect is
invisible to unit tests, invisible to a stubbed content script, and invisible to Chrome-only
tests (the MV3 build declares the key correctly).

**Playwright cannot load Firefox extensions.** Extensions are Chromium-only, and Playwright's
Firefox is a patched Nightly build whose Juggler protocol will not interact with
`moz-extension://` pages.

### The workaround

`web-ext` does not do anything magic to install an add-on: it launches Firefox with
`-start-debugger-server <port>` and then calls `installTemporaryAddon(sourceDir)` over the
Remote Debugging Protocol (RDP). **That install step is decoupled from who launched the
browser.** So Playwright launches Firefox as usual, and the add-on is installed over RDP
afterwards.

This keeps Playwright as the single automation API for both browsers, so Chrome and Firefox
share one set of specs (`tests/simulated/`), and fixture serving keeps using `context.route()`.

**Current implementation:** `tests/support/launch-extension.ts` delegates the RDP install to
[`playwright-webextext`](https://github.com/ueokande/playwright-webextext), with two workarounds
for its packaging (see criterion 4 below):

- `tslib` is installed explicitly, because the library requires it at runtime but declares it
  only as a dev dependency;
- the import targets `playwright-webextext/dist/factory.js` rather than the package root, whose
  entry point eagerly requires `@playwright/test` — a package this project does not use.

Writing our own ~60-line RDP install against `web-ext`'s client would remove both workarounds and
the dependency on an 0.0.5 package. That is worthwhile hardening, not a prerequisite: the
objections listed below are either worked around above or do not apply to this extension.

Verified working on 2026-09-18: **headless** Firefox, real `.output/firefox-mv2` build,
content script injecting into an intercepted `https://fixture.awsapps.com/start/`, accounts
extracted, and the settings-dialog → background permission round-trip exercised end to end.

#### What we deliberately do NOT do

We do **not** patch Playwright's Firefox (`omni.ja` / `playwright.cfg`) to let Juggler drive
`moz-extension://` pages, which is what
[duckduckgo/firefox-webext-playwright-harness](https://github.com/duckduckgo/firefox-webext-playwright-harness)
does (and which it self-describes as experimental, "I don't recommend using this for anything
important").

We can skip it because **this extension has no extension pages** — no popup, no options page.
`entrypoints/` is just `content.ts` and `background.ts`, and the settings dialog is mounted by
the content script into the AWS page. Everything we need to drive is reachable as an ordinary
page.

If a popup or options page is ever added, this assumption breaks and the exit criteria below
become much more urgent.

#### Firefox preferences the harness sets, and why

| Pref | Value | Why |
| --- | --- | --- |
| `extensions.webextOptionalPermissionPrompts` | `false` | Skips the optional-permission prompt UI and silently approves the request, so `permissions.request()` can be tested unattended. Set to `true` in the test that asserts the prompt path. |
| `xpinstall.signatures.required` | `false` | Belt-and-braces for unsigned builds. Only honoured on Nightly/Developer Edition — Playwright's Firefox *is* Nightly-based, so it applies. RDP temporary installs bypass signing anyway, so this is not strictly required. |

#### Known environment quirk

Playwright pins an exact Firefox revision and refuses to launch a different one. When that
download is unavailable (slow/flaky network, stale `~/Library/Caches/ms-playwright/__dirlock`),
passing `executablePath` pointed at an adjacent cached revision works — Playwright 1.59.1 drove
the cached `firefox-1509` build without issue. Keep this as a documented fallback, not a default.

### Exit criteria — when to delete this harness

#### 1. Playwright adds native Firefox extension support — do NOT wait for this

| Ticket | State |
| --- | --- |
| [microsoft/playwright#2644](https://github.com/microsoft/playwright/issues/2644) — "Support browser extension loading in Firefox" | **Closed.** Maintainer (pavelfeldman, 2020-10-20): "extensions automation is outside of the scope for Playwright, apologies for building the wrong expectations for this one." |
| [microsoft/playwright#32755](https://github.com/microsoft/playwright/issues/32755) — "Ability to respond to optional permission requests" | **Closed.** Maintainer (yury-s, 2024-09-23): "Playwright focuses on testing web platform features and optional permission requests from extensions is out of scope. Closing this report as we are not planning to work on it." |

This is a stated scope decision, twice, not a backlog item. There are currently **no open**
Playwright issues for Firefox extension support. Only revisit if the maintainers publicly
reverse this — do not budget for it.

#### 2. WebDriver BiDi `webExtension.install` — the realistic exit path

`webExtension.install` is standardised and **already implemented in both Firefox and Chrome**.
This, not Playwright, is where cross-browser extension automation is actually heading.

| Ticket | State | Relevance |
| --- | --- | --- |
| [SeleniumHQ/selenium#17933](https://github.com/SeleniumHQ/selenium/issues/17933) — "[ADR]: The driver installs web extensions directly" | **Open**, updated 2026-08-21 | The live tracking item. Supersedes [#15585](https://github.com/SeleniumHQ/selenium/issues/15585), which was closed `not_planned` in favour of this ADR. |
| [w3c/webdriver-bidi#1165](https://github.com/w3c/webdriver-bidi/issues/1165) — "Allow clients to configure installed extensions" | **Open**, updated 2026-09-16 | Post-install configuration (e.g. pre-granting permissions) is still unspecified. Until this lands, permission setup stays browser-specific. |

**Delete this harness when** either:

- Playwright exposes BiDi-based extension install (watch its BiDi work; nothing open today), **or**
- we migrate the browser test layer to a BiDi client (Selenium or Puppeteer).

**Blocker for migrating today:** our fixture serving depends on Playwright's
`context.route()` / `routeFromHAR()`. A BiDi client would need `network.addIntercept` +
`network.provideResponse`, which is less ergonomic, so fixture serving would have to move to a
local HTTPS server with hostname mapping. That is a bigger change than the ~60 lines this
harness costs — which is precisely why we are not migrating yet.

Firefox semantics to carry over if we do migrate: `temporary` defaults differ between classic
geckodriver and BiDi, and Firefox **rejects permanent installs of unpacked directories**
(unpacked ⇒ temporary; signed `.xpi` ⇒ permanent).

#### 3. Puppeteer's `installExtension` — viable today, not chosen

[puppeteer/puppeteer#14075](https://github.com/puppeteer/puppeteer/issues/14075) is **closed**,
and the reporter's own conclusion (2025-08-05) was "Installing / uninstalling the extension
works, so I think we can close this issue." The only unresolved gripe is that Firefox returns
the **manifest ID rather than the internal UUID**.

So Puppeteer + Firefox BiDi is a working option *today*. We did not choose it because:

- it means a second automation stack alongside Playwright, or replacing Playwright wholesale and
  losing `routeFromHAR`;
- the UUID gap only matters for driving `moz-extension://` pages, which we don't do — so it
  buys us nothing over the RDP approach.

Keep it in mind as the fallback if the RDP approach ever breaks.

#### 4. `playwright-webextext` becomes trustworthy

[ueokande/playwright-webextext](https://github.com/ueokande/playwright-webextext) implements the
RDP mechanism we rely on. We use it, but it is at **0.0.5** and has real problems — two of which
we work around, and two of which simply do not bite this extension:

| Problem | Evidence |
| --- | --- |
| Declares **no runtime dependencies at all** — its shipped code `require`s `tslib`, which is listed only in `devDependencies`. A clean install crashes with `Cannot find module 'tslib'`. | Reproduced 2026-09-18; dependabot treats it as a dev dep in [#350](https://github.com/ueokande/playwright-webextext/issues/350) |
| Its entry point eagerly `require`s `@playwright/test`, which this project does not use (we're on vitest). Workaround is importing `playwright-webextext/dist/factory.js` directly. | Reproduced 2026-09-18 |
| Manifest V3 not fully supported | [#168](https://github.com/ueokande/playwright-webextext/issues/168) — open |
| No documented way to obtain the extension UUID | [#352](https://github.com/ueokande/playwright-webextext/issues/352), [#366](https://github.com/ueokande/playwright-webextext/issues/366) — both open, unanswered |
| Maintenance | Last push 2026-04-06; 13 open issues, mostly dependabot |

**Drop the workarounds when** it declares its runtime dependencies correctly and stops requiring
`@playwright/test` from its entry point. **Replace it entirely** if it goes unmaintained, or once
our Firefox build moves to MV3 and [#168](https://github.com/ueokande/playwright-webextext/issues/168)
is still open — at that point, own the RDP install or move to a BiDi client (criterion 2).

The MV3 and extension-UUID gaps do not affect us today: the Firefox build is MV2, and this
extension has no extension pages whose `moz-extension://` origin we would need to address.

### Summary

| Path | Status | Verdict |
| --- | --- | --- |
| Playwright native support | Closed, out of scope (twice) | Never; don't wait |
| BiDi via Selenium/Puppeteer | Implemented; Selenium ADR open | The real exit path, blocked on fixture-serving ergonomics |
| `playwright-webextext` | 0.0.5, broken packaging, 2 workarounds | **In use** — verified working headless in both fixture suites |
| Own the RDP install via `web-ext` | Not written | Worthwhile hardening; removes the workarounds |

---

## Whole-project typecheck in the pre-commit hook

`lint-staged.config.ts` type-checks the **entire** project on commit instead of the staged files.

**Status as of 2026-09-22.** Re-check when
[microsoft/TypeScript#27379](https://github.com/microsoft/TypeScript/issues/27379) moves, or when
a commit starts feeling slow.

### The problem

`tsc` ignores `tsconfig.json` completely the moment it is given file arguments — so
`tsc --noEmit src/foo.ts` type-checks `foo.ts` with *default* compiler options, not ours. Strict
mode, `jsx`, `types`, `lib`: all silently dropped. Passing `-p` alongside files does not help;
`tsc` rejects the combination outright with TS5042.

This is [microsoft/TypeScript#27379](https://github.com/microsoft/TypeScript/issues/27379), open
since 2018. The maintainers' design questions were answered in the thread years ago
([overwrite the `files` setting](https://github.com/microsoft/TypeScript/issues/27379#issuecomment-555575862))
and nothing has been implemented, so this is not a gap that is about to close.

### The workaround

lint-staged appends the staged filenames to a task given as a string, but **not** to one given as
a function. So the type-check task is a function returning a bare command:

```ts
"*.{ts,tsx}": () => "tsc --noEmit",
```

The glob still decides *whether* the check runs — it is skipped for a commit that touches no
TypeScript — but the check itself is whole-project. This is the recipe lint-staged documents for
exactly this situation ("run tsc on changes to TypeScript files but do not pass any filename
arguments").

### Why not a per-file wrapper

We previously used [`tsc-files`](https://github.com/gustavopch/tsc-files), which generates a temp
`tsconfig.json` with the staged files in `files` and `include: []`. Two reasons it is gone:

- **It misses the errors that matter most.** If editing `foo.ts` breaks `bar.ts`, and only
  `foo.ts` is staged, the commit passes. The author
  [says so himself](https://github.com/microsoft/TypeScript/issues/27379#issuecomment-609456205).
- **It crashes on any staged non-TypeScript file.** It forwards everything that is not `.ts`/`.tsx`
  to `tsc` as a flag, so a staged `.js` lands on the command line as a source file next to `-p`
  and tsc fails with TS5042. `tests/fixtures/aws-start-page/simulator.js` triggered this.

[`tscw-config`](https://github.com/alveifbklsiu259/tscw-config) is the maintained equivalent and
fixes the second problem, but not the first.

**Delete this workaround when** `tsc` honours `tsconfig.json` alongside file arguments (#27379),
and a per-file check becomes both correct and worth the speed. Today the full check takes about a
second, so there is nothing to buy.
