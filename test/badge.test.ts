import { test } from "node:test";
import assert from "node:assert/strict";
import type { RegistryEntry } from "../src/core/feature.ts";
import type { UserscriptRecord, UserscriptsState } from "../src/core/state.ts";
import type { Detection, Probe } from "../src/media/types.ts";
import { badgeLabel } from "../src/worker/badge-label.ts";

const URL = "https://twivideo.net/list";

function feature(id: string, matches: string[]): RegistryEntry {
  return { id, name: id, matches, excludeMatches: [] } as unknown as RegistryEntry;
}

function script(id: string, matches: string[], extra: Partial<UserscriptRecord> = {}): UserscriptsState {
  const meta = { name: id, matches, excludeMatches: [] } as unknown as UserscriptRecord["meta"];
  return { [id]: { id, enabled: true, source: "", meta, updatedAt: "", disabledHosts: [], ...extra } };
}

function detection(url: string, probe?: Probe): Detection {
  return { url, kind: "hls", size: null, origin: "https://twivideo.net", seenAt: 0, probe };
}

const base = { registry: [], features: {}, userscripts: {}, userScripts: true, detections: [], url: URL };

test("nothing to report leaves the badge empty", () => {
  assert.deepEqual(badgeLabel(base), { text: "", title: "Sakti" });
});

test("the badge counts the videos the popup would list", () => {
  const master = detection("https://a.test/master.m3u8", { status: "ready", qualities: [], duration: 1, hasAudio: true, children: ["https://a.test/720.m3u8"] });
  const child = detection("https://a.test/720.m3u8");
  const audio = detection("https://a.test/audio.m4a", { status: "hidden" });
  const label = badgeLabel({ ...base, detections: [master, child, audio, detection("https://a.test/b.mp4")] });
  assert.equal(label.text, "2");
  assert.equal(label.title, "Sakti\n2 videos");
});

test("the tooltip counts what runs here and what is switched off here", () => {
  const registry = [feature("right-click", ["*://*/*"]), feature("youtube-float", ["https://www.youtube.com/*"]), feature("google-region", ["*://*/*"])];
  const features = { "google-region": { enabled: true, disabledHosts: ["twivideo.net"] } };
  const userscripts = { ...script("load-more", ["*://*.twivideo.net/*"]), ...script("elsewhere", ["*://example.com/*"]) };
  const label = badgeLabel({ ...base, registry, features, userscripts, detections: [detection("https://a.test/a.mp4")] });
  assert.equal(label.text, "1");
  assert.equal(label.title, "Sakti\n1 video\n2 running on twivideo.net\n1 off on twivideo.net");
});

test("a script that is off everywhere, or blocked by Chrome, is not running", () => {
  const off = script("off", ["*://*/*"], { enabled: false });
  const on = script("on", ["*://*/*"]);
  assert.equal(badgeLabel({ ...base, userscripts: { ...off, ...on } }).title, "Sakti\n1 running on twivideo.net");
  assert.equal(badgeLabel({ ...base, userscripts: on, userScripts: false }).title, "Sakti");
});

test("pages Sakti can't run on only report videos", () => {
  const label = badgeLabel({ ...base, registry: [feature("all", ["<all_urls>"])], url: "chrome://extensions/" });
  assert.deepEqual(label, { text: "", title: "Sakti" });
});
