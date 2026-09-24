import { test } from "node:test";
import assert from "node:assert/strict";
import { buildExport, mergeImport, parseImport, pickSettings, type Snapshot } from "../src/core/backup.ts";

const SOURCE = "// ==UserScript==\n// @name Fix Fonts\n// @match https://a.com/*\n// ==/UserScript==\n";
const META = { name: "Fix Fonts", matches: ["https://a.com/*"], excludeMatches: [], runAt: "document_idle" as const, world: "MAIN" as const };

const snapshot: Snapshot = {
  features: { "comment-mode": { enabled: false, disabledHosts: [] } },
  userscripts: {
    "fix-fonts": { id: "fix-fonts", enabled: true, source: SOURCE, meta: META, updatedAt: "2026-09-01T00:00:00.000Z", disabledHosts: ["b.com"] },
  },
  settings: { sync: { "feature:comment-mode": { geometry: { top: 1, left: 2, width: 3, height: 4 } } }, local: {} },
};

test("pickSettings keeps only feature settings keys", () => {
  assert.deepEqual(pickSettings({ "feature:a": 1, features: {}, other: 2 }), { "feature:a": 1 });
});

test("an export parses back to the same data", () => {
  const file = buildExport(snapshot, "2026-09-24T00:00:00.000Z");
  assert.equal(file.sakti, 1);
  assert.equal(file.exportedAt, "2026-09-24T00:00:00.000Z");
  assert.deepEqual(parseImport(JSON.stringify(file)), { ok: true, file });
});

test("import rejects files that are not Sakti backups", () => {
  assert.deepEqual(parseImport("{not json"), { ok: false, error: "Not a valid JSON file." });
  assert.deepEqual(parseImport('{"hello":1}'), { ok: false, error: "Not a Sakti backup file." });
  assert.deepEqual(parseImport('{"sakti":1,"features":{}}'), { ok: false, error: "The backup file is incomplete." });
});

test("import rejects a malformed feature entry", () => {
  const file = { ...buildExport(snapshot, "x"), features: { a: { enabled: "yes" } } };
  assert.deepEqual(parseImport(JSON.stringify(file)), { ok: false, error: 'Feature "a" has an invalid entry.' });
});

test("import re-derives userscript meta and id from the source", () => {
  const file = buildExport(snapshot, "x");
  const tampered = { ...file, userscripts: { whatever: { ...file.userscripts["fix-fonts"], id: "whatever", meta: { name: "lies" } } } };
  const result = parseImport(JSON.stringify(tampered));
  assert.ok(result.ok);
  if (!result.ok) return;
  assert.deepEqual(Object.keys(result.file.userscripts), ["fix-fonts"]);
  assert.deepEqual(result.file.userscripts["fix-fonts"].meta, META);
});

test("import rejects a userscript whose header is invalid", () => {
  const file = buildExport(snapshot, "x");
  const broken = { ...file, userscripts: { x: { source: "console.log(1)" } } };
  assert.deepEqual(parseImport(JSON.stringify(broken)), {
    ok: false,
    error: 'Userscript "x" has an invalid header: Missing // ==UserScript== header.',
  });
});

test("merge replaces entries with the same id and keeps local-only ones", () => {
  const local: Snapshot = {
    features: { "comment-mode": { enabled: true, disabledHosts: [] }, "enable-right-click": { enabled: true, disabledHosts: ["x.com"] } },
    userscripts: {},
    settings: { sync: {}, local: { "feature:other": { a: 1 } } },
  };
  const merged = mergeImport(local, snapshot);
  assert.deepEqual(merged.features, {
    "comment-mode": { enabled: false, disabledHosts: [] },
    "enable-right-click": { enabled: true, disabledHosts: ["x.com"] },
  });
  assert.deepEqual(Object.keys(merged.userscripts), ["fix-fonts"]);
  assert.deepEqual(merged.settings, { sync: snapshot.settings.sync, local: { "feature:other": { a: 1 } } });
});
