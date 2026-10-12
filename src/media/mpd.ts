// DASH manifest parser. Reads the first period and turns every
// representation into the ordered list of requests that make up its file.
// Supports SegmentTemplate (by number or by timeline), SegmentList, and a
// representation that is one whole file (SegmentBase or a bare BaseURL). Pure.

import type { ByteRange, SegmentRequest, TrackPlan } from "./types.ts";
import { childOf, childrenOf, parseXml, type XmlNode } from "./xml.ts";

export interface Representation {
  id: string;
  bandwidth: number | null;
  width: number | null;
  height: number | null;
  frameRate: number | null;
  requests: TrackPlan;
}

export interface Manifest {
  /** True while the stream is still being produced. */
  live: boolean;
  /** Seconds, when the manifest says. */
  duration: number | null;
  protected: boolean;
  periods: number;
  video: Representation[];
  audio: Representation[];
}

/** A stream longer than this many segments is almost certainly a parsing mistake. */
const MAX_SEGMENTS = 100_000;

/** ISO 8601 duration such as "PT1H2M3.5S", in seconds. */
export function parseDuration(text: string | undefined): number | null {
  const match = /^P(?:(\d+)Y)?(?:(\d+)M)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:([\d.]+)S)?)?$/.exec(text ?? "");
  if (!match) return null;
  const [, years, months, days, hours, minutes, seconds] = match.map((part) => Number(part ?? 0));
  return ((years! * 365 + months! * 30 + days!) * 24 + hours!) * 3600 + minutes! * 60 + seconds!;
}

function toNumber(text: string | undefined): number | null {
  if (text === undefined || text === "") return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

/** "30000/1001" or "25". */
function parseFrameRate(text: string | undefined): number | null {
  if (!text) return null;
  const [top, bottom] = text.split("/").map(Number);
  const value = bottom ? top! / bottom : top!;
  return Number.isFinite(value) ? value : null;
}

/** "0-862" (inclusive) as an offset and a length. */
function parseRange(text: string | undefined): ByteRange | undefined {
  const match = /^(\d+)-(\d+)$/.exec(text ?? "");
  if (!match) return undefined;
  return { offset: Number(match[1]), length: Number(match[2]) - Number(match[1]) + 1 };
}

function withBase(base: string, node: XmlNode): string {
  const text = childOf(node, "BaseURL")?.text.trim();
  return text ? new URL(text, base).href : base;
}

/** Fills $RepresentationID$, $Number%05d$, $Bandwidth$, $Time$ and $$. */
export function fillTemplate(pattern: string, values: { id: string; bandwidth: number | null; number: number; time: number }): string {
  return pattern.replace(/\$(RepresentationID|Number|Bandwidth|Time)?(?:%0(\d+)d)?\$/g, (_whole, name: string | undefined, width: string | undefined) => {
    if (!name) return "$";
    if (name === "RepresentationID") return values.id;
    const value = name === "Number" ? values.number : name === "Time" ? values.time : (values.bandwidth ?? 0);
    return String(value).padStart(Number(width ?? 0), "0");
  });
}

interface Context {
  id: string;
  bandwidth: number | null;
  base: string;
  periodDuration: number | null;
}

function push(requests: TrackPlan, request: SegmentRequest): void {
  if (requests.length >= MAX_SEGMENTS) throw new Error("The manifest lists too many segments");
  requests.push(request);
}

function fromTemplate(attrs: Record<string, string>, timeline: XmlNode | undefined, context: Context): TrackPlan {
  const requests: TrackPlan = [];
  const media = attrs.media;
  if (!media) throw new Error("SegmentTemplate without a media pattern");
  const timescale = toNumber(attrs.timescale) ?? 1;
  let number = toNumber(attrs.startNumber) ?? 1;
  const url = (pattern: string, time: number): string =>
    new URL(fillTemplate(pattern, { id: context.id, bandwidth: context.bandwidth, number, time }), context.base).href;

  if (attrs.initialization) push(requests, { url: url(attrs.initialization, 0) });

  if (timeline) {
    const entries = childrenOf(timeline, "S");
    let time = 0;
    entries.forEach((entry, index) => {
      if (entry.attrs.t !== undefined) time = Number(entry.attrs.t);
      const length = Number(entry.attrs.d);
      if (!(length > 0)) throw new Error("SegmentTimeline entry without a duration");
      let repeat = toNumber(entry.attrs.r) ?? 0;
      if (repeat < 0) {
        // "Repeat until the next entry, or until the period ends."
        const next = entries[index + 1]?.attrs.t;
        const end = next !== undefined ? Number(next) : (context.periodDuration ?? 0) * timescale;
        repeat = Math.max(0, Math.ceil((end - time) / length) - 1);
      }
      for (let i = 0; i <= repeat; i += 1) {
        push(requests, { url: url(media, time) });
        time += length;
        number += 1;
      }
    });
    return requests;
  }

  const length = toNumber(attrs.duration);
  if (!length || context.periodDuration === null) throw new Error("The manifest does not say how long the stream is");
  const count = Math.ceil((context.periodDuration * timescale) / length - 1e-6);
  for (let i = 0; i < count; i += 1) {
    push(requests, { url: url(media, i * length) });
    number += 1;
  }
  return requests;
}

function fromList(list: XmlNode, context: Context): TrackPlan {
  const requests: TrackPlan = [];
  const add = (node: XmlNode | undefined, urlAttr: string, rangeAttr: string): void => {
    if (!node) return;
    const request: SegmentRequest = { url: new URL(node.attrs[urlAttr] ?? "", context.base).href };
    const range = parseRange(node.attrs[rangeAttr]);
    if (range) request.range = range;
    push(requests, request);
  };
  add(childOf(list, "Initialization"), "sourceURL", "range");
  for (const segment of childrenOf(list, "SegmentURL")) add(segment, "media", "mediaRange");
  return requests;
}

export function parseManifest(text: string, manifestUrl: string): Manifest {
  const mpd = childOf(parseXml(text), "MPD");
  if (!mpd) throw new Error("Not a DASH manifest");
  const periods = childrenOf(mpd, "Period");
  const period = periods[0];
  if (!period) throw new Error("The manifest has no period");

  const total = parseDuration(mpd.attrs.mediaPresentationDuration);
  const periodDuration = parseDuration(period.attrs.duration) ?? total;
  const periodBase = withBase(withBase(manifestUrl, mpd), period);
  const manifest: Manifest = {
    live: mpd.attrs.type === "dynamic",
    duration: total ?? periodDuration,
    protected: false,
    periods: periods.length,
    video: [],
    audio: [],
  };

  for (const set of childrenOf(period, "AdaptationSet")) {
    const setBase = withBase(periodBase, set);
    if (childOf(set, "ContentProtection")) manifest.protected = true;

    for (const node of childrenOf(set, "Representation")) {
      if (childOf(node, "ContentProtection")) manifest.protected = true;
      const mime = node.attrs.mimeType ?? set.attrs.mimeType ?? "";
      const type = set.attrs.contentType ?? mime.split("/")[0];
      if (type !== "video" && type !== "audio") continue;

      const base = withBase(setBase, node);
      const context: Context = { id: node.attrs.id ?? "", bandwidth: toNumber(node.attrs.bandwidth), base, periodDuration };

      // SegmentTemplate attributes inherit from the period down to the representation.
      const templates = [period, set, node].map((level) => childOf(level, "SegmentTemplate")).filter((found) => found !== undefined);
      const list = childOf(node, "SegmentList") ?? childOf(set, "SegmentList") ?? childOf(period, "SegmentList");

      let requests: TrackPlan;
      if (templates.length) {
        const attrs = Object.assign({}, ...templates.map((template) => template.attrs)) as Record<string, string>;
        const timeline = templates.map((template) => childOf(template, "SegmentTimeline")).findLast((found) => found !== undefined);
        requests = fromTemplate(attrs, timeline, context);
      } else if (list) {
        requests = fromList(list, context);
      } else if (base !== manifestUrl) {
        requests = [{ url: base }]; // the representation is one whole file
      } else {
        throw new Error("The manifest uses an addressing mode Sakti does not support");
      }

      const representation: Representation = {
        id: context.id,
        bandwidth: context.bandwidth,
        width: toNumber(node.attrs.width ?? set.attrs.width),
        height: toNumber(node.attrs.height ?? set.attrs.height),
        frameRate: parseFrameRate(node.attrs.frameRate ?? set.attrs.frameRate),
        requests,
      };
      manifest[type].push(representation);
    }
  }
  return manifest;
}

/** The audio track to pair with any video representation: the one with the highest bitrate. */
export function bestAudio(manifest: Manifest): Representation | null {
  return manifest.audio.reduce<Representation | null>(
    (best, candidate) => (best === null || (candidate.bandwidth ?? 0) > (best.bandwidth ?? 0) ? candidate : best),
    null,
  );
}
