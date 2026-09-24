// Service worker entry. Chrome stops it after ~30 s idle, so it keeps no state
// in memory: everything it needs is re-read from storage on each event.

import type { Message, StatusResponse } from "../core/messages.ts";
import { refreshActiveBadge, refreshBadge } from "./badge.ts";
import { scheduleReconcile, userScriptsAvailable } from "./registrar.ts";

chrome.runtime.onInstalled.addListener(() => {
  void scheduleReconcile();
});
chrome.runtime.onStartup.addListener(() => {
  void scheduleReconcile();
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local" || !(changes.features || changes.userscripts)) return;
  void scheduleReconcile();
  void refreshActiveBadge();
});

chrome.tabs.onActivated.addListener(({ tabId }) => {
  chrome.tabs.get(tabId).then(
    (tab) => refreshBadge(tabId, tab.url),
    () => {},
  );
});
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url || changeInfo.status === "loading") void refreshBadge(tabId, tab.url);
});

chrome.runtime.onMessage.addListener((message: Message, _sender, sendResponse) => {
  if (message?.type === "sakti:reconcile") {
    scheduleReconcile().then(() => sendResponse({ ok: true }));
    return true; // keeps the channel open for the async response
  }
  if (message?.type === "sakti:status") {
    const status: StatusResponse = { userScripts: userScriptsAvailable() };
    sendResponse(status);
  }
  return false;
});

void chrome.action.setBadgeBackgroundColor({ color: "#8b7bff" });
