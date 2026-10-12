# Sakti

A personal Chrome extension that replaces a pile of small third-party
extensions. It bundles page features written in this repo, a userscript
manager and a video downloader. Everything that runs on the pages you visit is
either code you can read here, or code you typed in yourself.

It is not published to the Chrome Web Store. Load it unpacked.

## Features

| Feature | Runs on | What it does |
|---|---|---|
| YouTube Float | youtube.com | Keeps the video playing in a floating window while you read the comments. Timestamps seek without scrolling back up. |
| Enable Right Click | every site | Restores the native context menu and blocks scripted popup and new-tab ads. Can be switched off per site. |
| Google Region | google.com, incognito only | Sets the results region to the United States, which incognito windows otherwise forget every session. Needs "Allow in Incognito" switched on for Sakti. |
| Userscripts | where each script says | Paste a script or open a `.user.js` file in the options page. |
| Videos | every site | Lists the videos the current tab has loaded and saves one as an MP4. See [Videos](#videos). |

The toolbar popup has two tabs. **Videos** lists what the page has loaded.
**Features** lists what applies to the current page, with a switch for this
site and a switch for everywhere. The options page opens in a full tab.

Switching something off or on applies to pages loaded afterwards. A per-site
switch reloads the current tab for you. The everywhere switch does not reload
open tabs, so a tab that was already open keeps its current behaviour until
you reload it.

## Install

```bash
npm install
npm run build
```

1. Open `chrome://extensions` and turn on **Developer mode**.
2. Click **Load unpacked** and pick the `dist/` folder.
3. For userscripts on Chrome 138 or later, open Sakti's **Details** and turn on
   **Allow User Scripts**. On Chrome 120 to 137, Developer mode is enough.

While working on it, `npm run watch` rebuilds on every save. Click the reload
icon on Sakti's card in `chrome://extensions` to pick up the new build.

## What has access to your pages

- Built-in features are compiled from `features/`. Read them there.
- Userscripts run only what you pasted, through Chrome's `userScripts` API,
  which is the one sanctioned way for an extension to run code that is not in
  its package.
- Host permissions are exactly the union of the features' match patterns. Today
  that is `<all_urls>`, because Enable Right Click runs everywhere. Userscripts
  can only run where those permissions allow.
- Videos injects nothing into pages. It reads the status and headers of the
  responses a tab receives, never their bodies, and keeps what it finds in
  memory until the tab navigates or the browser closes.
- The extension makes network requests in one case only: when you open the
  Videos tab or click Download, it fetches the playlists and video data the
  page itself loaded. Nothing is sent anywhere else.

## Videos

Play a video, then open the popup. Each video the page has loaded gets a row
with the qualities the site offers and a Download button. The download keeps
running after the popup closes; the Downloads list in the same tab shows its
progress.

What it handles:

- Plain video files.
- HLS (`.m3u8`) and DASH (`.mpd`) streams, saved as one MP4. The stream is
  repackaged, never re-encoded, so the result has the quality you picked and
  takes about as long as downloading it.
- HLS streams encrypted with a plain `AES-128` key.

What it does not:

- DRM-protected streams (Netflix, Disney+, Spotify and the like). They are
  listed as protected and cannot be downloaded.
- Live streams. They are listed as live; recording is not supported yet.
- YouTube, whose player does not load anything this can recognise.
- Other output formats, audio-only downloads, or shrinking a video.

A stream needs about twice its size in free disk space while it is being
joined. The media work is done by [Mediabunny](https://mediabunny.dev), the one
runtime dependency, bundled into `dist/offscreen.js`.

## Adding a feature

Create `features/<id>/feature.ts`, where `<id>` is a lowercase slug:

```ts
import { defineFeature } from "../../src/core/feature.ts";

export default defineFeature({
  id: "my-feature",
  name: "My Feature",
  description: "One sentence for the popup and options page.",
  matches: ["https://example.com/*"],
  runAt: "document_idle",
  scripts: { content: "./content.ts" },
});
```

- `content` runs in the isolated world and can use `useSettings()` from `src/core/settings.ts`.
- `main` runs in the page's own world and cannot call `chrome.*`. Talk to it with `createChannel()` from `src/core/bridge.ts`.
- `css` is injected alongside the content script.
- `perSite: true` adds a per-site switch in the popup.
- Features import from `src/core/` only, never from each other.

Run `npm run build`. The build validates the descriptor and fails with a clear
message if something is wrong.

## Userscripts

Supported header keys:

| Key | Meaning |
|---|---|
| `@name` | Required. With `@namespace`, it decides the script's id. |
| `@namespace`, `@description`, `@version` | Informational. |
| `@match` | Required, one or more. Chrome match patterns. |
| `@exclude`, `@exclude-match` | Match patterns to skip. |
| `@run-at` | `document-start`, `document-end` or `document-idle` (default). |
| `@grant` | `none` or absent runs in the page's world. Anything else runs isolated, without `GM_*` APIs. |

`@include` is refused because Chrome does not accept its glob format.
`@require`, `@resource` and `GM_*` APIs are not supported yet.

## Backup

The options page's Backup tab exports one JSON file with every switch, setting
and userscript. Importing merges by id: entries in the file replace the same
entries here, and nothing else is removed.

## Development

```bash
npm test          # unit tests for the pure modules
npm run typecheck # tsc over extension code and over scripts and tests
npm run build     # dist/
npm run watch     # rebuild on change
npm run release   # dist/ without source maps, plus releases/sakti-<version>.zip
npm run icons     # redraw icons/
```
