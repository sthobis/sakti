// Decides from a response's status and headers whether it is a video, a
// playlist, or noise. Pure: the worker feeds it what webRequest reports.

import type { MediaKind } from "./types.ts";

export interface ResponseInfo {
  url: string;
  /** webRequest resource type: "media", "xmlhttprequest", "other", ... */
  type: string;
  statusCode: number;
  headers: readonly { name: string; value?: string }[];
}

export interface Classified {
  kind: MediaKind;
  size: number | null;
}

const HLS_TYPES = new Set(["application/vnd.apple.mpegurl", "application/x-mpegurl", "audio/mpegurl", "audio/x-mpegurl"]);
const DASH_TYPE = "application/dash+xml";
const VIDEO_PATH = /\.(mp4|m4v|mov|webm|mkv)$/;
/** A ranged response smaller than this is a streaming segment, not a file. */
const MIN_RANGED_FILE = 1024 * 1024;

function header(info: ResponseInfo, name: string): string {
  return info.headers.find((entry) => entry.name.toLowerCase() === name)?.value?.trim() ?? "";
}

function pathOf(url: string): string {
  try {
    return new URL(url).pathname.toLowerCase();
  } catch {
    return "";
  }
}

function toSize(text: string | undefined): number | null {
  if (!text || !/^\d+$/.test(text)) return null;
  return Number(text);
}

export function classify(info: ResponseInfo): Classified | null {
  if (info.statusCode < 200 || info.statusCode >= 300) return null;
  if (!/^https?:/i.test(info.url)) return null;

  const contentType = header(info, "content-type").split(";")[0]!.trim().toLowerCase();
  const path = pathOf(info.url);

  if (HLS_TYPES.has(contentType) || path.endsWith(".m3u8")) return { kind: "hls", size: null };
  if (contentType === DASH_TYPE || path.endsWith(".mpd")) return { kind: "dash", size: null };
  // Some servers send video files as plain bytes; trust the extension then.
  const isVideo = contentType.startsWith("video/") || (contentType === "application/octet-stream" && VIDEO_PATH.test(path));
  if (!isVideo) return null;

  // "bytes 0-1023/52428800": the number after the slash is the whole file.
  const total = toSize(/\/(\d+)\s*$/.exec(header(info, "content-range"))?.[1]);
  if (info.type === "media") {
    return { kind: "file", size: total ?? toSize(header(info, "content-length")) };
  }
  // Script-driven players fetch segments as plain 200 responses. Only a real
  // range request over a large file means the URL is the whole video.
  if (info.statusCode === 206 && total !== null && total >= MIN_RANGED_FILE) return { kind: "file", size: total };
  return null;
}
