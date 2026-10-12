// Network access for the offscreen document: fetching with retries, and
// asking the worker to put the page's Referer on requests to a set of hosts.

import type { HeaderSlot, OffscreenReport } from "../media/messages.ts";
import type { SegmentRequest } from "../media/types.ts";

const RETRIES = 3;
const FIRST_DELAY_MS = 500;

/** A response the server meant: retrying will not change it. */
export class HttpError extends Error {
  readonly status: number;
  constructor(status: number, url: string) {
    super(`The server answered ${status} for ${new URL(url).hostname}`);
    this.status = status;
  }
}

const retryable = (status: number): boolean => status === 408 || status === 429 || status >= 500;

function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(signal.reason);
      },
      { once: true },
    );
  });
}

/** Fetches with the user's cookies. Network errors and overloaded servers are retried with backoff. */
export async function request(target: SegmentRequest, signal: AbortSignal): Promise<Response> {
  const headers: Record<string, string> = {};
  if (target.range) headers.Range = `bytes=${target.range.offset}-${target.range.offset + target.range.length - 1}`;

  for (let attempt = 0; ; attempt += 1) {
    signal.throwIfAborted();
    let failure: unknown;
    try {
      const response = await fetch(target.url, { credentials: "include", headers, signal });
      if (response.ok) return response;
      failure = new HttpError(response.status, target.url);
      if (!retryable(response.status)) throw failure;
    } catch (error) {
      if (signal.aborted || error instanceof HttpError) throw error;
      failure = new Error(`Could not reach ${new URL(target.url).hostname}`);
    }
    if (attempt >= RETRIES) throw failure;
    await wait(FIRST_DELAY_MS * 2 ** attempt, signal);
  }
}

/** The body as text, and the URL it finally came from, which relative URLs inside it resolve against. */
export async function fetchText(url: string, signal: AbortSignal): Promise<{ text: string; url: string }> {
  const response = await request({ url }, signal);
  return { text: await response.text(), url: response.url || url };
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

/** Resolves once Sakti's requests to the hosts of `urls` carry the page's Referer and Origin. */
export async function allowHosts(slot: HeaderSlot, urls: readonly string[], origin: string): Promise<void> {
  const hosts = [...new Set(urls.map(hostOf))].filter(Boolean);
  const report: OffscreenReport = { type: "sakti:media-hosts", slot, hosts, origin };
  await chrome.runtime.sendMessage(report);
}
