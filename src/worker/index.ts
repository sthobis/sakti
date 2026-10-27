// Service worker entry. Chrome stops it after ~30 s idle, so it keeps no state
// in memory: everything it needs is re-read from storage on each event.

import type { Message, StatusResponse } from "../core/messages.ts";
import { refreshActiveBadge, refreshBadge, refreshTabBadge } from "./badge.ts";
import { handleMediaMessage, startMedia } from "./media.ts";
import { scheduleReconcile, userScriptsAvailable } from "./registrar.ts";
import { startSniffer } from "./sniffer.ts";

chrome.runtime.onInstalled.addListener(() => {
  void scheduleReconcile();
});
chrome.runtime.onStartup.addListener(() => {
  void scheduleReconcile();
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "session") {
    // A tab's detections changed: its video count may have too.
    for (const key of Object.keys(changes)) {
      const tabId = /^media:(\d+)$/.exec(key)?.[1];
      if (tabId) void refreshTabBadge(Number(tabId));
    }
    return;
  }
  if (areaName !== "local" || !(changes.features || changes.userscripts)) return;
  void scheduleReconcile();
  void refreshActiveBadge();
});

chrome.tabs.onActivated.addListener(({ tabId }) => {
  void refreshTabBadge(tabId);
});
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url || changeInfo.status === "loading") void refreshBadge(tabId, tab.url);
});

chrome.runtime.onMessage.addListener((message: Message, _sender, sendResponse) => {
  if (handleMediaMessage(message, sendResponse)) return true;
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

// Videos: listeners must be registered synchronously for Chrome to wake the
// worker for them.
startSniffer();
startMedia();

void chrome.action.setBadgeBackgroundColor({ color: "#8b7bff" });
