import { test } from "node:test";
import assert from "node:assert/strict";
import { parseRoute, routeHash } from "../src/ui/options/route.ts";

test("parseRoute reads the tab and an optional id", () => {
  assert.deepEqual(parseRoute(""), { tab: "features", id: null });
  assert.deepEqual(parseRoute("#backup"), { tab: "backup", id: null });
  assert.deepEqual(parseRoute("#features/comment-mode"), { tab: "features", id: "comment-mode" });
  assert.deepEqual(parseRoute("#userscripts/sthobis/fix-fonts"), { tab: "userscripts", id: "sthobis/fix-fonts" });
  assert.deepEqual(parseRoute("#userscripts/"), { tab: "userscripts", id: null });
});

test("unknown tabs and malformed hashes fall back to the features tab", () => {
  assert.deepEqual(parseRoute("#nonsense/x"), { tab: "features", id: null });
  assert.deepEqual(parseRoute("#userscripts/%E0%A4%A"), { tab: "features", id: null });
});

test("routeHash is the inverse of parseRoute", () => {
  assert.equal(routeHash({ tab: "userscripts", id: "sthobis/fix-fonts" }), "#userscripts/sthobis/fix-fonts");
  assert.equal(routeHash({ tab: "backup", id: null }), "#backup");
  assert.deepEqual(parseRoute(routeHash({ tab: "features", id: "comment-mode" })), { tab: "features", id: "comment-mode" });
});
