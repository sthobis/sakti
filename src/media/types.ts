// Shapes shared by the worker, the offscreen document and the popup.

export type MediaKind = "hls" | "dash" | "file";

/** A quality the stream offers. `id` is only meaningful to the planner of its kind. */
export interface Quality {
  id: string;
  label: string;
}

export type Probe =
  | { status: "ready"; qualities: Quality[]; duration: number | null; hasAudio: boolean; children: string[] }
  | { status: "live"; children: string[] }
  | { status: "protected"; children: string[] }
  /** Not a video on its own, such as the audio half of a split stream. */
  | { status: "hidden" }
  | { status: "error"; message: string };

/** One media response seen in a tab. The URL identifies it. */
export interface Detection {
  url: string;
  kind: MediaKind;
  /** Bytes, when the response headers said so. */
  size: number | null;
  /** Origin of the frame that loaded it. Sent as Referer and Origin when Sakti fetches it. */
  origin: string;
  seenAt: number;
  probe?: Probe;
}

export interface ByteRange {
  offset: number;
  length: number;
}

/** One HTTP request whose body is appended to a track's file. */
export interface SegmentRequest {
  url: string;
  range?: ByteRange;
  /** AES-128-CBC key for HLS. `iv` is 32 hex digits. */
  key?: { url: string; iv: string };
}

/** The requests of one track, in playback order. Their bodies concatenate to a playable file. */
export type TrackPlan = SegmentRequest[];

export const mediaKey = (tabId: number): string => `media:${tabId}`;
export const JOBS_KEY = "mediaJobs";
