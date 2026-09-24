import "./options.css";
import { requestReconcile } from "../../core/messages.ts";
import { renderBackup } from "./backup-view.ts";
import { renderFeatures } from "./features-view.ts";
import { confirmLeave, isDirty, setDirtyCheck } from "./guard.ts";
import { parseRoute, routeHash, type Route, type Tab } from "./route.ts";

type View = (root: HTMLElement, route: Route) => Promise<void>;
const views: Partial<Record<Tab, View>> = {
  features: renderFeatures,
  backup: renderBackup,
};

let current: Route = parseRoute(location.hash);
let restoring = false;

async function show(): Promise<void> {
  setDirtyCheck(() => false);
  for (const link of document.querySelectorAll<HTMLAnchorElement>("nav a")) {
    if (link.dataset.tab === current.tab) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  }
  // A fresh container per render, so a slow view that finishes after the user
  // has moved on writes into a detached node instead of the page.
  const container = document.createElement("div");
  document.getElementById("view")!.replaceChildren(container);
  await views[current.tab]?.(container, current);
}

window.addEventListener("hashchange", () => {
  if (restoring) {
    restoring = false;
    return;
  }
  if (!confirmLeave()) {
    restoring = true;
    location.hash = routeHash(current);
    return;
  }
  current = parseRoute(location.hash);
  void show();
});

window.addEventListener("beforeunload", (event) => {
  if (isDirty()) event.preventDefault();
});

document.getElementById("version")!.textContent = `v${chrome.runtime.getManifest().version}`;
// Picks up a freshly granted "Allow User Scripts" without waiting for a restart.
requestReconcile().catch(() => {});
void show();
