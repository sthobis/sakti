// The offscreen document. The worker opens it when there is media work to do
// and closes it afterwards. It has the DOM APIs the worker lacks (blob URLs,
// the private file system) but only chrome.runtime, so it reports everything
// to the worker by message.

import type { Job, JobStage } from "../media/jobs.ts";
import { OFFSCREEN_PORT, type OffscreenCommand, type OffscreenReport } from "../media/messages.ts";
import type { Probe } from "../media/types.ts";
import { fetchTracks } from "./fetcher.ts";
import { createFile, removeFiles } from "./files.ts";
import { muxToMp4 } from "./mux.ts";
import { plan, probe } from "./resolve.ts";

const PROGRESS_INTERVAL_MS = 500;

/** Jobs being worked on, by id. */
const running = new Map<string, AbortController>();
/** Blob URLs of finished files that chrome.downloads is still reading. */
const held = new Map<string, string>();

// Scratch files left behind by a run that crashed.
const ready = removeFiles("").catch(() => {});

function report(message: OffscreenReport): Promise<void> {
  return chrome.runtime.sendMessage(message).then(
    () => {},
    () => {},
  );
}

/** Reports progress at most twice a second, and always when the stage changes. */
function createProgress(jobId: string): (stage: JobStage, progress: number | null) => void {
  let lastStage: JobStage | null = null;
  let lastTime = 0;
  return (stage, progress) => {
    const now = Date.now();
    if (stage === lastStage && now - lastTime < PROGRESS_INTERVAL_MS) return;
    lastStage = stage;
    lastTime = now;
    void report({ type: "sakti:media-progress", jobId, stage, progress });
  };
}

async function run(job: Job): Promise<void> {
  const controller = new AbortController();
  const { signal } = controller;
  running.set(job.id, controller);
  const progress = createProgress(job.id);
  try {
    await ready;
    const tracks = await plan(job, signal);
    const parts = await Promise.all(tracks.map((_track, index) => createFile(`${job.id}.part${index}`)));
    await fetchTracks(tracks, parts, signal, (fraction) => progress("fetching", fraction));

    let result = parts[0]!;
    if (job.kind !== "file") {
      progress("muxing", 0);
      result = await createFile(`${job.id}.mp4`);
      const sources = await Promise.all(parts.map((part) => part.getFile()));
      await muxToMp4(sources, await result.createWritable(), { signal, onProgress: (fraction) => progress("muxing", fraction) });
      await removeFiles(`${job.id}.part`);
    }

    const file = await result.getFile();
    if (file.size === 0) throw new Error("The server sent an empty file");
    signal.throwIfAborted();
    const blobUrl = URL.createObjectURL(file);
    held.set(job.id, blobUrl);
    await report({ type: "sakti:media-result", jobId: job.id, blobUrl });
  } catch (error) {
    await removeFiles(job.id).catch(() => {});
    if (!signal.aborted) await report({ type: "sakti:media-error", jobId: job.id, message: error instanceof Error ? error.message : String(error) });
  } finally {
    running.delete(job.id);
  }
}

/** Frees everything a job holds. The worker calls it when the job has ended, however it ended. */
async function release(jobId: string): Promise<void> {
  running.get(jobId)?.abort();
  const blobUrl = held.get(jobId);
  if (blobUrl) URL.revokeObjectURL(blobUrl);
  held.delete(jobId);
  await removeFiles(jobId).catch(() => {});
}

chrome.runtime.onMessage.addListener((message: OffscreenCommand | undefined, _sender, sendResponse) => {
  switch (message?.type) {
    case "offscreen:probe":
      probe(message.detection).then(sendResponse, (error: unknown) => {
        const failed: Probe = { status: "error", message: error instanceof Error ? error.message : String(error) };
        sendResponse(failed);
      });
      return true; // keeps the channel open for the async response
    case "offscreen:run":
      void run(message.job);
      sendResponse({ ok: true });
      return false;
    case "offscreen:cancel":
      running.get(message.jobId)?.abort();
      return false;
    case "offscreen:release":
      void release(message.jobId);
      return false;
    default:
      return false; // a message for the worker
  }
});

// The worker watches this port: if this document dies, the port closes and the
// worker fails the running job. Chrome also closes the port when it stops an
// idle worker, so it is reopened.
function connect(): void {
  const port = chrome.runtime.connect({ name: OFFSCREEN_PORT });
  port.onDisconnect.addListener(() => setTimeout(connect, 1000));
}
connect();
