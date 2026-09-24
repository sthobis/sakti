import { test } from "node:test";
import assert from "node:assert/strict";
import { applyDelete, applySave } from "../src/userscripts/save.ts";
import type { UserscriptsState } from "../src/core/state.ts";

const NOW = "2026-09-24T10:00:00.000Z";
const script = (name: string, match = "https://a.com/*") =>
  `// ==UserScript==\n// @name ${name}\n// @match ${match}\n// ==/UserScript==\nconsole.log(1);\n`;

function saved(state: UserscriptsState, source: string, previousId: string | null) {
  const result = applySave(state, source, previousId, NOW);
  if (!result.ok) throw new Error(result.errors.join(" "));
  return result;
}

test("a new script gets an id from its name and starts enabled", () => {
  const result = saved({}, script("Fix Fonts"), null);
  assert.equal(result.id, "fix-fonts");
  assert.deepEqual(result.next["fix-fonts"], {
    id: "fix-fonts",
    enabled: true,
    source: script("Fix Fonts"),
    meta: { name: "Fix Fonts", matches: ["https://a.com/*"], excludeMatches: [], runAt: "document_idle", world: "MAIN" },
    updatedAt: NOW,
    disabledHosts: [],
  });
});

test("an invalid header is refused with the parser's errors", () => {
  assert.deepEqual(applySave({}, "console.log(1)", null, NOW), { ok: false, errors: ["Missing // ==UserScript== header."] });
});

test("a name without letters or digits is refused", () => {
  assert.deepEqual(applySave({}, script("!!!"), null, NOW), {
    ok: false,
    errors: ["@name must contain at least one letter or digit."],
  });
});

test("a second new script with the same name is refused", () => {
  const first = saved({}, script("Fix Fonts"), null);
  assert.deepEqual(applySave(first.next, script("Fix Fonts", "https://b.com/*"), null, NOW), {
    ok: false,
    errors: ["A script with this name already exists: fix-fonts."],
  });
});

test("editing keeps enabled and disabledHosts", () => {
  const first = saved({}, script("Fix Fonts"), null);
  const state = { "fix-fonts": { ...first.next["fix-fonts"], enabled: false, disabledHosts: ["a.com"] } };
  const second = saved(state, script("Fix Fonts", "https://b.com/*"), "fix-fonts");
  assert.equal(second.next["fix-fonts"].enabled, false);
  assert.deepEqual(second.next["fix-fonts"].disabledHosts, ["a.com"]);
  assert.deepEqual(second.next["fix-fonts"].meta.matches, ["https://b.com/*"]);
});

test("renaming moves the record to the new id and carries its switches", () => {
  const first = saved({}, script("Fix Fonts"), null);
  const state = { "fix-fonts": { ...first.next["fix-fonts"], enabled: false, disabledHosts: ["a.com"] } };
  const renamed = saved(state, script("Better Fonts"), "fix-fonts");
  assert.equal(renamed.id, "better-fonts");
  assert.deepEqual(Object.keys(renamed.next), ["better-fonts"]);
  assert.equal(renamed.next["better-fonts"].enabled, false);
  assert.deepEqual(renamed.next["better-fonts"].disabledHosts, ["a.com"]);
});

test("renaming onto another script's name is refused", () => {
  const a = saved({}, script("A"), null);
  const b = saved(a.next, script("B"), null);
  assert.deepEqual(applySave(b.next, script("A"), "b", NOW), { ok: false, errors: ["A script with this name already exists: a."] });
});

test("applyDelete removes one script", () => {
  const a = saved({}, script("A"), null);
  const b = saved(a.next, script("B"), null);
  assert.deepEqual(Object.keys(applyDelete(b.next, "a")), ["b"]);
});
