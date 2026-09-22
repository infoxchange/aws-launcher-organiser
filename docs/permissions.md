# Host permissions

The extension asks for as little as possible up front. The content script runs on the AWS portal
by way of its `content_scripts` match, which needs no host permission at all. Everything else
that touches the network — fetching a remote config for auto-update, fetching account icons — is
an **optional** host permission requested at runtime.

That keeps the install-time permission prompt small, at the cost of a surprising amount of
per-browser complexity. This document records that complexity so it is not rediscovered.

## The manifest key differs by manifest version

| Build | Key that declares optional hosts |
| --- | --- |
| Chrome (MV3) | `optional_host_permissions` |
| Firefox (MV2) | `optional_permissions` |

`optional_host_permissions` is **MV3-only**. WXT does not translate it, so declaring only that
key produced a Firefox build with no host permissions at all — neither required nor optional.

`wxt.config.ts` therefore emits the manifest per version.

### Why this failed silently

Nothing errors. `permissions.request()` simply cannot grant an origin that was never declared as
optional, and a background `fetch` without a host permission is still subject to CORS. So
auto-update appeared to work against any server sending `Access-Control-Allow-Origin: *`, and
failed with an opaque `NetworkError` against one that did not.

Verified behaviour, from the browser tests:

| Config server | Host permission | Result |
| --- | --- | --- |
| sends permissive CORS | none | succeeds — CORS, not permission, is doing the work |
| no CORS headers | none | `NetworkError when attempting to fetch resource.` |
| no CORS headers | granted | succeeds |

The middle row is the one that matters: **a granted host permission is what makes the fetch work
against an arbitrary endpoint.** A test whose config server sends permissive CORS proves nothing,
which is why the test server deliberately sends none.

The same trap exists in reverse: putting `<all_urls>` into MV3's `permissions` array instead of
`host_permissions` is accepted and does nothing — `permissions.contains()` just returns false.

## Requests go through the background script

`browser.permissions` is not available to content scripts, so `src/utils/permissions.ts` sends
`CHECK_PERMISSION` / `REQUEST_PERMISSION` messages to the background script, which calls the API
and replies.

### Known limitation: Firefox denies background-initiated requests

Firefox requires `permissions.request()` to be called from a user input handler. The background
script has no user gesture, and the gesture does not survive the message hop from the content
script — so on Firefox the request is refused outright, without a prompt.

**Auto-update therefore still cannot obtain a host permission on Firefox.** The manifest fix was
necessary but not sufficient. Resolving it needs the request to originate somewhere that has both
a gesture and access to `browser.permissions` — in practice an extension page (an options page or
popup) opened from the content script.

Note that adding one would also invalidate the assumption that lets the Firefox test harness
avoid patching Playwright's browser; see
[docs/temporary-code.md § "Firefox extension test harness"](temporary-code.md).

Chrome does allow the background-initiated request, and shows a prompt.

## Testing permissions

Neither browser lets automation answer a permission prompt. Chrome is the worse of the two: the
prompt opens, nothing can click it, the promise never settles, and the connection test hangs on a
spinner indefinitely.

So the layers split like this:

- **Granted path** — browser tests launch a copy of the built extension with the host permission
  declared as *required*, so no prompt is involved. `withGrantedHostPermissions()` writes the
  correct key for the manifest version.
- **Denied path** — unit tests stub the background's reply, since no browser will produce a real
  denial on demand.
- **Manifest contract** — the shipped manifests are asserted to declare the expected keys, which
  is what the test-only variant cannot cover.

Firefox browser tests set `extensions.webextOptionalPermissionPrompts: false`, which suppresses
the prompt UI and silently approves requests.
