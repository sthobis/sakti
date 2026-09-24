import { test } from "node:test";
import assert from "node:assert/strict";
import { featureState, toggleHost } from "../src/core/state.ts";

test("features default to enabled everywhere", () => {
  assert.deepEqual(featureState({}, "comment-mode"), { enabled: true, disabledHosts: [] });
  const stored = { "comment-mode": { enabled: false, disabledHosts: ["a.com"] } };
  assert.deepEqual(featureState(stored, "comment-mode"), { enabled: false, disabledHosts: ["a.com"] });
});

test("toggleHost adds and removes a host without duplicates", () => {
  assert.deepEqual(toggleHost([], "a.com", true), ["a.com"]);
  assert.deepEqual(toggleHost(["a.com"], "a.com", true), ["a.com"]);
  assert.deepEqual(toggleHost(["a.com", "b.com"], "a.com", false), ["b.com"]);
  assert.deepEqual(toggleHost(["b.com"], "a.com", false), ["b.com"]);
});
