import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Feature } from "../src/core/feature.ts";
import { buildManifest } from "../scripts/manifest.ts";
import { toRegistryEntry, validateFeature } from "../scripts/validate.ts";
import { buildZip } from "../scripts/zip.ts";

const demo: Feature = {
  id: "demo",
  name: "Demo",
  description: "A demo feature.",
  matches: ["https://example.com/*"],
  scripts: { main: "./main.ts" },
};

test("a valid descriptor has no errors", () => {
  assert.deepEqual(validateFeature(demo, "demo", () => true), []);
});

test("the id must equal the folder name", () => {
  assert.deepEqual(validateFeature(demo, "other", () => true), [
    'features/other/feature.ts: id "demo" must equal the folder name "other".',
  ]);
});

test("script files must exist", () => {
  assert.deepEqual(validateFeature(demo, "demo", () => false), ['features/demo/feature.ts: scripts.main file "./main.ts" does not exist.']);
});

test("match patterns must compile", () => {
  assert.deepEqual(validateFeature({ ...demo, matches: ["example.com"] }, "demo", () => true), [
    'features/demo/feature.ts: invalid match pattern "example.com".',
  ]);
});

test("at least one script is required", () => {
  assert.deepEqual(validateFeature({ ...demo, scripts: {} }, "demo", () => true), [
    "features/demo/feature.ts: scripts must name at least one of content, main, css.",
  ]);
});

test("a non-object default export is rejected", () => {
  assert.deepEqual(validateFeature(undefined, "demo", () => true), ["features/demo/feature.ts: default export must be a feature descriptor."]);
});

test("toRegistryEntry fills defaults and points at dist paths", () => {
  assert.deepEqual(toRegistryEntry({ ...demo, scripts: { content: "./c.ts", main: "./m.ts", css: "./s.css" } }), {
    id: "demo",
    name: "Demo",
    description: "A demo feature.",
    matches: ["https://example.com/*"],
    excludeMatches: [],
    runAt: "document_idle",
    allFrames: false,
    matchOriginAsFallback: false,
    perSite: false,
    settings: {},
    files: { content: "features/demo/content.js", main: "features/demo/main.js", css: "features/demo/content.css" },
  });
});

test("buildManifest unions permissions and collapses host permissions to <all_urls> when present", () => {
  const base = { name: "Sakti", permissions: ["storage"], host_permissions: [] };
  const manifest = buildManifest(base, [demo, { ...demo, id: "b", matches: ["<all_urls>"], permissions: ["tabs", "storage"] }], "1.2.3");
  assert.equal(manifest.version, "1.2.3");
  assert.deepEqual(manifest.permissions, ["storage", "tabs"]);
  assert.deepEqual(manifest.host_permissions, ["<all_urls>"]);
  assert.deepEqual(buildManifest(base, [demo], "1").host_permissions, ["https://example.com/*"]);
});

test("buildZip stores every file under its relative path", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sakti-zip-"));
  try {
    fs.mkdirSync(path.join(dir, "icons"));
    fs.writeFileSync(path.join(dir, "manifest.json"), "{}");
    fs.writeFileSync(path.join(dir, "icons", "a.txt"), "hello hello hello hello");
    const zip = buildZip(dir);
    assert.equal(zip.readUInt32LE(0), 0x04034b50);
    const eocd = zip.length - 22;
    assert.equal(zip.readUInt32LE(eocd), 0x06054b50);
    assert.equal(zip.readUInt16LE(eocd + 10), 2);
    const text = zip.toString("latin1");
    assert.ok(text.includes("icons/a.txt"));
    assert.ok(text.includes("manifest.json"));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
