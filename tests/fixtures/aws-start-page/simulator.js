/**
 * Behaviour layer for the captured AWS access portal fixtures.
 *
 * The captured DOM is static: AWS's own JavaScript is stripped during sanitising, so clicking
 * Next or expanding a row does nothing on its own. This script re-implements ONLY the behaviours
 * the extension depends on, so the fixtures exercise the real pagination and role-loading paths
 * without needing a live AWS session.
 *
 * This is a stated contract about how the portal behaves, so it can be checked rather than
 * assumed. Re-capturing the fixtures and running the live suite (tests/integration/) is what
 * catches divergence between it and the real portal.
 *
 * Emulated:
 *   - paging via Next / Previous / numbered buttons, including the disabled-state markup AWS
 *     actually uses (aria-disabled + hashed class, never the `disabled` attribute)
 *   - expanding an account row to load its roles, asynchronously, as a nested sibling row
 *
 * @see docs/testing.md § "The simulator"
 *
 * Deliberately not emulated: sorting, filtering, the applications tab, error and retry states.
 * Those get their own fixtures when there are tests that need them.
 */
(() => {
  const DISABLED_CLASS = "awsui_button-disabled_fvjdu_5ng4o_79";
  const CURRENT_CLASS = "awsui_button-current_fvjdu_5ng4o_100";
  /** Milliseconds before an expanded row's roles appear, mimicking the portal's fetch. */
  const ROLE_LOAD_DELAY = 250;
  /**
   * The real portal renders progressively: rows stream in, and the pagination controls appear
   * after them. Reproducing that is not decoration — extraction used to start in that window,
   * reading a truncated row list and, because the Next button did not exist yet, concluding
   * there were no further pages. The fixtures rendered instantly, so the simulated suite passed
   * while the live portal failed. These delays make that race reproducible in CI.
   */
  const ROWS_SETTLE_DELAY = 600;
  const PAGINATION_APPEAR_DELAY = 1000;
  const INITIAL_ROW_COUNT = 30;
  /**
   * The pagination controls also vanish briefly on every page change, not just initial load.
   * Modelling that is what makes "a missing Next button is not a disabled Next button"
   * testable in CI: without it, navigation silently gives up on the wrong page.
   */
  const PAGINATION_BLACKOUT_ON_CHANGE = 300;

  const state = {
    currentPage: 1,
    pageCount: 1,
    /** page number -> array of <tr> outerHTML for that page's account rows */
    pages: new Map(),
    roleRowTemplate: null,
  };

  const table = () => document.querySelector('table[role="treegrid"]');
  const tbody = () => table()?.querySelector("tbody");
  const nextButton = () => document.querySelector('button[aria-label="Next page"]');
  const prevButton = () => document.querySelector('button[aria-label="Previous page"]');
  const pageButtons = () => Array.from(document.querySelectorAll('button[aria-label^="Page"]'));

  function setDisabled(button, disabled) {
    if (!button) return;
    if (disabled) {
      button.setAttribute("aria-disabled", "true");
      button.setAttribute("tabindex", "-1");
      button.classList.add(DISABLED_CLASS);
    } else {
      button.removeAttribute("aria-disabled");
      button.setAttribute("tabindex", "0");
      button.classList.remove(DISABLED_CLASS);
    }
  }

  function renderPaginationState() {
    setDisabled(prevButton(), state.currentPage <= 1);
    setDisabled(nextButton(), state.currentPage >= state.pageCount);

    for (const button of pageButtons()) {
      const n = Number.parseInt(button.textContent ?? "", 10);
      const isCurrent = n === state.currentPage;
      button.setAttribute("aria-current", isCurrent ? "true" : "false");
      button.classList.toggle(CURRENT_CLASS, isCurrent);
    }
  }

  function renderPage(pageNumber) {
    const rows = state.pages.get(pageNumber);
    const body = tbody();
    if (!rows || !body) return;

    // Replacing innerHTML drops any expanded role rows, which matches the portal: paging
    // collapses everything.
    body.innerHTML = rows.join("");
    state.currentPage = pageNumber;
    renderPaginationState();
    wireRowExpansion();
    blackOutPagination();
  }

  /**
   * Briefly detach the pagination controls, as the portal does while it re-renders. The same
   * element is re-inserted so its listeners survive — re-wiring would double-fire clicks.
   */
  function blackOutPagination() {
    const pagination = nextButton()?.closest("ul");
    // Already blacked out by an earlier page change: leave that timer to restore it, otherwise
    // the controls could come back while a later change is still in progress.
    if (!pagination) return;

    const parent = pagination.parentNode;
    const anchor = pagination.nextSibling;
    pagination.remove();

    setTimeout(() => {
      parent?.insertBefore(pagination, anchor);
      // Re-sync before anyone can read it. The detached controls missed any page changes that
      // happened during the blackout, so re-inserting them as-is would advertise a stale
      // current page while the table shows a newer one — a state the real portal never
      // presents, and one that makes the simulation lie to the extension.
      renderPaginationState();
    }, PAGINATION_BLACKOUT_ON_CHANGE);
  }

  function wireRowExpansion() {
    const rows = Array.from(
      document.querySelectorAll('table[role="treegrid"] tr[data-selection-item="item"]')
    );

    for (const row of rows) {
      // Role rows are nested a level deeper and have no expander of their own.
      if (row.getAttribute("aria-level") === "2") continue;

      const button = row.querySelector("button[aria-expanded]");
      if (!button || button.dataset.simulatorWired === "true") continue;
      button.dataset.simulatorWired = "true";

      button.addEventListener("click", () => {
        const expanded = button.getAttribute("aria-expanded") === "true";
        if (expanded) {
          button.setAttribute("aria-expanded", "false");
          const sibling = row.nextElementSibling;
          if (sibling?.getAttribute("aria-level") === "2") sibling.remove();
          return;
        }

        button.setAttribute("aria-expanded", "true");
        if (!state.roleRowTemplate) return;

        // Asynchronous, like the real thing: the extension must wait for the row to appear
        // rather than assuming it is synchronously present.
        setTimeout(() => {
          if (button.getAttribute("aria-expanded") !== "true") return;
          if (row.nextElementSibling?.getAttribute("aria-level") === "2") return;
          const holder = document.createElement("tbody");
          holder.innerHTML = state.roleRowTemplate;
          const roleRow = holder.firstElementChild;
          if (roleRow) row.after(roleRow);
        }, ROLE_LOAD_DELAY);
      });
    }
  }

  async function loadFixturePages() {
    // Page 1 is already in the document; discover the rest by probing for their fragments.
    const body = tbody();
    if (!body) return;

    state.pages.set(
      1,
      Array.from(body.querySelectorAll('tr[data-selection-item="item"]')).map((r) => r.outerHTML)
    );

    for (let pageNumber = 2; ; pageNumber++) {
      const response = await fetch(`table-page-${pageNumber}.html`).catch(() => null);
      if (!response?.ok) break;

      const html = await response.text();
      const doc = new DOMParser().parseFromString(html, "text/html");
      const rows = Array.from(
        doc.querySelectorAll('table[role="treegrid"] tr[data-selection-item="item"]')
      ).map((r) => r.outerHTML);
      if (rows.length === 0) break;
      state.pages.set(pageNumber, rows);
    }

    const rolesResponse = await fetch("table-roles-expanded.html").catch(() => null);
    if (rolesResponse?.ok) {
      const doc = new DOMParser().parseFromString(await rolesResponse.text(), "text/html");
      state.roleRowTemplate =
        doc.querySelector('tr[data-selection-item="item"][aria-level="2"]')?.outerHTML ?? null;
    }
  }

  /**
   * Listeners are attached synchronously, before the page fixtures have loaded, and each handler
   * waits for loading to finish before acting.
   *
   * This matters: the extension starts extracting as soon as the content script runs and clicks
   * Next almost immediately. If the listeners were attached after an `await`, that first click
   * would land on a button with no handler, be silently lost, and the extension would conclude
   * pagination was finished after one page. The real portal handles clicks whenever they arrive,
   * so the simulation must too.
   */
  function wirePagination(ready) {
    const goTo = async (getTarget) => {
      await ready;
      const target = getTarget();
      if (target !== null && state.pages.has(target)) renderPage(target);
    };

    nextButton()?.addEventListener("click", () =>
      goTo(() => (state.currentPage < state.pageCount ? state.currentPage + 1 : null))
    );
    prevButton()?.addEventListener("click", () =>
      goTo(() => (state.currentPage > 1 ? state.currentPage - 1 : null))
    );
    for (const button of pageButtons()) {
      button.addEventListener("click", () =>
        goTo(() => {
          const n = Number.parseInt(button.textContent ?? "", 10);
          return Number.isNaN(n) ? null : n;
        })
      );
    }
  }

  /**
   * Hide most rows and the pagination controls, then restore them on a timer, so the extension
   * has to cope with a portal that is still painting. Runs synchronously at script execution,
   * before the content script gets a chance to look at the page.
   */
  function simulateProgressiveRender() {
    const body = tbody();
    const pagination = nextButton()?.closest("ul");
    if (!body || !pagination) return;

    const allRows = Array.from(body.querySelectorAll('tr[data-selection-item="item"]'));
    const held = allRows.slice(INITIAL_ROW_COUNT);
    for (const row of held) row.remove();

    const paginationParent = pagination.parentNode;
    const paginationAnchor = pagination.nextSibling;
    pagination.remove();

    setTimeout(() => {
      for (const row of held) body.appendChild(row);
    }, ROWS_SETTLE_DELAY);

    setTimeout(() => {
      // The same element is re-inserted, so its click listeners are still attached — wiring it
      // again would double-fire every Next click and skip a page.
      paginationParent?.insertBefore(pagination, paginationAnchor);
      renderPaginationState();
    }, PAGINATION_APPEAR_DELAY);
  }

  function init() {
    // Start loading, but do not await before wiring up — see wirePagination().
    const ready = loadFixturePages().then(() => {
      state.pageCount = state.pages.size;
      // Only now is the real page count known. The captured markup already carries the correct
      // state for page 1, so nothing is rendered before this point.
      renderPaginationState();
      document.documentElement.dataset.fixtureSimulatorReady = "true";
    });

    wirePagination(ready);
    wireRowExpansion();
    simulateProgressiveRender();
    return ready;
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
