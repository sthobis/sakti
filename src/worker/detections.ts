// The per-tab list of detected media, in chrome.storage.session: it is kept in
// memory only and is gone when the browser closes. The sniffer and the prober
// both change it, so every change goes through one queue.

import { createQueue } from "../core/queue.ts";
import { mediaKey, type Detection } from "../media/types.ts";

const serialize = createQueue();

export async function readDetections(tabId: number): Promise<Detection[]> {
  const key = mediaKey(tabId);
  const items = await chrome.storage.session.get(key);
  return (items[key] ?? []) as Detection[];
}

export function updateDetections(tabId: number, change: (list: Detection[]) => Detection[]): Promise<Detection[]> {
  return serialize(async () => {
    const current = await readDetections(tabId);
    const next = change(current);
    if (next !== current) await chrome.storage.session.set({ [mediaKey(tabId)]: next });
    return next;
  });
}

export function clearDetections(tabId: number): Promise<void> {
  return serialize(() => chrome.storage.session.remove(mediaKey(tabId)));
}
