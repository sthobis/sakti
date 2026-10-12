// Messages of the Videos subsystem. chrome.runtime.sendMessage reaches every
// extension page at once, so the type prefix says who should act: the worker
// handles "sakti:media-*", the offscreen document handles "offscreen:*".

import type { Job, JobStage } from "./jobs.ts";
import type { Detection, Probe } from "./types.ts";

/** Popup to worker. */
export type MediaRequest =
  | { type: "sakti:media-probe"; tabId: number }
  | { type: "sakti:media-reprobe"; tabId: number; url: string }
  | { type: "sakti:media-download"; tabId: number; url: string; qualityId: string | null; title: string }
  | { type: "sakti:media-cancel"; jobId: string }
  | { type: "sakti:media-retry"; jobId: string }
  | { type: "sakti:media-dismiss"; jobId: string };

/** Offscreen document to worker. */
export type OffscreenReport =
  | { type: "sakti:media-hosts"; slot: HeaderSlot; hosts: string[]; origin: string }
  | { type: "sakti:media-progress"; jobId: string; stage: JobStage; progress: number | null }
  | { type: "sakti:media-result"; jobId: string; blobUrl: string }
  | { type: "sakti:media-error"; jobId: string; message: string };

/** Worker to offscreen document. */
export type OffscreenCommand =
  | { type: "offscreen:probe"; detection: Detection }
  | { type: "offscreen:run"; job: Job }
  | { type: "offscreen:cancel"; jobId: string }
  | { type: "offscreen:release"; jobId: string };

/** A probe and a job can run at once, each with its own header rule. */
export type HeaderSlot = "probe" | "job";

export type ProbeResponse = Probe;

/** The offscreen document connects a port under this name, so the worker notices when it dies. */
export const OFFSCREEN_PORT = "sakti-offscreen";

export function sendMediaRequest(request: MediaRequest): Promise<unknown> {
  return chrome.runtime.sendMessage(request);
}
