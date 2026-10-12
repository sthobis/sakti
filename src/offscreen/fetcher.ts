// Downloads the requests of each track and appends their bodies, in order, to
// that track's scratch file.

import type { SegmentRequest, TrackPlan } from "../media/types.ts";
import { request } from "./net.ts";

const CONCURRENCY = 4;

function hexToBytes(hex: string): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i += 1) bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

/** Fetches whole segments into memory. Keys are fetched once each. */
function createLoader(signal: AbortSignal): (target: SegmentRequest) => Promise<ArrayBuffer> {
  const keys = new Map<string, Promise<CryptoKey>>();
  const keyFor = (url: string): Promise<CryptoKey> => {
    let key = keys.get(url);
    if (!key) {
      key = request({ url }, signal)
        .then((response) => response.arrayBuffer())
        .then((raw) => crypto.subtle.importKey("raw", raw, "AES-CBC", false, ["decrypt"]));
      keys.set(url, key);
    }
    return key;
  };

  return async (target) => {
    const response = await request(target, signal);
    let data = await response.arrayBuffer();
    // A server that ignores Range sends the whole file with a 200.
    if (target.range && response.status === 200) data = data.slice(target.range.offset, target.range.offset + target.range.length);
    if (target.key) data = await crypto.subtle.decrypt({ name: "AES-CBC", iv: hexToBytes(target.key.iv) }, await keyFor(target.key.url), data);
    return data;
  };
}

/** One large body is streamed to disk instead of being held in memory. */
async function streamOne(target: SegmentRequest, writable: FileSystemWritableFileStream, signal: AbortSignal, onFraction: (fraction: number) => void): Promise<void> {
  const response = await request(target, signal);
  const total = Number(response.headers.get("content-length")) || 0;
  const reader = response.body!.getReader();
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    await writable.write(value);
    received += value.byteLength;
    if (total) onFraction(Math.min(1, received / total));
  }
}

async function fetchTrack(requests: TrackPlan, handle: FileSystemFileHandle, signal: AbortSignal, onDone: (count: number) => void): Promise<void> {
  const writable = await handle.createWritable();
  try {
    if (requests.length === 1 && !requests[0]!.key && !requests[0]!.range) {
      await streamOne(requests[0]!, writable, signal, onDone);
    } else {
      // Up to CONCURRENCY segments load at once; they are written in order.
      const load = createLoader(signal);
      const loading = new Map<number, Promise<ArrayBuffer>>();
      let next = 0;
      for (let index = 0; index < requests.length; index += 1) {
        while (next < requests.length && loading.size < CONCURRENCY) {
          const started = load(requests[next]!);
          started.catch(() => {}); // reported when its turn comes
          loading.set(next, started);
          next += 1;
        }
        const data = await loading.get(index)!;
        loading.delete(index);
        await writable.write(data);
        onDone(index + 1);
      }
    }
    await writable.close();
  } catch (error) {
    await writable.abort().catch(() => {});
    throw error;
  }
}

/**
 * Fetches every track into its file. `onProgress` gets a fraction from 0 to 1.
 * A request that still fails after its retries rejects the whole call.
 */
export async function fetchTracks(
  tracks: readonly TrackPlan[],
  handles: readonly FileSystemFileHandle[],
  outer: AbortSignal,
  onProgress: (fraction: number) => void,
): Promise<void> {
  // One failed segment stops the others.
  const controller = new AbortController();
  const signal = AbortSignal.any([outer, controller.signal]);
  const total = tracks.reduce((sum, track) => sum + track.length, 0);
  let before = 0;
  try {
    for (const [index, track] of tracks.entries()) {
      await fetchTrack(track, handles[index]!, signal, (count) => onProgress((before + count) / total));
      before += track.length;
    }
  } catch (error) {
    controller.abort();
    throw error;
  }
}
