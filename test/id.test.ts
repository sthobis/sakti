import { test } from "node:test";
import assert from "node:assert/strict";
import { scriptId, slug } from "../src/userscripts/id.ts";

test("slug lowercases, strips accents and collapses everything else to dashes", () => {
  assert.equal(slug("Fix Fonts!"), "fix-fonts");
  assert.equal(slug("  Héllo  Wörld "), "hello-world");
  assert.equal(slug("YouTube: Dislikes (v2)"), "youtube-dislikes-v2");
  assert.equal(slug("日本語"), "");
});

test("scriptId joins namespace and name", () => {
  assert.equal(scriptId("Fix Fonts", "sthobis"), "sthobis/fix-fonts");
  assert.equal(scriptId("Fix Fonts"), "fix-fonts");
  assert.equal(scriptId("Fix Fonts", ""), "fix-fonts");
  assert.equal(scriptId("Fix Fonts", "http://tampermonkey.net/"), "http-tampermonkey-net/fix-fonts");
});
