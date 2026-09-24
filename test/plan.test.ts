import { test } from "node:test";
import assert from "node:assert/strict";
import type { RegistryEntry } from "../src/core/feature.ts";
import type { UserscriptsState } from "../src/core/state.ts";
import { desiredContentScripts, desiredUserScripts, diff, normalizeContentScript, normalizeUserScript } from "../src/worker/plan.ts";

const COMMENT_MODE: RegistryEntry = {
  id: "comment-mode",
  name: "Comment Mode",
  description: "d",
  matches: ["https://www.youtube.com/*"],
  excludeMatches: [],
  runAt: "document_idle",
  allFrames: false,
  matchOriginAsFallback: false,
  perSite: false,
  settings: {},
  files: {
    content: "features/comment-mode/content.js",
    main: "features/comment-mode/main.js",
    css: "features/comment-mode/content.css",
  },
};

const RIGHT_CLICK: RegistryEntry = {
  id: "enable-right-click",
  name: "Enable Right Click",
  description: "d",
  matches: ["<all_urls>"],
  excludeMatches: [],
  runAt: "document_start",
  allFrames: true,
  matchOriginAsFallback: true,
  perSite: true,
  settings: {},
  files: { main: "features/enable-right-click/main.js" },
};

test("each enabled feature becomes one registration per world", () => {
  assert.deepEqual(desiredContentScripts([COMMENT_MODE, RIGHT_CLICK], {}), [
    {
      id: "comment-mode",
      matches: ["https://www.youtube.com/*"],
      excludeMatches: [],
      js: ["features/comment-mode/content.js"],
      css: ["features/comment-mode/content.css"],
      world: "ISOLATED",
      runAt: "document_idle",
      allFrames: false,
      matchOriginAsFallback: false,
      persistAcrossSessions: true,
    },
    {
      id: "comment-mode:main",
      matches: ["https://www.youtube.com/*"],
      excludeMatches: [],
      js: ["features/comment-mode/main.js"],
      css: [],
      world: "MAIN",
      runAt: "document_idle",
      allFrames: false,
      matchOriginAsFallback: false,
      persistAcrossSessions: true,
    },
    {
      id: "enable-right-click:main",
      matches: ["<all_urls>"],
      excludeMatches: [],
      js: ["features/enable-right-click/main.js"],
      css: [],
      world: "MAIN",
      runAt: "document_start",
      allFrames: true,
      matchOriginAsFallback: true,
      persistAcrossSessions: true,
    },
  ]);
});

test("disabled features are left out", () => {
  const specs = desiredContentScripts([COMMENT_MODE, RIGHT_CLICK], { "comment-mode": { enabled: false, disabledHosts: [] } });
  assert.deepEqual(specs.map((s) => s.id), ["enable-right-click:main"]);
});

test("disabled hosts become sorted excludeMatches", () => {
  const [spec] = desiredContentScripts([RIGHT_CLICK], {
    "enable-right-click": { enabled: true, disabledHosts: ["github.com", "example.com"] },
  });
  assert.deepEqual(spec.excludeMatches, ["*://example.com/*", "*://github.com/*"]);
});

const userscripts: UserscriptsState = {
  "fix-fonts": {
    id: "fix-fonts",
    enabled: true,
    source: "code-a",
    meta: { name: "Fix Fonts", matches: ["https://a.com/*"], excludeMatches: ["https://a.com/x/*"], runAt: "document_start", world: "MAIN" },
    updatedAt: "",
    disabledHosts: ["b.com"],
  },
  "off-script": {
    id: "off-script",
    enabled: false,
    source: "code-b",
    meta: { name: "Off", matches: ["https://c.com/*"], excludeMatches: [], runAt: "document_idle", world: "USER_SCRIPT" },
    updatedAt: "",
    disabledHosts: [],
  },
};

test("enabled userscripts become prefixed registrations", () => {
  assert.deepEqual(desiredUserScripts(userscripts), [
    {
      id: "us:fix-fonts",
      matches: ["https://a.com/*"],
      excludeMatches: ["*://b.com/*", "https://a.com/x/*"],
      code: "code-a",
      world: "MAIN",
      runAt: "document_start",
      allFrames: false,
    },
  ]);
});

test("diff leaves unchanged entries alone, replaces changed ones and drops stale ones", () => {
  const a = { id: "a", v: 1 };
  const b = { id: "b", v: 1 };
  const bChanged = { id: "b", v: 2 };
  const c = { id: "c", v: 1 };
  const stale = { id: "stale", v: 1 };
  assert.deepEqual(diff([a, bChanged, c], [a, b, stale]), { unregister: ["b", "stale"], register: [bChanged, c] });
  assert.deepEqual(diff([a], [a]), { unregister: [], register: [] });
});

test("a registration read back from Chrome compares equal to the one we asked for", () => {
  const desired = desiredContentScripts([RIGHT_CLICK], {});
  const fromChrome = [
    {
      id: "enable-right-click:main",
      matches: ["<all_urls>"],
      js: ["features/enable-right-click/main.js"],
      world: "MAIN",
      runAt: "document_start",
      allFrames: true,
      matchOriginAsFallback: true,
      persistAcrossSessions: true,
    },
  ] as unknown as chrome.scripting.RegisteredContentScript[];
  assert.deepEqual(diff(desired, fromChrome.map(normalizeContentScript)), { unregister: [], register: [] });
});

test("a user script read back from Chrome compares equal to the one we asked for", () => {
  const desired = desiredUserScripts(userscripts);
  const fromChrome = [
    {
      id: "us:fix-fonts",
      matches: ["https://a.com/*"],
      excludeMatches: ["https://a.com/x/*", "*://b.com/*"],
      js: [{ code: "code-a" }],
      world: "MAIN",
      runAt: "document_start",
    },
  ] as unknown as chrome.userScripts.RegisteredUserScript[];
  assert.deepEqual(diff(desired, fromChrome.map(normalizeUserScript)), { unregister: [], register: [] });
});
