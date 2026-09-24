// Toolbar badge: how many features and userscripts are switched off on the
// current tab's site. Empty when nothing is.

import registry from "sakti:registry";
import { hostOf } from "../core/match.ts";
import { featureState } from "../core/state.ts";
import { readState } from "../core/storage.ts";

export async function refreshBadge(tabId: number, url: string | undefined): Promise<void> {
  const host = hostOf(url);
  let count = 0;
  if (host) {
    const { features, userscripts } = await readState();
    count += registry.filter((entry) => featureState(features, entry.id).disabledHosts.includes(host)).length;
    count += Object.values(userscripts).filter((script) => script.disabledHosts.includes(host)).length;
  }
  try {
    await chrome.action.setBadgeText({ tabId, text: count ? String(count) : "" });
    await chrome.action.setTitle({ tabId, title: count && host ? `Sakti: ${count} off on ${host}` : "Sakti" });
  } catch {
    // the tab closed in the meantime
  }
}

export async function refreshActiveBadge(): Promise<void> {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (tab?.id !== undefined) await refreshBadge(tab.id, tab.url);
}
