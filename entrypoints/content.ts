import React from "react";
import { createRoot } from "react-dom/client";
import { defineContentScript } from "wxt/utils/define-content-script";
import { AccountTreeTable } from "../src/components/AccountTreeTable";
import { STORAGE_KEY, useConfigStore } from "../src/utils/configStore";
import "../src/styles/global.css";

export default defineContentScript({
  matches: ["https://*.awsapps.com/start/"],
  main(_ctx) {
    console.log("AWS SSO Account Grouper content script loaded");

    // Re-hydrate the Zustand store whenever the background script updates storage
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === "local" && changes[STORAGE_KEY]) {
        useConfigStore.persist.rehydrate();
      }
    });

    // Only inject on the SSO start page
    if (!window.location.pathname.includes("/start/")) {
      return;
    }

    // Wait for the page to load
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", initializeTreeTable);
    } else {
      initializeTreeTable();
    }
  },
});

function initializeTreeTable() {
  console.log(
    "[content] initializeTreeTable called, readyState:",
    document.readyState,
    "URL:",
    window.location.href
  );
  // Find the target element
  const getParent = () => document.querySelector('[role="tabpanel"]');
  let targetElement = getParent();

  console.log("[content] tabpanel element found immediately:", !!targetElement);

  if (targetElement) {
    // Element exists, proceed with setup
    setupTreeTable(targetElement);
  } else {
    // Element doesn't exist yet, watch for its creation
    console.log("Accounts list header not found, watching for creation");
    const observer = new MutationObserver(() => {
      targetElement = getParent();
      if (targetElement) {
        observer.disconnect();
        console.log("Accounts list header found, setting up TreeTable");
        setupTreeTable(targetElement);
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });
  }
}

function setupTreeTable(targetElement: Element) {
  // Create a container for the TreeTable
  const container = document.createElement("div");
  container.id = "aws-launcher-organiser-account-tree-root";

  // Check if container already exists
  const existing = document.getElementById(container.id);
  if (existing) {
    existing.remove();
  }

  // Insert container after the target element
  targetElement.prepend(container);

  // Mount React component
  const root = createRoot(container);
  root.render(
    React.createElement(AccountTreeTable, {
      onAccountSelect: (accountId: string) => {
        console.log("Selected account:", accountId);
        // Account click handling can be implemented here
      },
    })
  );

  // Clean up on page unload
  window.addEventListener("beforeunload", () => {
    root.unmount();
  });
}
