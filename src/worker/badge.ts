// Toolbar badge: how many videos the tab has loaded, with a tooltip that also
// says what Sakti runs on the site and what is switched off there. The wording
// is in badge-label.ts.

import registry from "sakti:registry";
import { readState } from "../core/storage.ts";
import { badgeLabel } from "./badge-label.ts";
import { readDetections } from "./detections.ts";
import { userScriptsAvailable } from "./registrar.ts";

export async function refreshBadge(tabId: number, url: string | undefined): Promise<void> {
  const [{ features, userscripts }, detections] = await Promise.all([readState(), readDetections(tabId)]);
  const { text, title } = badgeLabel({ registry, features, userscripts, userScripts: userScriptsAvailable(), detections, url });
  try {
    await chrome.action.setBadgeText({ tabId, text });
    await chrome.action.setTitle({ tabId, title });
  } catch {
    // the tab closed in the meantime
  }
}

export async function refreshTabBadge(tabId: number): Promise<void> {
  try {
    const tab = await chrome.tabs.get(tabId);
    await refreshBadge(tabId, tab.url);
  } catch {
    // the tab closed in the meantime
  }
}

export async function refreshActiveBadge(): Promise<void> {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (tab?.id !== undefined) await refreshBadge(tab.id, tab.url);
}
