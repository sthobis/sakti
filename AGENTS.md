# AGENTS.md

This file provides guidance to coding agents (Claude Code and others) when working with code in this repository.

Sakti is a personal Manifest V3 Chrome extension: built-in page features compiled from `features/`, a userscript manager backed by `chrome.userScripts`, and a video downloader (Videos). It is loaded unpacked from `dist/` and never published to the Chrome Web Store.

## Commands

```bash
npm run build                    # bundle into dist/ (inline source maps)
npm run watch                    # rebuild on changes under src/, features/, icons/
npm run release                  # dist/ without source maps + releases/sakti-<version>.zip
npm test                         # node --test over test/*.test.ts
node --test test/match.test.ts   # one test file
npm run typecheck                # tsc over tsconfig.json (browser code) and tsconfig.node.json (scripts + tests)
npm run icons                    # redraw icons/*.png
```

After a build, reload Sakti's card in `chrome://extensions` to pick up the new `dist/`.

## How Node runs TypeScript

There is no ts-node or tsx. Node (>= 22.18) runs `scripts/*.ts` and `test/*.ts` directly by stripping types, and esbuild bundles everything else. So all code must:

- use only erasable syntax (no `enum`, `namespace`, or constructor parameter properties; `tsconfig` sets `erasableSyntaxOnly`);
- use `import type` for type-only imports (`verbatimModuleSyntax`), or Node fails at runtime with a missing-export error;
- write the `.ts` extension on every relative import.

The installed TypeScript is 7.x. `src/css.d.ts` exists because it checks side-effect imports such as `import "./popup.css"`.

## Architecture

**Features are folders, not sites.** Each `features/<id>/feature.ts` default-exports `defineFeature({...})`: match patterns, `runAt`, `allFrames`, and `scripts: { content?, main?, css? }`. `scripts/build.ts` discovers the folders, validates each descriptor (`scripts/validate.ts`: the id must equal the folder name and the files must exist), bundles every script as its own IIFE, and turns the descriptors into `RegistryEntry` objects. Features import only from `src/core/`, never from each other. Nothing in `src/` imports from `features/`.

**The registry is a virtual module.** The worker, popup and options page `import registry from "sakti:registry"`. An esbuild plugin in `scripts/build.ts` resolves that import to the generated registry JSON, and `src/registry.d.ts` types it. The manifest's `host_permissions` is computed as the union of all feature `matches` (`scripts/manifest.ts`). The base `manifest.json` carries everything else.

**Single-writer registrar.** Only `src/worker/registrar.ts` calls `chrome.scripting.*ContentScripts` or `chrome.userScripts.*`. The manifest has no static `content_scripts`. The UI writes `chrome.storage` and calls `requestReconcile()` (`src/core/messages.ts`), which resolves only after the worker has applied the change. The popup waits for that before reloading a tab. The worker also reconciles on install, on startup, and on any change to the `features` or `userscripts` storage keys.

- The logic lives in `src/worker/plan.ts`, which is pure and tested. It computes the desired registrations and diffs them against what Chrome reports back.
- A feature registers as `<id>` for the isolated-world bundle plus its CSS, and as `<id>:main` for the MAIN-world bundle. A userscript registers as `us:<scriptId>`.
- A changed registration is **unregistered and re-registered, never updated**. Chrome's update calls keep omitted properties, so an update cannot clear `excludeMatches`, and switching a site back on would silently fail. An update-in-place change was tried and reverted for this reason.
- Per-site switches become `excludeMatches` entries of the form `*://<host>/*`.

**Storage** (`src/core/state.ts`, `src/core/storage.ts`):

- `chrome.storage.local` holds `features`, `userscripts`, `userscriptErrors` and `backupLog`.
- Each feature's own settings live under `feature:<id>`, in the area declared in its descriptor (`sync` only for small values).
- `userscriptErrors` is a separate key on purpose. The worker writes it on every pass, and because it only listens to `features` and `userscripts`, those writes cannot trigger another reconcile.
- Read-modify-write updates go through `src/core/queue.ts`, which serializes them within one page.

**Two script worlds.** A `content` script runs in the isolated world and can use `useSettings()` from `src/core/settings.ts`. A `main` script runs in the page's own JS world, which is required for page globals such as YouTube's `#movie_player` API, and cannot touch `chrome.*`. The two talk through `createChannel()` in `src/core/bridge.ts`, which sends DOM `CustomEvent`s with JSON-string payloads. Page scripts can forge these events, so receivers must validate what they get.

**Userscripts** (`src/userscripts/`):

- The id is derived from the header: `slug(@namespace)/slug(@name)`. Renaming a script moves it to a new id, and a duplicate name is refused.
- `@grant none`, or no `@grant` at all, runs the script in the MAIN world. Any other grant runs it in `USER_SCRIPT`.
- `@include` is rejected. `GM_*`, `@require` and `@resource` are not supported.
- `chrome.userScripts` works only after the user turns on "Allow User Scripts" for Sakti in Chrome. Until then the registrar skips userscripts and the options page shows how to turn it on.

**Videos** is a third subsystem, not a feature: it injects nothing into pages. It lists the media a tab has loaded and saves it as MP4.

- `src/media/` is pure and tested: `classify` (response headers to media kind), `m3u8` and `mpd` (playlist parsers, `mpd` on the small `xml` reader because Node has no `DOMParser`), `group`, `quality`, `timestamps`, `filename`, `format`, `jobs` (the queue as plain data). `messages.ts` lists every message.
- `src/worker/sniffer.ts` listens to `webRequest.onHeadersReceived` and stores detections per tab. `src/worker/media.ts` owns the job queue, the offscreen document's lifetime, the header rules and every `chrome.downloads` call.
- `src/offscreen/` is the offscreen document, the only place `mediabunny` is bundled. It probes manifests, fetches segments into Origin Private File System files, and muxes them (`mux.ts` copies encoded packets, nothing is re-encoded). An offscreen document can only use `chrome.runtime`, so it reports to the worker by message and the worker does all storage writes.
- State is in `chrome.storage.session`: `media:<tabId>` (detections, with their probe results) and `mediaJobs`. The popup renders from those keys and their change events; it holds no state of its own.
- Message types say who acts: the worker handles `sakti:media-*`, the offscreen document handles `offscreen:*`. `chrome.runtime.sendMessage` reaches every extension page, so each listener must ignore the other's types.
- Sakti's own fetches get the page's `Referer` and `Origin` from a `declarativeNetRequest` session rule scoped to `initiatorDomains: [chrome.runtime.id]`. Rule 1 is for probes, rule 2 for the running job. `chrome.downloads` requests are not affected by it, which is why a refused plain-file download is retried through the offscreen document.
- A download can end before its id is stored on the job. `settleDownload()` therefore runs both on `downloads.onChanged` and right after the id is stored. Do not replace it with the event alone.
- DRM streams (`SAMPLE-AES`, a vendor `KEYFORMAT`, DASH `ContentProtection`) are detected and refused in both the probe and the planner. That is deliberate and not to be worked around.

**Behaviour to know before "fixing" it:**

- Switches apply to pages loaded afterwards. The global switch does not touch tabs that are already open.
- Backup import merges by id and never deletes. It re-derives userscript ids and metadata from each script's source.
- Videos has no on/off switch and is not part of backup. Detections are cleared when the tab loads a new document, not on navigation inside a single-page app.

## Testing

Unit tests cover only the pure modules: `match`, `header`, `id`, `save`, `state`, `backup`, `plan`, `bridge`, `route`, `queue`, everything in `src/media/`, and the build helpers. Nothing mocks `chrome.*`. Browser checks are not committed. They are done by loading `dist/` into Playwright's Chromium with `--load-extension`. Headless Chromium cannot turn on `chrome.userScripts`, so userscript registration has to be checked by hand in a real Chrome.

## Design docs

The spec and the task-by-task implementation plan are in `docs/superpowers/specs/2026-09-24-sakti-design.md` and `docs/superpowers/plans/2026-09-24-sakti.md`. Read the spec's Registrar and Settings sections before changing how registration or storage works. Videos has its own spec, `docs/superpowers/specs/2026-10-12-videos-design.md`, which also records the two earlier decisions it changes (network requests and runtime dependencies).
