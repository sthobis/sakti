// The Videos tab: what the current tab has loaded, and the downloads in
// progress. It reads chrome.storage.session, which the worker writes, and
// re-renders on every change. All work is asked of the worker by message.

import { el } from "../../core/dom.ts";
import { extensionOf } from "../../media/filename.ts";
import { formatDuration, formatSize } from "../../media/format.ts";
import { visibleDetections } from "../../media/group.ts";
import { describe, isActive, type Job } from "../../media/jobs.ts";
import { sendMediaRequest } from "../../media/messages.ts";
import { JOBS_KEY, mediaKey, type Detection } from "../../media/types.ts";

const SAVING_POLL_MS = 500;

export interface VideosState {
  /** Videos listed for the current tab. */
  count: number;
  /** True while any download is queued or running. */
  busy: boolean;
}

let tab: chrome.tabs.Tab | undefined;
let detections: Detection[] = [];
let jobs: Job[] = [];
let probing = false;
let onState: (state: VideosState) => void = () => {};
/** The quality picked per video, kept across re-renders. */
const picked = new Map<string, string>();

const title = (): string => tab?.title?.trim() || "video";

function kindTag(detection: Detection): string {
  if (detection.kind === "file") return extensionOf(detection.url).toUpperCase();
  return detection.kind.toUpperCase();
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

function renderVideo(detection: Detection): HTMLLIElement {
  const { probe } = detection;
  const tabId = tab!.id!;
  const head = el("div", { class: "video-head" }, [
    el("span", { class: "tag", text: probe?.status === "live" ? "LIVE" : probe?.status === "protected" ? "DRM" : kindTag(detection) }),
    el("span", { class: "name", title: detection.url, text: title() }),
  ]);
  const meta = el("div", { class: "video-meta" });
  const item = el("li", { class: "video" }, [head, meta]);

  if (!probe) {
    meta.textContent = "Checking…";
  } else if (probe.status === "live") {
    meta.textContent = "Live recording isn't supported yet.";
  } else if (probe.status === "protected") {
    meta.textContent = "Protected stream. It can't be downloaded.";
  } else if (probe.status === "error") {
    const retry = el("a", { href: "#", text: "Retry" });
    retry.addEventListener("click", (event) => {
      event.preventDefault();
      void sendMediaRequest({ type: "sakti:media-reprobe", tabId, url: detection.url });
    });
    meta.classList.add("problem");
    meta.append(`${probe.message}. `, retry);
  } else if (probe.status === "ready") {
    const facts = [
      probe.duration ? formatDuration(probe.duration) : "",
      detection.size ? formatSize(detection.size) : "",
      probe.hasAudio ? "" : "video only",
      hostOf(detection.url),
    ];
    meta.textContent = facts.filter(Boolean).join(" · ");

    const select = el("select", { "aria-label": "Quality" });
    for (const quality of probe.qualities) select.append(el("option", { value: quality.id, text: quality.label }));
    const remembered = picked.get(detection.url);
    if (remembered && probe.qualities.some((quality) => quality.id === remembered)) select.value = remembered;
    select.disabled = probe.qualities.length < 2;
    select.addEventListener("change", () => picked.set(detection.url, select.value));

    const download = el("button", { class: "primary", type: "button", text: "Download" });
    download.addEventListener("click", () => {
      download.disabled = true;
      void sendMediaRequest({ type: "sakti:media-download", tabId, url: detection.url, qualityId: select.value || null, title: title() });
    });
    item.append(el("div", { class: "video-actions" }, [select, download]));
  }
  return item;
}

function renderJob(job: Job): HTMLLIElement {
  const active = isActive(job);
  const status = el("span", { class: "job-status", text: describe(job) });
  if (job.stage === "failed") status.classList.add("problem");

  const actions: HTMLElement[] = [];
  const action = (text: string, run: () => void): void => {
    const link = el("a", { href: "#", text });
    link.addEventListener("click", (event) => {
      event.preventDefault();
      run();
    });
    actions.push(link);
  };
  if (active) {
    action("Cancel", () => void sendMediaRequest({ type: "sakti:media-cancel", jobId: job.id }));
  } else {
    if (job.stage === "done" && job.downloadId !== undefined) action("Show in folder", () => chrome.downloads.show(job.downloadId!));
    if (job.stage !== "done") action("Retry", () => void sendMediaRequest({ type: "sakti:media-retry", jobId: job.id }));
    action("Dismiss", () => void sendMediaRequest({ type: "sakti:media-dismiss", jobId: job.id }));
  }

  const bar = el("progress", { max: "1" });
  if (job.progress !== null) bar.value = job.progress;
  bar.hidden = !active || job.stage === "queued";

  return el("li", { class: "job", dataset: { job: job.id } }, [
    el("div", { class: "job-head" }, [el("span", { class: "name", title: job.fileName, text: job.fileName }), ...actions]),
    bar,
    status,
  ]);
}

function render(): void {
  const visible = tab?.id === undefined ? [] : visibleDetections(detections);
  document.getElementById("videos")!.replaceChildren(...visible.map(renderVideo));
  document.getElementById("videos-empty")!.hidden = visible.length > 0;

  const shown = [...jobs].reverse(); // newest first
  document.querySelector("#jobs ul")!.replaceChildren(...shown.map(renderJob));
  document.getElementById("jobs")!.hidden = shown.length === 0;

  onState({ count: visible.length, busy: jobs.some(isActive) });
}

/** Asks the worker to look into detections it has not examined yet. */
async function probe(): Promise<void> {
  if (probing || tab?.id === undefined) return;
  probing = true;
  try {
    // New videos can turn up while the worker is busy, so look again, but not forever.
    for (let round = 0; round < 5 && detections.some((detection) => !detection.probe); round += 1) {
      await sendMediaRequest({ type: "sakti:media-probe", tabId: tab.id });
      await load(); // the worker has written the results by now
    }
  } finally {
    probing = false;
  }
}

async function load(): Promise<void> {
  const key = tab?.id === undefined ? null : mediaKey(tab.id);
  const items = await chrome.storage.session.get(key ? [key, JOBS_KEY] : [JOBS_KEY]);
  detections = key ? ((items[key] ?? []) as Detection[]) : [];
  jobs = (items[JOBS_KEY] ?? []) as Job[];
  render();
}

/**
 * While Chrome itself saves a file, the job carries no progress: the numbers
 * are in chrome.downloads. This fills the bar from there.
 */
async function showSavingProgress(): Promise<void> {
  for (const job of jobs) {
    if (job.stage !== "saving" || job.downloadId === undefined) continue;
    const [item] = await chrome.downloads.search({ id: job.downloadId });
    const row = document.querySelector(`li.job[data-job="${job.id}"]`);
    if (!item || !row || item.totalBytes <= 0) continue;
    const fraction = item.bytesReceived / item.totalBytes;
    row.querySelector("progress")!.value = fraction;
    row.querySelector(".job-status")!.textContent = `Saving ${Math.round(fraction * 100)}%`;
  }
}

/** Renders the tab and keeps it current. `listener` is told how many videos there are after every render. */
export async function initVideos(currentTab: chrome.tabs.Tab | undefined, listener: (state: VideosState) => void): Promise<VideosState> {
  tab = currentTab;
  onState = listener;
  await load();
  void probe();

  chrome.storage.session.onChanged.addListener((changes) => {
    const key = tab?.id === undefined ? null : mediaKey(tab.id);
    if (!changes[JOBS_KEY] && !(key && changes[key])) return;
    void load().then(probe);
  });
  setInterval(() => void showSavingProgress(), SAVING_POLL_MS);

  return { count: visibleDetections(detections).length, busy: jobs.some(isActive) };
}
