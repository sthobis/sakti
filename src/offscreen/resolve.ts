// Turns a detected URL into what the popup shows about it (a probe) and into
// what a download has to fetch (a plan). Both read the same manifests, so they
// live together.

import { ALL_FORMATS, Input, UrlSource } from "mediabunny";
import type { Job } from "../media/jobs.ts";
import { audioFor, parsePlaylist, type MasterPlaylist, type MediaPlaylist, type Variant } from "../media/m3u8.ts";
import type { HeaderSlot } from "../media/messages.ts";
import { bestAudio, parseManifest } from "../media/mpd.ts";
import { toQualities, type Rendering } from "../media/quality.ts";
import type { Detection, Probe, Quality, TrackPlan } from "../media/types.ts";
import { allowHosts, fetchText } from "./net.ts";

const SOURCE: Quality[] = [{ id: "source", label: "source" }];
const PROBE_TIMEOUT_MS = 20_000;

/** Two variants with the same size and bitrate are the same stream on another server. */
const variantId = (variant: Variant): string => `${variant.height ?? 0}x${variant.bandwidth ?? 0}`;

function uniqueById(renderings: Rendering[]): Rendering[] {
  const seen = new Set<string>();
  return renderings.filter((rendering) => !seen.has(rendering.id) && seen.add(rendering.id));
}

function hlsQualities(master: MasterPlaylist): Quality[] {
  return toQualities(
    uniqueById(master.variants.map((variant) => ({ id: variantId(variant), height: variant.height, frameRate: variant.frameRate, bandwidth: variant.bandwidth }))),
  );
}

async function loadMediaPlaylist(url: string, signal: AbortSignal): Promise<MediaPlaylist> {
  const loaded = await fetchText(url, signal);
  const playlist = parsePlaylist(loaded.text, loaded.url);
  if (playlist.type !== "media") throw new Error("The playlist points at another list of qualities");
  return playlist;
}

function mediaStatus(playlist: MediaPlaylist, qualities: Quality[], children: string[]): Probe {
  if (playlist.protection === "drm") return { status: "protected", children };
  if (!playlist.ended) return { status: "live", children };
  return { status: "ready", qualities, duration: playlist.duration, hasAudio: true, children };
}

async function probeHls(detection: Detection, signal: AbortSignal): Promise<Probe> {
  const loaded = await fetchText(detection.url, signal);
  const playlist = parsePlaylist(loaded.text, loaded.url);
  if (playlist.type === "media") return mediaStatus(playlist, SOURCE, []);

  const qualities = hlsQualities(playlist);
  const best = playlist.variants.find((variant) => variantId(variant) === qualities[0]?.id);
  if (!best) return { status: "error", message: "The playlist lists no video" };
  const audio = playlist.audio.flatMap((rendition) => (rendition.url ? [rendition.url] : []));
  const children = [...playlist.variants.map((variant) => variant.url), ...audio];
  await allowHosts("probe", [detection.url, ...children], detection.origin);
  return mediaStatus(await loadMediaPlaylist(best.url, signal), qualities, children);
}

async function probeDash(detection: Detection, signal: AbortSignal): Promise<Probe> {
  const loaded = await fetchText(detection.url, signal);
  const manifest = parseManifest(loaded.text, loaded.url);
  // A representation that is one whole file is also seen as a file on its own.
  const children = [...manifest.video, ...manifest.audio].flatMap((representation) =>
    representation.requests.length === 1 ? [representation.requests[0]!.url] : [],
  );
  if (manifest.protected) return { status: "protected", children };
  if (manifest.live) return { status: "live", children };
  if (manifest.periods > 1) return { status: "error", message: "Streams made of several periods are not supported" };
  if (manifest.video.length === 0) return { status: "hidden" };
  const qualities = toQualities(uniqueById(manifest.video.map(({ id, height, frameRate, bandwidth }) => ({ id, height, frameRate, bandwidth }))));
  return { status: "ready", qualities, duration: manifest.duration, hasAudio: manifest.audio.length > 0, children };
}

async function probeFile(detection: Detection): Promise<Probe> {
  const source = new UrlSource(detection.url, {
    requestInit: { credentials: "include" },
    getRetryDelay: (previousAttempts) => (previousAttempts < 2 ? 0.5 : null),
  });
  const input = new Input({ formats: ALL_FORMATS, source });
  try {
    // Not every server allows the range requests needed to read the header.
    // A file that cannot be inspected is still a file that can be saved.
    if (!(await input.canRead())) return { status: "ready", qualities: SOURCE, duration: null, hasAudio: true, children: [] };
    const video = await input.getPrimaryVideoTrack();
    if (!video) return { status: "hidden" };
    const height = await video.getDisplayHeight();
    return {
      status: "ready",
      qualities: [{ id: "source", label: height ? `${height}p` : "source" }],
      duration: await input.getDurationFromMetadata(),
      hasAudio: (await input.getPrimaryAudioTrack()) !== null,
      children: [],
    };
  } catch {
    return { status: "ready", qualities: SOURCE, duration: null, hasAudio: true, children: [] };
  } finally {
    input.dispose();
  }
}

export async function probe(detection: Detection): Promise<Probe> {
  const signal = AbortSignal.timeout(PROBE_TIMEOUT_MS);
  try {
    if (detection.kind === "hls") return await probeHls(detection, signal);
    if (detection.kind === "dash") return await probeDash(detection, signal);
    return await probeFile(detection);
  } catch (error) {
    const message = signal.aborted ? "The server took too long to answer" : error instanceof Error ? error.message : String(error);
    return { status: "error", message };
  }
}

function assertDownloadable(playlist: MediaPlaylist): void {
  if (playlist.protection === "drm") throw new Error("This stream is protected and cannot be downloaded");
  if (!playlist.ended) throw new Error("This is a live stream; recording is not supported yet");
}

async function planHls(job: Job, signal: AbortSignal): Promise<TrackPlan[]> {
  const loaded = await fetchText(job.url, signal);
  const playlist = parsePlaylist(loaded.text, loaded.url);
  if (playlist.type === "media") {
    assertDownloadable(playlist);
    return [playlist.requests];
  }

  const variant = playlist.variants.find((candidate) => variantId(candidate) === job.qualityId);
  if (!variant) throw new Error("The stream no longer offers this quality; reload the page and try again");
  const audioUrl = audioFor(playlist, variant);
  await allowHosts("job", [job.url, variant.url, audioUrl ?? ""], job.origin);

  const video = await loadMediaPlaylist(variant.url, signal);
  assertDownloadable(video);
  if (!audioUrl) return [video.requests];
  const audio = await loadMediaPlaylist(audioUrl, signal);
  assertDownloadable(audio);
  return [video.requests, audio.requests];
}

async function planDash(job: Job, signal: AbortSignal): Promise<TrackPlan[]> {
  const loaded = await fetchText(job.url, signal);
  const manifest = parseManifest(loaded.text, loaded.url);
  if (manifest.protected) throw new Error("This stream is protected and cannot be downloaded");
  if (manifest.live) throw new Error("This is a live stream; recording is not supported yet");
  if (manifest.periods > 1) throw new Error("Streams made of several periods are not supported");
  const video = manifest.video.find((representation) => representation.id === job.qualityId);
  if (!video) throw new Error("The stream no longer offers this quality; reload the page and try again");
  const audio = bestAudio(manifest);
  return audio ? [video.requests, audio.requests] : [video.requests];
}

/** The requests of each track of a job. Every host they name gets the page's Referer. */
export async function plan(job: Job, signal: AbortSignal): Promise<TrackPlan[]> {
  const slot: HeaderSlot = "job";
  const tracks = job.kind === "hls" ? await planHls(job, signal) : job.kind === "dash" ? await planDash(job, signal) : [[{ url: job.url }]];
  const urls = tracks.flat().flatMap((request) => (request.key ? [request.url, request.key.url] : [request.url]));
  await allowHosts(slot, [job.url, ...urls], job.origin);
  return tracks;
}
