import { test } from "node:test";
import assert from "node:assert/strict";
import { defineFeature } from "../src/core/feature.ts";

test("defineFeature returns the descriptor unchanged", () => {
  const descriptor = {
    id: "demo",
    name: "Demo",
    description: "A demo feature.",
    matches: ["https://example.com/*"],
    scripts: { main: "./main.ts" },
  };
  assert.equal(defineFeature(descriptor), descriptor);
});
