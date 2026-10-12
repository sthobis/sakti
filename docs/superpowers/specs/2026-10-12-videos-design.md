# Videos — design

Date: 2026-10-12
Status: approved design

## What it is

A third subsystem next to features and userscripts. It lists the videos the
current tab has loaded and saves one of them as an MP4, at a quality the site
already serves. It works on any site, because it looks at the tab's network
traffic rather than at page markup. Nothing is injected into pages.

In scope for v1:

- Plain video files (`video/*`), HLS (`.m3u8`) and DASH (`.mpd`).
- MP4 output only. Streams are repackaged, never re-encoded.
- A quality picker with the qualities the stream offers.

Out of scope for v1: live recording, re-encoding or other output formats,
audio-only downloads, thumbnails, YouTube, and sites that embed their manifest
in page JSON instead of fetching it. DRM is out of scope permanently: a
protected stream is listed as protected and cannot be downloaded.

## Changes to earlier decisions

- "The extension makes no network requests" becomes: Sakti fetches media only
  when the Videos tab is opened (to read manifests) or Download is clicked, and
  only from URLs the page itself loaded.
- "Nothing at runtime" gains one exception: `mediabunny`, a pure TypeScript
  media library with no dependencies, bundled into the offscreen document only.
- New permissions: `webRequest`, `declarativeNetRequestWithHostAccess`,
  `offscreen`, `downloads`, `unlimitedStorage`.

## Architecture

```
 tab network traffic
        |  webRequest (headers only)
        v
 worker/sniffer.ts --> storage.session  media:<tabId>
        |                                   |
        |                                   v storage.onChanged
 worker/media.ts  <---- messages ----  popup (Videos tab)
        |  ^
        |  | progress, result
        v  |
 offscreen document: fetch segments -> OPFS temp files
                     Mediabunny: demux -> mux -> OPFS .mp4
                     blob URL -> worker -> chrome.downloads
```

- **Worker.** `sniffer.ts` classifies responses and stores detections.
  `media.ts` owns the job queue, the offscreen document's lifetime, the header
  rules and the `chrome.downloads` handoff. An offscreen document can only use
  `chrome.runtime`, so the worker is the only writer of storage.
- **Offscreen document** (`src/offscreen/`). All media work: probing manifests,
  fetching segments, AES-128 decryption, muxing. Large data lives in the Origin
  Private File System, not in memory.
- **Pure modules** (`src/media/`), unit-tested: `classify`, `m3u8`, `xml`,
  `mpd`, `group`, `timestamps`, `filename`, `jobs`.
- **Popup.** Two tabs, Videos and Features.

## Detection

The worker listens to `webRequest.onHeadersReceived` for the request types
`media`, `xmlhttprequest` and `other`. It skips requests without a tab (these
include Sakti's own) and non-2xx responses.

| Kind | Rule |
|---|---|
| HLS | `Content-Type` is an mpegurl type, or the path ends in `.m3u8` |
| DASH | `Content-Type` is `application/dash+xml`, or the path ends in `.mpd` |
| File | `Content-Type` is `video/*`, and the request type is `media` or the response is a `206` whose `Content-Range` total is at least 1 MB |

The `206` rule keeps streaming segments out of the list: players that use Media
Source Extensions fetch segments as `200` responses.

Detections are stored per tab under `media:<tabId>` in `chrome.storage.session`:
URL, kind, size and the origin of the frame that loaded it (for the `Referer`
header). They are deduplicated by URL, capped at 50 per tab, cleared when the
tab loads a new document and removed when the tab closes.

## Probing

Opening the Videos tab probes every detection that has no probe result yet. The
result is stored on the detection, so each manifest is fetched once.

- HLS master playlist: qualities from `EXT-X-STREAM-INF`. The first variant is
  fetched to learn duration, live status and protection. Variant and rendition
  URLs are recorded as children, and a detection that is a child of another
  detection is hidden.
- HLS media playlist: a single quality. No `EXT-X-ENDLIST` means live.
- DASH: qualities from the video representations of the first period.
  `type="dynamic"` means live. More than one period is reported as unsupported.
- File: Mediabunny reads the file header with range requests. A file without a
  video track is hidden.
- Protected: `SAMPLE-AES`, a `KEYFORMAT` other than `identity`, or a
  `ContentProtection` element. `AES-128` with a plain key URL is not DRM and
  stays downloadable.

## Downloading

A download is a job. Jobs live in `chrome.storage.session` under `mediaJobs`.
One job runs at a time.

- **File.** `chrome.downloads.download` with the detected URL. If the server
  refuses it, the job is retried through the offscreen document, which can send
  the page's `Referer`.
- **HLS and DASH.**
  1. Plan: the chosen quality becomes an ordered list of requests per track
     (URL, optional byte range, optional AES-128 key). Audio delivered
     separately is a second track.
  2. Fetch: four requests at a time, three retries with backoff, written in
     order to one OPFS temp file per track. Concatenated segments are a valid
     `.ts` or fragmented MP4 file.
  3. Mux: Mediabunny reads the temp files and copies the encoded packets into
     one MP4, streamed to a second OPFS file. `timestamps.ts` starts the tracks
     at zero and repairs timestamps that run backwards between groups of
     frames.
  4. Handoff: the offscreen document creates a blob URL, the worker passes it
     to `chrome.downloads`, and the temp files are deleted when that download
     ends.

The file name is `<title> (<quality>).mp4`, sanitised, where the title is the
tab's title when Download is clicked.

While a probe or job runs, a `declarativeNetRequest` session rule sets
`Referer` and `Origin` to the page's on Sakti's own requests to the media
hosts. Fetches send cookies. The rule does not reach `chrome.downloads`, which
is why a refused file download is retried through the offscreen document.

## Popup

Tabs: **Videos (n)** and **Features**. The popup opens on Videos when the
current tab has visible detections or a job is active.

A row shows a kind tag, the title, duration and size, a quality select and a
Download button. Live and protected rows have no button. A failed probe shows
its reason and a retry link.

Below the list, a jobs strip shows every job with its stage, a progress bar
and Cancel, or "Show in folder" / the error when it has ended.

## Errors

Every failure ends as one readable line on the job or the probe. A request that
still fails after its retries fails the whole job: a gap in the video would be
worse than an error. If the offscreen document dies, the running job fails and
the next one starts.

## Testing

Unit tests cover the pure modules. Browser checks are done by hand, as for the
rest of the extension, against a local site that refuses requests without its
own `Referer`: an HLS stream, an AES-128 HLS stream, a DASH stream with
separate audio, a plain MP4, a live playlist and a DRM playlist.
