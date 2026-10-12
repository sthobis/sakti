// The download queue as plain data. The worker stores the list in
// chrome.storage.session and the popup renders it. Pure.

import type { MediaKind } from "./types.ts";

export type JobStage = "queued" | "fetching" | "muxing" | "saving" | "done" | "failed" | "cancelled";

export interface Job {
  id: string;
  kind: MediaKind;
  url: string;
  /** Null for a plain file, which has only one. */
  qualityId: string | null;
  /** Origin of the page that played the video, for the Referer header. */
  origin: string;
  title: string;
  fileName: string;
  stage: JobStage;
  /** 0 to 1 within the current stage, or null when unknown. */
  progress: number | null;
  error?: string;
  /** The chrome.downloads item, once the browser is saving the file. */
  downloadId?: number;
  /** True when the offscreen document produces the file, false when Chrome downloads the URL itself. */
  offscreen: boolean;
}

const RUNNING: readonly JobStage[] = ["fetching", "muxing", "saving"];
/** Ended jobs beyond this many are dropped, oldest first. */
const MAX_ENDED = 20;

export const isRunning = (job: Job): boolean => RUNNING.includes(job.stage);
export const isActive = (job: Job): boolean => job.stage === "queued" || isRunning(job);

/** The job to start now, or null while one is running or nothing waits. */
export function nextToRun(jobs: readonly Job[]): Job | null {
  if (jobs.some(isRunning)) return null;
  return jobs.find((job) => job.stage === "queued") ?? null;
}

export function addJob(jobs: readonly Job[], job: Job): Job[] {
  const ended = jobs.filter((existing) => !isActive(existing));
  const dropped = new Set(ended.slice(0, Math.max(0, ended.length - MAX_ENDED)).map((existing) => existing.id));
  return [...jobs.filter((existing) => !dropped.has(existing.id)), job];
}

export function patchJob(jobs: readonly Job[], id: string, patch: Partial<Job>): Job[] {
  return jobs.map((job) => (job.id === id ? { ...job, ...patch } : job));
}

export function removeJob(jobs: readonly Job[], id: string): Job[] {
  return jobs.filter((job) => job.id !== id);
}

/** What the jobs strip says about a job. */
export function describe(job: Job): string {
  const percent = job.progress === null ? "" : ` ${Math.round(job.progress * 100)}%`;
  switch (job.stage) {
    case "queued":
      return "Queued";
    case "fetching":
      return `Downloading${percent}`;
    case "muxing":
      return `Building MP4${percent}`;
    case "saving":
      return `Saving${percent}`;
    case "done":
      return "Saved";
    case "cancelled":
      return "Cancelled";
    case "failed":
      return job.error ?? "Failed";
  }
}
