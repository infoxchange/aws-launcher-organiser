## Documentation

`docs/` holds per-feature/area documentation. Read the one that covers what you are touching. The summaries are writen to help indicate when it's likely useful for you to read. Reach for `AGENTS.md` when the material is more overview related, reach for `docs` when you want more indepth info relating to a specific feature/area.

| Doc | Read it when |
| --- | --- |
| [docs/aws-page-integration.md](docs/aws-page-integration.md) | Touching anything that reads the AWS portal's DOM — selectors, account extraction, pagination, roles. Also read it when AWS has changed the page and something has broken. |
| [docs/testing.md](docs/testing.md) | Writing or running tests, or regenerating the captured AWS fixtures. Explains the unit/simulated/live split and why fixtures are sanitised and committed. |
| [docs/permissions.md](docs/permissions.md) | Touching host permissions, the auto-update config fetch, or anything going through the background script. Covers the MV2/MV3 manifest split and the Firefox gesture limitation. |
| [docs/temporary-code.md](docs/temporary-code.md) | Before removing (or extending) a workaround. A register of deliberately temporary code with the conditions under which each entry can be deleted. |
| [docs/historical-plans/2026-09-18-testing-plan.md](docs/historical-plans/2026-09-18-testing-plan.md) | You want the reasoning behind the current test architecture, or the diagnosis of the pagination bug that prompted it. Frozen — describes intent at the time, not current state. |

### Citing the documentation
If the docs provide some relevent and useful info about the behaviour or context of some code then you should cite the relevent section in a code comment. Citations should be in the form of `docs/<file>.md § "<heading>"`, optionally followed by `- <the specific claim>` where the section covers several.

Citing docs is especially important for tests which should cite the requirement they are testing whenever such a requirement is listed in the docs. For example:

```ts
/** @see docs/terminal-output.md § "Defaults decide what happens in tests" */
it("takes the default when nothing can answer the prompt", () => {
```

A test name says what the code does; the citation
says _why anyone decided it should_, so someone who breaks the test can go and
read the reasoning instead of guessing at it from the assertion - and someone
changing the documented behaviour can find every test that depends on it with a
grep.

When a whole `describe` block covers one requirement, cite it once on the block rather than on every test inside it.

Make sure you only cite a stated requirement. A test for something the docs do not claim needs no reference, and inventing one to fill the slot makes the docs look more prescriptive than they are.

### Maintenance

- A change should not be considered finished if there is wrong/out-of-date info in `docs/`.
- A change that adds a concept someone would need explained — a new dialect, a
  new attribute namespace, a new output style — gets it documented in the
  relevant doc, not only in code comments.
- A new doc gets a row in the table above.
- You should create new plans under `docs/historical-plans/`
- `AGENTS.md` itself changes when a repo-wide convention or invariant does: a
  new lint rule, a new mocking boundary, a new directory with rules of its own.
- Frozen plans under `docs/historical-plans/` are exempt from all of the above.
  They are not updated as the code moves on. If one has to be edited because it
  is actively misleading someone, mark the edit inline as post-implementation,
  dated, with who changed it and why — never a silent rewrite.


## Creating Plans/Making Major Changes

Unless the user explicitly indicates otherwise the plan or major change should include:

- [ ] Adding full tests for all requirements.
- [ ] The plan file created in (or an exact copy put into) the `docs/historical-plans` directory with the filename `YYYY-MM-DD-title.md`.
- [ ] A docs/*.md file should be added when working on a feature that isn't covered by the existing docs, or if there is already an existing relevant doc it should be updated. If adding new feature that is a superset of an existing feature with an existing doc file consider renaming the existing file under the new superset feature name and placing it's existing contents into a new section dedicated to that subfeature.
- [ ] If the `docs/` file structure or any filenames in it have changed, AGENTS.md is updated so that every file is
  listed in the docs table and optionally if useful it's also linked in relevant section
- [ ] Make sure all tests and lints pass

## Directories with rules of their own

- `src/utils/aws-page/` is the **only** module allowed to know what the AWS portal's DOM looks
  like. Selectors belong in `selectors.ts`; DOM reads belong in `parse.ts` and take an explicit
  `root: ParentNode` so they stay unit-testable. Do not add AWS selectors anywhere else. See
  [docs/aws-page-integration.md](docs/aws-page-integration.md).
- `tests/fixtures/` is committed, sanitised capture data from the real AWS portal. Never commit a
  raw capture: `.fixture-capture/` is gitignored and `npm run fixture:verify-clean` runs from the
  pre-commit hook. See [docs/testing.md](docs/testing.md).
- Unit tests sit beside their source in `src/`. Only tests needing a browser live under `tests/`.
- Where a timing bug comes down to a decision (which page to move to, whether a control is
  disabled), extract the decision as a pure function in `src/utils/aws-page/` and unit-test it.
  Browser tests cannot reproduce sub-second races reliably — see
  [docs/testing.md](docs/testing.md) § "Races the fixture suite cannot reproduce".
- `tests/shared/portal-contract.ts` holds specs that run against **both** the captured fixtures
  and the real AWS portal. Assertions there must not depend on a known account count. A behaviour
  the simulator fakes belongs here, so a divergence from real AWS fails a test.
