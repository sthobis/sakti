# Sakti — design

Date: 2026-09-24
Status: approved design, pre-implementation

## What it is

Sakti is a single personal Chrome extension that replaces a pile of small
third-party extensions. It ships built-in features (the YouTube floating
player from Comment Mode, the always-enable-right-click guard, and whatever
comes next) and a runtime userscript manager, so code that runs on visited
pages is either compiled from this repo or typed in by the user. It will not
be published to the Chrome Web Store. It may be open-sourced, so anyone who
installs it must be able to audit exactly what has access to their pages.

Non-goals for v1: `GM_*` APIs, `@require`, `@include`, a code editor with
syntax highlighting, side panel, context menus, keyboard shortcuts, cloud
sync, any network request made by the extension itself.

## Decisions already made

- Manifest V3, Chrome 120+.
- Unit of organisation is a **feature**, not a website. A feature declares
  where it runs.
- Tooling: esbuild + TypeScript + `@types/chrome` + `@types/node`. Nothing
  at runtime.
- Content scripts are **registered dynamically** from the service worker via
  `chrome.scripting.registerContentScripts`; the manifest declares no static
  `content_scripts`.
- Userscripts run through `chrome.userScripts`, editable at runtime, no
  rebuild.
- New repo `sakti`; Comment Mode and Enable Right Click are migrated in as
  the first two features.

## Repo layout

```
sakti/
  manifest.json            hand-written base; build merges feature needs into it
  package.json             esbuild, typescript, @types/chrome, @types/node
  tsconfig.json            browser code (src/, features/)
  tsconfig.node.json       build scripts and tests
  scripts/
    build.ts               scan features/, bundle, write dist/ and registry
    validate.ts            descriptor validation + registry entry (pure)
    manifest.ts            manifest merge (pure)
    zip.ts                 release zip writer
    make-icons.ts          draws icons/*.png
  src/
    registry.d.ts          type of the generated "sakti:registry" module
    core/
      feature.ts           Feature, RegistryEntry types + defineFeature()
      match.ts             match-pattern parser + URL test (pure)
      state.ts             stored state shapes + helpers (pure)
      backup.ts            export / import format (pure)
      storage.ts           chrome.storage access for worker and pages
      settings.ts          per-feature settings handle
      bridge.ts            isolated <-> MAIN world event channel
      dom.ts               el() element builder
      messages.ts          page -> worker messages
    worker/
      index.ts             service worker entry: wires listeners
      plan.ts              desired registrations + diff (pure)
      registrar.ts         applies the plan to Chrome
      badge.ts             toolbar badge
    ui/
      common/              toggle switch, download helper, shared CSS vars
      popup/               popup.html, popup.ts, popup.css
      options/             options.html, options.ts, options.css, route.ts, guard.ts
        features-view.ts
        userscripts-view.ts  editor
        backup-view.ts       export / import
    userscripts/
      header.ts            ==UserScript== header parser (pure)
      id.ts                slug / id derivation (pure)
      save.ts              save / rename / delete rules (pure)
  features/
    comment-mode/
      feature.ts
      content.ts
      main.ts              was bridge.js
      content.css
    enable-right-click/
      feature.ts
      main.ts              inject.js + popup-guard.js merged
  test/                    node --test suites for the pure modules
  icons/
  dist/                    build output, gitignored; "Load unpacked" points here
  releases/                zips from --zip, gitignored
```

Import rules:

- `features/*` may import from `src/core` only. Never from another feature,
  never from `src/worker` or `src/ui`.
- `src/*` never imports from `features/`. Worker and UI know features only
  through the generated registry.

## Feature contract

Each `features/<id>/feature.ts` default-exports one descriptor:

```ts
export default defineFeature({
  id: "comment-mode",                 // slug, unique, equals folder name
  name: "Comment Mode",
  description: "Keeps the YouTube player floating while you read comments.",
  matches: ["https://www.youtube.com/*"],
  excludeMatches: [],                 // optional
  runAt: "document_idle",             // document_start | document_end | document_idle
  allFrames: false,
  matchOriginAsFallback: false,       // also about:blank / data: frames
  scripts: {
    content: "./content.ts",          // optional, ISOLATED world
    main: "./main.ts",                // optional, MAIN world
    css: "./content.css",             // optional
  },
  settings: {                         // optional, keys this feature stores
    geometry: { type: "hidden", default: null, area: "sync" },
  },
  perSite: false,                     // popup offers per-host disable
  permissions: [],                    // extra manifest permissions, merged by build
});
```

`defineFeature` is an identity function typed as `<F extends Feature>(f: F) => F`
so descriptor mistakes fail at type-check, and the build validates again at
runtime (ids unique and slug-shaped, id equals folder name, every `scripts`
path exists, `matches` non-empty).

Setting types: `boolean`, `number`, `string`, `enum` (with `options`),
`hidden`. Every setting has `default` and `area` (`sync` | `local`, default
`local`). The options page renders non-hidden settings generically by type.

A feature never checks whether it is enabled. If its script is running, it
is enabled on that page. Content scripts get settings through
`useSettings(feature)`; MAIN-world scripts get them only via the bridge.

### Migrated features

- **comment-mode**: source is the `sthobis/comment-mode` repo (C:/Projects/comment-mode, v1.2.2). `content.js` → `content.ts` with `el()` moved to
  `core/dom.ts` (`icon()` and `trackPointer()` stay, they depend on Comment
  Mode's own state); `bridge.js` → `main.ts` using `core/bridge.ts`;
  `content.css` unchanged. The global "activated" flag is dropped; Sakti's
  per-feature `enabled` replaces it. `geometry` stays in `sync`.
- **enable-right-click**: `inject.js` and `popup-guard.js` become one
  `main.ts`, `runAt: "document_start"`, `allFrames: true`, `matches:
  ["<all_urls>"]`, `matchOriginAsFallback: true`, `perSite: true`. Its
  `disabledHosts` migrates into the
  Sakti settings model; the old `sw.js` badge logic is subsumed by
  `worker/icon.ts`.

## Settings model

`chrome.storage.local`:

```ts
features: {
  [featureId]: { enabled: boolean; disabledHosts: string[] }
}
userscripts: {
  [scriptId]: {
    id: string; enabled: boolean; source: string;
    meta: ParsedHeader; updatedAt: string; disabledHosts: string[];
  }
}
```

Feature-declared settings live under `feature:<id>` in the area each key
declared. `sync` is used only for small preferences (it caps at 100 KB total,
8 KB per key, ~120 writes/min). Enable state, host lists, and userscript
source always go to `local`.

New features (present in the registry, absent in `features`) default to
`enabled: true, disabledHosts: []`. Unknown ids in storage (from a newer
build's export) are preserved untouched.

## Registrar

`worker/registrar.ts` exposes `reconcile()`, run on `onInstalled`,
`onStartup`, and on every `storage.onChanged` for `features` or
`userscripts`. It is the **only** code that calls
`chrome.scripting.*ContentScripts` or `chrome.userScripts.*`. UI writes
storage; the registrar reacts.

Desired set:

- For each enabled feature: one registration per script world.
  `id: "<featureId>"` for the ISOLATED bundle (with `css` attached),
  `id: "<featureId>:main"` for the MAIN bundle. `matches`, `excludeMatches`
  (descriptor's plus `*://<host>/*` for every `disabledHosts` entry),
  `runAt`, `allFrames` from the descriptor. `persistAcrossSessions: true`.
- For each enabled userscript, if `chrome.userScripts` exists: one
  `chrome.userScripts.register` entry with `id: "us:<scriptId>"`,
  `matches`/`excludeMatches` from `meta` plus `disabledHosts`,
  `js: [{ code: source }]`, `runAt` from `meta`, `world` = `"MAIN"` when
  `@grant none`, otherwise `"USER_SCRIPT"`, `allFrames: false`.

Reconcile is a pure diff (`test/registrar.test.ts`): given desired and
current registrations, return `{ unregister: string[]; register: Script[] }`.
Changed entries appear in both lists, because `update*` keeps omitted
properties and cannot clear `excludeMatches`. The worker then applies the
lists, unregister first.

Registration changes affect pages loaded afterwards. The popup reloads the
current tab after a per-site toggle; global toggles reload nothing. Before
reloading, the popup sends `{ type: "sakti:reconcile" }` and waits for the
worker's reply, so the page never reloads ahead of the new registrations.

Chrome's rejection messages for userscripts are written to a separate
`userscriptErrors` key (`{ [scriptId]: message }`), rewritten on every pass.
The worker only reacts to changes of `features` and `userscripts`, so writing
errors cannot trigger another reconcile.

If `chrome.userScripts` is absent (user has not enabled "Allow User Scripts"
on Chrome 138+, or Developer Mode on 120–137), userscripts are skipped
silently by the registrar and the options page shows the instruction.

## Userscript manager

### Ids

`id = slug(@namespace) + "/" + slug(@name)`, or `slug(@name)` when no
namespace. Slug: lowercase, ASCII letters/digits, runs of anything else
collapse to `-`, trimmed. Deterministic, so the same script gets the same id
on every machine and exports are readable. Saving a new script whose id
already exists is refused ("a script with this name already exists").
Renaming an existing script changes its id: on save this is delete-old +
create-new, carrying over `enabled` and `disabledHosts`.

### Header

`src/userscripts/header.ts` parses `// ==UserScript== ... // ==/UserScript==`.
Supported: `@name` (required), `@namespace`, `@description`, `@version`,
`@match` (one or more, required), `@exclude`, `@run-at`
(`document-start|end|idle`, default idle), `@grant` (only `none` is
meaningful; an absent `@grant` is treated like `none`, matching Tampermonkey),
`@exclude-match` (same as `@exclude`). `@include` is rejected with a message; `@require` and other
keys are ignored and reported as "unsupported, ignored" in the editor.
Parsing happens at save time; the registrar reads `meta`, never source.

### Editor

Options page tab. Left: script list. Right: read-only strip of parsed
metadata (name, matches, world, run-at), then a plain `<textarea>`, then
Save / Enable / Delete. Save (`Ctrl+S` too) parses, derives id, attempts the
registration through storage, and surfaces Chrome's error text if it rejects
a pattern. Import: paste or open a `.user.js` file. Export: download source.

### Backup

Options page tab. Export writes one JSON file:

```json
{
  "sakti": 1,
  "exportedAt": "2026-09-24T00:00:00Z",
  "features": { ... },
  "settings": {
    "sync":  { "feature:comment-mode": { ... } },
    "local": { }
  },
  "userscripts": { ... }
}
```

Settings are split by storage area so an import writes each value back where
it came from. Import merges by id: entries in the file replace same-id
entries, local-only entries stay. Nothing is deleted by an import. Userscript
meta and ids are re-derived from each script's source on import, never taken
from the file. The confirmation shows the file's `exportedAt` so the user can
judge which side is newer before importing.

## UI

### Popup

Plain HTML + `popup.ts`, no framework. Shows the current tab's host, then:

- **On this site**: features and userscripts whose patterns match the tab
  URL (`core/match.ts`), each with a per-site toggle (writes
  `disabledHosts`, reloads tab) and a global toggle (writes `enabled`).
  Features with `perSite: false` show only the global toggle.
- **Everything else**: all remaining features and userscripts with their
  global toggle.

Each row has an "edit" link that deep-links into the options page. A gear
icon opens the options page.

### Options page

`options_ui: { page: "options.html", open_in_tab: true }` — always a full
browser tab. Hash routing: `#features/<id>`, `#userscripts/<id>`, `#backup`.

Tabs: **Features** (cards with description, global toggle, disabled-hosts
list with remove buttons, generically rendered settings), **Userscripts**
(editor above), **Backup**.

`src/ui/common/` holds the toggle switch, card styles, a small render helper,
and the CSS variables shared by both pages.

### Toolbar icon

One icon. Badge shows the count of features/userscripts disabled on the
current tab's host, or nothing. There is no global kill switch.

## Build

`scripts/build.ts`, run directly with `node` (Node ≥ 22.18 strips types
without a flag). This means build and test code uses only erasable
TypeScript syntax, `import type` for type-only imports, and explicit `.ts`
extensions on relative imports. Flags: `--watch`, `--release`, `--zip`.

1. Discover `features/*/feature.ts`, import, validate descriptors.
2. esbuild, `target: "chrome120"`, `format: "iife"` for every feature bundle,
   popup and options; the worker is also IIFE. Entries:
   `dist/features/<id>/{content,main}.js`, `dist/features/<id>/content.css`
   (copied), `dist/worker.js`, `dist/popup.js`, `dist/options.js`. Inline
   source maps unless `--release`.
3. Write `dist/registry.json` (descriptors with dist-relative paths). The
   worker imports it at build time via an esbuild JSON import, so it is
   baked into `worker.js`.
4. Write `dist/manifest.json` from the base `manifest.json` with
   `host_permissions` = union of all feature `matches`, `permissions` =
   base ∪ every feature's `permissions`, `version` from `package.json`.
   Base manifest carries: `scripting`, `storage`, `userScripts`, `tabs`,
   `action`, `options_ui`, `background.service_worker`, icons.
5. Copy `popup.html`, `options.html`, `icons/`, `LICENSE.md`.
6. `--zip` writes `releases/sakti-<version>.zip` with the zip writer ported
   from Comment Mode's `build.js`.

No file at the dist root may start with `_` (Chrome refuses to load it).

## Tests

`node --test` over pure modules only: `core/match.ts` (pattern grammar and
URL matching, including `<all_urls>`, `*.host`, path globs, rejections),
`userscripts/header.ts`, `userscripts/id.ts`, `worker/registrar.ts` diff.
No browser automation in the repo.

## Error handling

- Storage calls from content scripts wrap in try/catch: once the extension
  is reloaded the script is orphaned and `chrome.storage` throws.
- Registrar failures (bad pattern from a userscript) are caught per entry
  and written to `userscriptErrors[id]` so the editor can display them;
  other entries still register. Built-in feature failures are logged to the
  worker console.
- Missing `chrome.userScripts` is not an error; it is a documented state
  the options page explains.

## Open-source posture (README)

Built-in features are compiled from `features/` and reviewable. Userscripts
run only what the user pasted. The extension makes no network requests of
its own. `host_permissions` is exactly the union of feature `matches`, which
today means `<all_urls>` because of enable-right-click.
