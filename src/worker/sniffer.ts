// Watches the response headers of every tab and records the ones that are
// videos or playlists. It never reads a response body and never changes a
// request.

import { classify } from "../media/classify.ts";
import type { Detection } from "../media/types.ts";
import { clearDetections, updateDetections } from "./detections.ts";

const URLS = ["http://*/*", "https://*/*"];
const MAX_PER_TAB = 50;

// URLs already stored, per tab. A live stream reloads its playlist every few
// seconds; this keeps those repeats from touching storage. The worker can be
// stopped at any time, so this is only a cache of what storage holds.
const seen = new Map<number, Set<string>>();

async function originOf(details: chrome.webRequest.OnHeadersReceivedDetails): Promise<string> {
  if (details.initiator && details.initiator !== "null") return details.initiator;
  try {
    return new URL((await chrome.tabs.get(details.tabId)).url ?? "").origin;
  } catch {
    return "";
  }
}

async function record(details: chrome.webRequest.OnHeadersReceivedDetails): Promise<void> {
  const { tabId, url } = details;
  if (tabId < 0 || seen.get(tabId)?.has(url)) return;
  const found = classify({ url, type: details.type, statusCode: details.statusCode, headers: details.responseHeaders ?? [] });
  if (!found) return;

  const detection: Detection = { url, kind: found.kind, size: found.size, origin: await originOf(details), seenAt: Date.now() };
  const list = await updateDetections(tabId, (current) =>
    current.some((existing) => existing.url === url) ? current : [detection, ...current].slice(0, MAX_PER_TAB),
  );
  seen.set(tabId, new Set(list.map((existing) => existing.url)));
}

function forget(tabId: number): void {
  seen.delete(tabId);
  void clearDetections(tabId);
}

export function startSniffer(): void {
  chrome.webRequest.onHeadersReceived.addListener(
    (details) => {
      void record(details);
      return undefined;
    },
    { urls: URLS, types: ["media", "xmlhttprequest", "other"] },
    ["responseHeaders"],
  );

  // A new document in the tab: what the previous page loaded no longer applies.
  // A page the browser prerenders in the background is not a navigation yet.
  chrome.webRequest.onBeforeRequest.addListener(
    (details) => {
      if (details.tabId >= 0 && details.documentLifecycle !== "prerender") forget(details.tabId);
      return undefined;
    },
    { urls: URLS, types: ["main_frame"] },
  );

  chrome.tabs.onRemoved.addListener(forget);
}
