// The small pure helpers of the Videos subsystem: listing, labels, file
// names, timestamps and the job queue.

import { test } from "node:test";
import assert from "node:assert/strict";
import { extensionOf, fileName, sanitize } from "../src/media/filename.ts";
import { formatDuration, formatSize } from "../src/media/format.ts";
import { visibleDetections } from "../src/media/group.ts";
import { addJob, describe, isActive, nextToRun, patchJob, removeJob, type Job } from "../src/media/jobs.ts";
import { toQualities } from "../src/media/quality.ts";
import { createRetimer, startOffsets } from "../src/media/timestamps.ts";
import type { Detection, Probe } from "../src/media/types.ts";

function detection(url: string, probe?: Probe): Detection {
  return { url, kind: "hls", size: null, origin: "https://page.test", seenAt: 0, probe };
}

function job(id: string, stage: Job["stage"]): Job {
  return { id, kind: "hls", url: "https://a.test/x.m3u8", qualityId: "q", origin: "https://a.test", title: "t", fileName: "t.mp4", stage, progress: null, offscreen: true };
}

test("a playlist that belongs to a listed master is not listed itself", () => {
  const master = detection("https://a.test/master.m3u8", {
    status: "ready",
    qualities: [],
    duration: 1,
    hasAudio: true,
    children: ["https://a.test/720.m3u8"],
  });
  const child = detection("https://a.test/720.m3u8", { status: "ready", qualities: [], duration: 1, hasAudio: true, children: [] });
  const audioOnly = detection("https://a.test/audio.mp4", { status: "hidden" });
  const unprobed = detection("https://a.test/other.m3u8");
  assert.deepEqual(visibleDetections([master, child, audioOnly, unprobed]), [master, unprobed]);
});

test("qualities are sorted best first and labelled", () => {
  const qualities = toQualities([
    { id: "a", height: 360, frameRate: 30, bandwidth: 800_000 },
    { id: "b", height: 1080, frameRate: 59.94, bandwidth: 6_000_000 },
    { id: "c", height: null, frameRate: null, bandwidth: 128_000 },
    { id: "d", height: null, frameRate: null, bandwidth: null },
  ]);
  assert.deepEqual(qualities, [
    { id: "b", label: "1080p60" },
    { id: "a", label: "360p" },
    { id: "c", label: "128 kbps" },
    { id: "d", label: "source" },
  ]);
});

test("two qualities of the same height are told apart by bitrate", () => {
  const qualities = toQualities([
    { id: "lo", height: 720, frameRate: 30, bandwidth: 1_500_000 },
    { id: "hi", height: 720, frameRate: 30, bandwidth: 3_000_000 },
  ]);
  assert.deepEqual(qualities, [
    { id: "hi", label: "720p · 3000 kbps" },
    { id: "lo", label: "720p · 1500 kbps" },
  ]);
});

test("file names lose what the file system refuses", () => {
  assert.equal(sanitize('  A/B: "C" <D>?  '), "A B C D");
  assert.equal(sanitize("..."), "video");
  assert.equal(sanitize("con"), "_con");
  assert.equal(sanitize("x".repeat(300)).length, 120);
  assert.equal(fileName("Streamer - Live on Twitch", "720p60", "mp4"), "Streamer - Live on Twitch (720p60).mp4");
  assert.equal(fileName("clip", "source", "webm"), "clip.webm");
  assert.equal(fileName("", null, "mp4"), "video.mp4");
});

test("the extension comes from the URL path, and defaults to mp4", () => {
  assert.equal(extensionOf("https://a.test/v/clip.WEBM?x=1.exe"), "webm");
  assert.equal(extensionOf("https://a.test/download?id=5"), "mp4");
  assert.equal(extensionOf("https://a.test/page.html"), "mp4");
});

test("tracks on one clock keep their offset, unrelated clocks each start at zero", () => {
  assert.deepEqual(startOffsets([10.02, 10]), [10, 10]);
  assert.deepEqual(startOffsets([10, 0]), [10, 0]);
  assert.deepEqual(startOffsets([3]), [3]);
});

test("timestamps are shifted to start at zero", () => {
  const retime = createRetimer(10);
  assert.equal(retime(10, 1, true), 0);
  assert.equal(retime(12, 1, false), 2);
  assert.equal(retime(11, 1, false), 1); // a frame shown before the one decoded ahead of it
  assert.equal(retime(9.5, 1, false), 0); // nothing is shown before zero
});

test("a group that starts slightly before the previous one ended is nudged forward", () => {
  const retime = createRetimer(0);
  retime(0, 0.04, true);
  retime(0.08, 0.04, false);
  retime(0.04, 0.04, false);
  // the next group claims 0.06, which is before 0.08
  assert.equal(retime(0.06, 0.04, true), 0.08);
  assert.equal(retime(0.07, 0.04, false), 0.08);
  assert.equal(retime(0.12, 0.04, false), 0.12);
});

test("a restarted clock continues where the stream had got to", () => {
  const retime = createRetimer(100);
  assert.equal(retime(100, 2, true), 0);
  assert.equal(retime(102, 2, true), 2);
  // discontinuity: the clock restarts at 5
  assert.equal(retime(5, 2, true), 4);
  assert.equal(retime(7, 2, true), 6);
  // and a jump far ahead is closed up too
  assert.equal(retime(500, 2, true), 8);
});

test("one job runs at a time, in the order added", () => {
  let jobs: Job[] = [];
  jobs = addJob(jobs, job("a", "queued"));
  jobs = addJob(jobs, job("b", "queued"));
  assert.equal(nextToRun(jobs)!.id, "a");
  jobs = patchJob(jobs, "a", { stage: "fetching", progress: 0.5 });
  assert.equal(nextToRun(jobs), null);
  jobs = patchJob(jobs, "a", { stage: "done" });
  assert.equal(nextToRun(jobs)!.id, "b");
  assert.deepEqual(
    removeJob(jobs, "a").map((entry) => entry.id),
    ["b"],
  );
  assert.equal(nextToRun([]), null);
});

test("old ended jobs are dropped, active ones never are", () => {
  let jobs: Job[] = [job("active", "queued")];
  for (let i = 0; i < 25; i += 1) jobs = addJob(jobs, job(`done${i}`, "done"));
  jobs = addJob(jobs, job("new", "queued"));
  assert.equal(jobs.filter((entry) => !isActive(entry)).length, 20);
  assert.ok(jobs.some((entry) => entry.id === "active"));
  assert.ok(!jobs.some((entry) => entry.id === "done0"));
  assert.ok(jobs.some((entry) => entry.id === "done24"));
});

test("a job is described by its stage", () => {
  assert.equal(describe({ ...job("a", "fetching"), progress: 0.426 }), "Downloading 43%");
  assert.equal(describe(job("a", "muxing")), "Building MP4");
  assert.equal(describe({ ...job("a", "failed"), error: "HTTP 403" }), "HTTP 403");
  assert.equal(describe(job("a", "failed")), "Failed");
});

test("durations and sizes are written for people", () => {
  assert.equal(formatDuration(187.4), "3:07");
  assert.equal(formatDuration(3729), "1:02:09");
  assert.equal(formatDuration(0), "0:00");
  assert.equal(formatSize(640 * 1024), "640 KB");
  assert.equal(formatSize(12 * 1024 * 1024), "12 MB");
  assert.equal(formatSize(1.4 * 1024 ** 3), "1.4 GB");
  assert.equal(formatSize(500), "500 B");
});
