// The worker's half of Videos: the job queue, the offscreen document's
// lifetime, the header rules and the handoff to chrome.downloads. The media
// work itself happens in the offscreen document, which can use nothing but
// chrome.runtime, so every storage write and download call is made here.

import { createQueue } from "../core/queue.ts";
import { extensionOf, fileName } from "../media/filename.ts";
import { addJob, isActive, isRunning, nextToRun, patchJob, removeJob, type Job, type JobStage } from "../media/jobs.ts";
import { OFFSCREEN_PORT, type HeaderSlot, type MediaRequest, type OffscreenCommand, type OffscreenReport } from "../media/messages.ts";
import { JOBS_KEY, type Probe } from "../media/types.ts";
import { readDetections, updateDetections } from "./detections.ts";

const RULE_IDS: Record<HeaderSlot, number> = { probe: 1, job: 2 };

const serializeJobs = createQueue();
const serializePump = createQueue();
const serializeProbes = createQueue();
const serializeSettle = createQueue();
let probesWaiting = 0;
let creatingOffscreen: Promise<void> | null = null;

// ---- storage ----

async function readJobs(): Promise<Job[]> {
  const items = await chrome.storage.session.get(JOBS_KEY);
  return (items[JOBS_KEY] ?? []) as Job[];
}

function updateJobs(change: (jobs: Job[]) => Job[]): Promise<Job[]> {
  return serializeJobs(async () => {
    const next = change(await readJobs());
    await chrome.storage.session.set({ [JOBS_KEY]: next });
    return next;
  });
}

const patch = (id: string, change: Partial<Job>): Promise<Job[]> => updateJobs((jobs) => patchJob(jobs, id, change));

// ---- header rules ----

/**
 * Makes Sakti's own requests to `hosts` look like they come from the page that
 * played the video. Many media servers refuse requests without its Referer.
 */
async function setHeaderRule(slot: HeaderSlot, hosts: readonly string[], origin: string): Promise<void> {
  const id = RULE_IDS[slot];
  const domains = [...new Set(hosts)].filter(Boolean);
  const usable = domains.length > 0 && /^https?:/.test(origin);
  await chrome.declarativeNetRequest.updateSessionRules({
    removeRuleIds: [id],
    addRules: usable
      ? [
          {
            id,
            priority: 1,
            action: {
              type: "modifyHeaders",
              requestHeaders: [
                { header: "Referer", operation: "set", value: `${origin}/` },
                { header: "Origin", operation: "set", value: origin },
              ],
            },
            condition: {
              requestDomains: domains,
              initiatorDomains: [chrome.runtime.id],
              resourceTypes: ["xmlhttprequest", "media", "other"],
            },
          },
        ]
      : [],
  });
}

const clearHeaderRule = (slot: HeaderSlot): Promise<void> => chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [RULE_IDS[slot]] });

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

// ---- offscreen document ----

async function ensureOffscreen(): Promise<void> {
  if (await chrome.offscreen.hasDocument()) return;
  creatingOffscreen ??= chrome.offscreen
    .createDocument({
      url: "offscreen.html",
      reasons: ["BLOBS"],
      justification: "Downloads video segments and joins them into one file for chrome.downloads.",
    })
    .finally(() => {
      creatingOffscreen = null;
    });
  await creatingOffscreen;
}

async function sendToOffscreen<T>(command: OffscreenCommand): Promise<T> {
  await ensureOffscreen();
  return (await chrome.runtime.sendMessage(command)) as T;
}

/** Closes the offscreen document once it holds no job, no finished file and no probe. */
async function closeOffscreenIfIdle(): Promise<void> {
  if (probesWaiting > 0 || creatingOffscreen) return;
  const jobs = await readJobs();
  if (jobs.some((job) => job.offscreen && isActive(job))) return;
  if (await chrome.offscreen.hasDocument()) await chrome.offscreen.closeDocument().catch(() => {});
}

// ---- probing ----

function probeTab(tabId: number): Promise<void> {
  probesWaiting += 1;
  return serializeProbes(async () => {
    try {
      for (const detection of await readDetections(tabId)) {
        if (detection.probe) continue;
        await setHeaderRule("probe", [hostOf(detection.url)], detection.origin);
        const probe = await sendToOffscreen<Probe>({ type: "offscreen:probe", detection }).catch(
          (error: unknown): Probe => ({ status: "error", message: error instanceof Error ? error.message : String(error) }),
        );
        await updateDetections(tabId, (list) => list.map((entry) => (entry.url === detection.url ? { ...entry, probe } : entry)));
      }
    } finally {
      probesWaiting -= 1;
      await clearHeaderRule("probe").catch(() => {});
      await closeOffscreenIfIdle();
    }
  });
}

// ---- running jobs ----

/** Starts the next queued job, unless one is running. */
function pump(): Promise<void> {
  return serializePump(async () => {
    const job = nextToRun(await readJobs());
    if (!job) {
      await closeOffscreenIfIdle();
      return;
    }
    try {
      if (job.offscreen) {
        await patch(job.id, { stage: "fetching", progress: 0 });
        await setHeaderRule("job", [hostOf(job.url)], job.origin);
        await sendToOffscreen({ type: "offscreen:run", job });
      } else {
        // A plain file: Chrome's own downloader fetches the URL.
        await patch(job.id, { stage: "saving", progress: null });
        await setHeaderRule("job", [hostOf(job.url)], job.origin);
        const downloadId = await chrome.downloads.download({ url: job.url, filename: job.fileName, conflictAction: "uniquify" });
        await patch(job.id, { downloadId });
        void settleDownload(downloadId);
      }
    } catch (error) {
      await finish(job.id, { stage: "failed", error: error instanceof Error ? error.message : String(error) });
    }
  });
}

/** Records how a job ended, frees what it held and starts the next one. */
async function finish(jobId: string, change: Partial<Job>): Promise<void> {
  const before = (await readJobs()).find((job) => job.id === jobId);
  await patch(jobId, { ...change, progress: null });
  await clearHeaderRule("job").catch(() => {});
  if (before?.offscreen && (await chrome.offscreen.hasDocument())) {
    await chrome.runtime.sendMessage<OffscreenCommand>({ type: "offscreen:release", jobId }).catch(() => {});
  }
  void pump();
}

async function onReport(report: OffscreenReport): Promise<unknown> {
  if (report.type === "sakti:media-hosts") {
    await setHeaderRule(report.slot, report.hosts, report.origin);
    return { ok: true };
  }
  const job = (await readJobs()).find((entry) => entry.id === report.jobId);
  // A job cancelled while the offscreen document was still working on it.
  if (!job || !isRunning(job)) return undefined;

  if (report.type === "sakti:media-progress") {
    // A late progress report must not undo the move to "saving".
    if (job.stage !== "saving") await patchIfRunning(job.id, { stage: report.stage, progress: report.progress }, ["fetching", "muxing"]);
  } else if (report.type === "sakti:media-error") {
    await finish(job.id, { stage: "failed", error: report.message });
  } else {
    try {
      const downloadId = await chrome.downloads.download({ url: report.blobUrl, filename: job.fileName, conflictAction: "uniquify" });
      const applied = await patchIfRunning(job.id, { stage: "saving", progress: null, downloadId });
      if (applied) void settleDownload(downloadId);
      else await chrome.downloads.cancel(downloadId);
    } catch (error) {
      await finish(job.id, { stage: "failed", error: error instanceof Error ? error.message : String(error) });
    }
  }
  return undefined;
}

/**
 * Applies a change only if the job is still running, and says whether it did.
 * A report can arrive just after the job was cancelled; it must not revive it.
 */
async function patchIfRunning(jobId: string, change: Partial<Job>, stages: readonly JobStage[] = ["fetching", "muxing", "saving"]): Promise<boolean> {
  let applied = false;
  await updateJobs((jobs) => {
    const job = jobs.find((entry) => entry.id === jobId);
    applied = job !== undefined && stages.includes(job.stage);
    return applied ? patchJob(jobs, jobId, change) : jobs;
  });
  return applied;
}

/**
 * Applies what chrome.downloads says about a download to the job that owns it.
 * It is called when Chrome reports a change and again once the job knows its
 * download id, because a download can end before that id has been stored.
 */
function settleDownload(downloadId: number): Promise<void> {
  return serializeSettle(async () => {
    const job = (await readJobs()).find((entry) => entry.downloadId === downloadId && entry.stage === "saving");
    if (!job) return;
    const [item] = await chrome.downloads.search({ id: downloadId });
    if (item?.state === "in_progress") return;
    if (item?.state === "complete") {
      await finish(job.id, { stage: "done" });
      return;
    }
    const reason = item?.error ?? "unknown";
    if (reason === "USER_CANCELED") {
      await finish(job.id, { stage: "cancelled" });
    } else if (!job.offscreen && reason.startsWith("SERVER_")) {
      // The server refused Chrome's downloader, which cannot send the page's
      // Referer. The offscreen document can, so the job gets a second try there.
      await patch(job.id, { stage: "queued", offscreen: true, downloadId: undefined });
      void pump();
    } else {
      await finish(job.id, { stage: "failed", error: `The download stopped (${reason.toLowerCase().replaceAll("_", " ")})` });
    }
  });
}

/**
 * Settles jobs whose state no longer matches reality: the offscreen document
 * died mid-job, or the worker was stopped while Chrome finished a download.
 */
async function recover(): Promise<void> {
  const hasDocument = await chrome.offscreen.hasDocument();
  for (const job of await readJobs()) {
    if (job.stage === "saving" && job.downloadId !== undefined) {
      await settleDownload(job.downloadId);
    } else if (isRunning(job) && job.offscreen && !hasDocument && !creatingOffscreen) {
      await finish(job.id, { stage: "failed", error: "The download was interrupted" });
    }
  }
  void pump();
}

// ---- requests from the popup ----

async function onRequest(request: MediaRequest): Promise<void> {
  switch (request.type) {
    case "sakti:media-probe":
      await probeTab(request.tabId);
      return;
    case "sakti:media-reprobe":
      await updateDetections(request.tabId, (list) => list.map((entry) => (entry.url === request.url ? { ...entry, probe: undefined } : entry)));
      await probeTab(request.tabId);
      return;
    case "sakti:media-download": {
      const detection = (await readDetections(request.tabId)).find((entry) => entry.url === request.url);
      if (!detection) return;
      const qualities = detection.probe?.status === "ready" ? detection.probe.qualities : [];
      const label = qualities.find((quality) => quality.id === request.qualityId)?.label ?? null;
      const isFile = detection.kind === "file";
      const job: Job = {
        id: crypto.randomUUID(),
        kind: detection.kind,
        url: detection.url,
        qualityId: isFile ? null : request.qualityId,
        origin: detection.origin,
        title: request.title,
        fileName: isFile ? fileName(request.title, null, extensionOf(detection.url)) : fileName(request.title, label, "mp4"),
        stage: "queued",
        progress: null,
        offscreen: !isFile,
      };
      await updateJobs((jobs) => addJob(jobs, job));
      await pump();
      return;
    }
    case "sakti:media-cancel": {
      const job = (await readJobs()).find((entry) => entry.id === request.jobId);
      if (!job || !isActive(job)) return;
      if (job.stage === "saving" && job.downloadId !== undefined) {
        await chrome.downloads.cancel(job.downloadId); // ends through onDownloadChanged
        return;
      }
      if (isRunning(job)) await chrome.runtime.sendMessage<OffscreenCommand>({ type: "offscreen:cancel", jobId: job.id }).catch(() => {});
      await finish(job.id, { stage: "cancelled" });
      return;
    }
    case "sakti:media-retry":
      await updateJobs((jobs) => {
        const job = jobs.find((entry) => entry.id === request.jobId);
        if (!job || isActive(job)) return jobs;
        return patchJob(jobs, job.id, { stage: "queued", progress: null, error: undefined, downloadId: undefined });
      });
      await pump();
      return;
    case "sakti:media-dismiss":
      await updateJobs((jobs) => {
        const job = jobs.find((entry) => entry.id === request.jobId);
        return job && !isActive(job) ? removeJob(jobs, job.id) : jobs;
      });
  }
}

/**
 * Handles a Videos message. Returns true when it took the message and will
 * answer through `sendResponse`.
 */
export function handleMediaMessage(message: { type?: string } | undefined, sendResponse: (response?: unknown) => void): boolean {
  const type = message?.type ?? "";
  if (!type.startsWith("sakti:media-")) return false;
  const isReport = type === "sakti:media-hosts" || type === "sakti:media-progress" || type === "sakti:media-result" || type === "sakti:media-error";
  const handled = isReport ? onReport(message as OffscreenReport) : onRequest(message as MediaRequest);
  handled.then(sendResponse, (error: unknown) => {
    console.error("Sakti media:", error);
    sendResponse(undefined);
  });
  return true;
}

export function startMedia(): void {
  chrome.downloads.onChanged.addListener((delta) => {
    if (delta.state) void settleDownload(delta.id);
  });
  chrome.runtime.onConnect.addListener((port) => {
    if (port.name === OFFSCREEN_PORT) port.onDisconnect.addListener(() => void recover());
  });
  void recover();
}
