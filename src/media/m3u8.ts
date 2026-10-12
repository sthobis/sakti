// HLS playlist parser. Reads only what listing and downloading need: the
// variants of a master playlist, and the segments, keys and init sections of
// a media playlist. Pure.

import type { ByteRange, SegmentRequest, TrackPlan } from "./types.ts";

export interface Variant {
  url: string;
  bandwidth: number | null;
  width: number | null;
  height: number | null;
  frameRate: number | null;
  /** GROUP-ID of the audio renditions this variant plays with. */
  audioGroup: string | null;
}

export interface Rendition {
  group: string;
  name: string;
  isDefault: boolean;
  /** Null when the audio is muxed into the variant itself. */
  url: string | null;
}

export interface MasterPlaylist {
  type: "master";
  variants: Variant[];
  audio: Rendition[];
}

export type Protection = "none" | "aes-128" | "drm";

export interface MediaPlaylist {
  type: "media";
  /** False while the stream is still being produced. */
  ended: boolean;
  duration: number;
  protection: Protection;
  requests: TrackPlan;
}

export type Playlist = MasterPlaylist | MediaPlaylist;

/** Parses `A=1,B="x,y",C=0x1F` into a map. Quotes are removed. */
export function parseAttributes(text: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const pattern = /([A-Z0-9-]+)=("[^"]*"|[^,]*)/g;
  for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
    const value = match[2]!;
    attrs[match[1]!] = value.startsWith('"') ? value.slice(1, -1) : value.trim();
  }
  return attrs;
}

function toNumber(text: string | undefined): number | null {
  if (text === undefined || text === "") return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

/** `length[@offset]`. Without an offset the range follows the previous one. */
function parseRange(text: string, previousEnd: number): ByteRange {
  const [length, offset] = text.split("@");
  return { length: Number(length), offset: offset === undefined ? previousEnd : Number(offset) };
}

/** The IV of a segment without an explicit one is its sequence number, big-endian. */
function sequenceIv(sequence: number): string {
  return sequence.toString(16).padStart(32, "0");
}

export function parsePlaylist(text: string, baseUrl: string): Playlist {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines[0] !== "#EXTM3U") throw new Error("Not an HLS playlist");
  const resolve = (uri: string): string => new URL(uri, baseUrl).href;
  const isMaster = lines.some((line) => line.startsWith("#EXT-X-STREAM-INF"));
  return isMaster ? parseMaster(lines, resolve) : parseMedia(lines, resolve);
}

function parseMaster(lines: string[], resolve: (uri: string) => string): MasterPlaylist {
  const variants: Variant[] = [];
  const audio: Rendition[] = [];
  let pending: Record<string, string> | null = null;

  for (const line of lines) {
    if (line.startsWith("#EXT-X-STREAM-INF:")) {
      pending = parseAttributes(line.slice(line.indexOf(":") + 1));
    } else if (line.startsWith("#EXT-X-MEDIA:")) {
      const attrs = parseAttributes(line.slice(line.indexOf(":") + 1));
      if (attrs.TYPE !== "AUDIO" || !attrs["GROUP-ID"]) continue;
      audio.push({
        group: attrs["GROUP-ID"],
        name: attrs.NAME ?? "",
        isDefault: attrs.DEFAULT === "YES",
        url: attrs.URI ? resolve(attrs.URI) : null,
      });
    } else if (!line.startsWith("#") && pending) {
      const [width, height] = (pending.RESOLUTION ?? "").split("x");
      variants.push({
        url: resolve(line),
        bandwidth: toNumber(pending.BANDWIDTH),
        width: toNumber(width),
        height: toNumber(height),
        frameRate: toNumber(pending["FRAME-RATE"]),
        audioGroup: pending.AUDIO ?? null,
      });
      pending = null;
    }
  }
  return { type: "master", variants, audio };
}

function parseMedia(lines: string[], resolve: (uri: string) => string): MediaPlaylist {
  const requests: TrackPlan = [];
  let ended = false;
  let duration = 0;
  let protection: Protection = "none";
  let sequence = 0;
  let key: { url: string; iv: string | null } | null = null;
  let range: ByteRange | undefined;
  let rangeEnd = 0;
  let lastMap = "";

  for (const line of lines) {
    if (line.startsWith("#EXTINF:")) {
      duration += Number.parseFloat(line.slice(8)) || 0;
    } else if (line.startsWith("#EXT-X-MEDIA-SEQUENCE:")) {
      sequence = Number(line.slice(line.indexOf(":") + 1)) || 0;
    } else if (line.startsWith("#EXT-X-BYTERANGE:")) {
      range = parseRange(line.slice(line.indexOf(":") + 1), rangeEnd);
    } else if (line.startsWith("#EXT-X-KEY:")) {
      const attrs = parseAttributes(line.slice(line.indexOf(":") + 1));
      const method = attrs.METHOD ?? "NONE";
      const plainKey = (attrs.KEYFORMAT ?? "identity") === "identity";
      if (method === "NONE") {
        key = null;
      } else if (method === "AES-128" && plainKey && attrs.URI) {
        key = { url: resolve(attrs.URI), iv: attrs.IV ? attrs.IV.replace(/^0x/i, "").padStart(32, "0").toLowerCase() : null };
        if (protection === "none") protection = "aes-128";
      } else {
        protection = "drm";
      }
    } else if (line.startsWith("#EXT-X-MAP:")) {
      // The init section of fragmented MP4 segments. It is written once, and
      // again only if a later part of the playlist switches to another one.
      const attrs = parseAttributes(line.slice(line.indexOf(":") + 1));
      if (!attrs.URI) continue;
      const request: SegmentRequest = { url: resolve(attrs.URI) };
      if (attrs.BYTERANGE) request.range = parseRange(attrs.BYTERANGE, 0);
      const identity = JSON.stringify(request);
      if (identity !== lastMap) requests.push(request);
      lastMap = identity;
    } else if (line === "#EXT-X-ENDLIST") {
      ended = true;
    } else if (!line.startsWith("#")) {
      const request: SegmentRequest = { url: resolve(line) };
      if (range) {
        request.range = range;
        rangeEnd = range.offset + range.length;
        range = undefined;
      }
      if (key) request.key = { url: key.url, iv: key.iv ?? sequenceIv(sequence) };
      requests.push(request);
      sequence += 1;
    }
  }
  return { type: "media", ended, duration, protection, requests };
}

/** The separate audio playlist a variant needs, or null when its audio is muxed in. */
export function audioFor(master: MasterPlaylist, variant: Variant): string | null {
  if (!variant.audioGroup) return null;
  const group = master.audio.filter((rendition) => rendition.group === variant.audioGroup);
  const chosen = group.find((rendition) => rendition.isDefault) ?? group[0];
  return chosen?.url ?? null;
}
