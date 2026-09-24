import { test } from "node:test";
import assert from "node:assert/strict";
import { parseHeader } from "../src/userscripts/header.ts";

const header = (...lines: string[]) => ["// ==UserScript==", ...lines, "// ==/UserScript==", "console.log(1);"].join("\n");

test("parses a complete header", () => {
  const result = parseHeader(
    header(
      "// @name         Fix Fonts",
      "// @namespace    sthobis",
      "// @version      1.0",
      "// @description  Makes GitHub readable",
      "// @match        https://github.com/*",
      "// @match        https://gist.github.com/*",
      "// @exclude      https://github.com/settings/*",
      "// @run-at       document-start",
      "// @grant        none",
    ),
  );
  assert.deepEqual(result, {
    meta: {
      name: "Fix Fonts",
      namespace: "sthobis",
      version: "1.0",
      description: "Makes GitHub readable",
      matches: ["https://github.com/*", "https://gist.github.com/*"],
      excludeMatches: ["https://github.com/settings/*"],
      runAt: "document_start",
      world: "MAIN",
    },
    errors: [],
    warnings: [],
  });
});

test("defaults: document_idle, MAIN world when @grant is absent, optional keys omitted", () => {
  const { meta } = parseHeader(header("// @name A", "// @match https://a.com/*"));
  assert.deepEqual(meta, { name: "A", matches: ["https://a.com/*"], excludeMatches: [], runAt: "document_idle", world: "MAIN" });
});

test("accepts CRLF line endings", () => {
  const { meta } = parseHeader(header("// @name A", "// @match https://a.com/*").replace(/\n/g, "\r\n"));
  assert.equal(meta?.name, "A");
});

test("a GM_ grant moves the script to the USER_SCRIPT world with a warning", () => {
  const result = parseHeader(header("// @name A", "// @match https://a.com/*", "// @grant GM_setValue"));
  assert.equal(result.meta?.world, "USER_SCRIPT");
  assert.deepEqual(result.warnings, ["GM_* APIs are not available. The script runs in the isolated USER_SCRIPT world."]);
});

test("missing header lines are errors", () => {
  assert.deepEqual(parseHeader("console.log(1)"), { meta: null, errors: ["Missing // ==UserScript== header."], warnings: [] });
  assert.deepEqual(parseHeader("// ==UserScript==\n// @name A"), {
    meta: null,
    errors: ["Missing // ==/UserScript== closing line."],
    warnings: [],
  });
});

test("@name and @match are required", () => {
  const result = parseHeader(header("// @description nothing"));
  assert.equal(result.meta, null);
  assert.deepEqual(result.errors, ["@name is required.", "At least one @match is required."]);
});

test("@include is rejected once, however many times it appears", () => {
  const result = parseHeader(header("// @name A", "// @match https://a.com/*", "// @include *", "// @include http://*"));
  assert.equal(result.meta, null);
  assert.deepEqual(result.errors, ["@include is not supported. Use @match instead."]);
});

test("an unknown @run-at is an error", () => {
  const result = parseHeader(header("// @name A", "// @match https://a.com/*", "// @run-at document-body"));
  assert.deepEqual(result.errors, ['Unsupported @run-at value "document-body". Use document-start, document-end or document-idle.']);
});

test("unsupported keys warn, descriptive keys and localised names are ignored quietly", () => {
  const result = parseHeader(
    header(
      "// @name A",
      "// @name:ja エー",
      "// @author me",
      "// @match https://a.com/*",
      "// @require https://cdn.example.com/lib.js",
      "// @connect example.com",
    ),
  );
  assert.equal(result.meta?.name, "A");
  assert.deepEqual(result.warnings, ["@require is not supported and was ignored.", "@connect is not supported and was ignored."]);
});
