// Comment Mode content script: once the YouTube player has scrolled out of
// view, keeps it floating in a small draggable, resizable window so the video
// plays on while you read the comments.

import { createChannel } from "../../src/core/bridge.ts";
import { el } from "../../src/core/dom.ts";
import { useSettings } from "../../src/core/settings.ts";
import feature, { type Geometry } from "./feature.ts";
import type { PlayerCommand, PlayerState } from "./protocol.ts";

(() => {
  // --- Constants -----------------------------------------------------------

  const SIZES = {
    S: { width: 320, height: 180 },
    M: { width: 480, height: 270 },
    L: { width: 640, height: 360 },
    XL: { width: 854, height: 480 },
  };
  const MIN_WIDTH = 300; // the control bar needs this much
  const DEFAULT_TOP = 72;
  const DEFAULT_RIGHT_MARGIN = 24;
  const EDGE_MARGIN = 8;
  const TOP_MARGIN = 64; // stay clear of YouTube's masthead

  const SKIP_SECONDS = 5;
  const VOLUME_STEP = 5; // percent, per wheel notch
  const WHEEL_NOTCH_PX = 60;
  const DRAG_THRESHOLD_PX = 4;

  const PLAYER = "#movie_player";
  const VIDEO = ".video-stream";
  const PLAYER_HOST = "#ytd-player > #container.ytd-player";
  const AD_CLASS = "ad-showing";
  const ENDED_CLASS = "ended-mode";

  const CORNERS: Record<string, { left: boolean; top: boolean }> = {
    tl: { left: true, top: true },
    tr: { left: false, top: true },
    bl: { left: true, top: false },
    br: { left: false, top: false },
  };

  // Until YouTube's player reports the speeds it really offers.
  const DEFAULT_RATES = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

  // 24x24 icons. Stroked unless `solid`; `text` is drawn centred on `textY`.
  const SVG_NS = "http://www.w3.org/2000/svg";
  const ICONS: Record<string, { d: string; solid?: boolean; text?: string; textY?: number }> = {
    play: { d: "M8 5.5v13l10.5-6.5z", solid: true },
    pause: { d: "M7 5h3.5v14H7zM13.5 5H17v14h-3.5z", solid: true },
    back: { d: "M12 6a7 7 0 1 1-6.06 3.5M15 3l-3 3 3 3", text: String(SKIP_SECONDS), textY: 15.6 },
    forward: { d: "M12 6a7 7 0 1 0 6.06 3.5M9 3l3 3-3 3", text: String(SKIP_SECONDS), textY: 15.6 },
    captions: { d: "M5 6h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z", text: "CC", textY: 14.5 },
    size: { d: "M4 9V4h5M20 15v5h-5M4 4l6 6M20 20l-6-6" },
    top: { d: "M12 19V6M6 12l6-6 6 6" },
    close: { d: "M6 6l12 12M18 6L6 18" },
  };

  // --- State ---------------------------------------------------------------

  let dismissed = false; // closed by hand; stays docked until the next video
  let wrapper: HTMLDivElement | null = null; // #cmode-player, non-null while floating
  let placeholder: Comment | null = null; // marks where #movie_player came from
  let slot: Element | null = null; // the element the player was lifted out of (#ytd-player)
  let saved: Geometry | null = null; // { top, left, width, height } from storage
  let scrollScheduled = false;
  let gestureMoved = false; // a drag, resize or scrub is under way; its final click is not a click
  let playerObserver: MutationObserver | null = null; // watches the player's class list while floating
  let wheelDelta = 0; // accumulated wheel movement, so trackpads don't race
  let badgeTimer = 0;

  // --- Settings ------------------------------------------------------------

  // Sakti only injects this script while the feature is on, so there is no
  // switch to watch here. The window's geometry is the one thing we store.
  const settings = useSettings(feature);

  settings.get("geometry").then((geometry) => {
    saved = geometry;
    scheduleCheck();
  });

  // --- Scroll / navigation -------------------------------------------------

  window.addEventListener("scroll", scheduleCheck, { passive: true });
  window.addEventListener("yt-navigate-finish", () => {
    dismissed = false;
    if (wrapper && location.pathname !== "/watch") dock();
    else scheduleCheck();
  });

  function scheduleCheck() {
    if (scrollScheduled) return;
    scrollScheduled = true;
    requestAnimationFrame(() => {
      scrollScheduled = false;
      check();
    });
  }

  function check() {
    // Both thresholds are the bottom edge of the same box (the player, or the
    // slot it was lifted out of), so floating and docking can never both be
    // true at one scroll position.
    if (wrapper) {
      if (slot && slot.getBoundingClientRect().bottom > 0) dock();
      return;
    }

    if (dismissed || location.pathname !== "/watch") return;
    const player = document.querySelector<HTMLElement>(PLAYER);
    if (!player || player.classList.contains(ENDED_CLASS)) return;
    if (player.getBoundingClientRect().bottom < 0) float(player);
  }

  // --- Timestamp links -----------------------------------------------------

  // YouTube answers a click on a timestamp (in a comment or the description)
  // by seeking and scrolling back up to the player, which loses the reader's
  // place. While floating, seek the floating player instead and stay put.
  // Capture on window so this runs before any of YouTube's own handlers.
  window.addEventListener("click", onTimestampClick, true);

  function onTimestampClick(e: MouseEvent) {
    if (!wrapper || isAd()) return;
    if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
    const link = e.target instanceof Element && e.target.closest<HTMLAnchorElement>("a[href]");
    if (!link || wrapper!.contains(link)) return;
    const seconds = timestampOf(link);
    const video = wrapper!.querySelector<HTMLVideoElement>(VIDEO);
    if (seconds == null || !video) return;

    e.preventDefault();
    e.stopImmediatePropagation();
    video.currentTime = seconds;
    updateTime();
  }

  // Seconds for a link to a time in the video being watched, else null.
  function timestampOf(link: HTMLAnchorElement) {
    const url = new URL(link.href, location.href);
    if (url.origin !== location.origin || url.pathname !== "/watch") return null;
    if (url.searchParams.get("v") !== new URLSearchParams(location.search).get("v")) return null;
    // "83", "83s" or "1h2m3s"
    const match = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s?)?$/.exec(url.searchParams.get("t") || "");
    if (!match || !match[0]) return null;
    const [, h = 0, m = 0, sec = 0] = match;
    return Number(h) * 3600 + Number(m) * 60 + Number(sec);
  }

  // --- Float / dock --------------------------------------------------------

  function float(player: HTMLElement) {
    const video = player.querySelector<HTMLVideoElement>(VIDEO);
    if (!video) return;
    const wasPlaying = !video.paused;

    // Build everything before touching the player so a failure here cannot
    // leave the page without its video. No HTML-string sinks: YouTube
    // enforces Trusted Types, which blocks innerHTML/insertAdjacentHTML.
    wrapper = el("div", { id: "cmode-player" }, [buildControls()]);
    applyGeometry(initialGeometry());

    slot = player.closest("#ytd-player") || player.parentElement;
    placeholder = document.createComment("cmode-player-placeholder");
    player.replaceWith(placeholder);
    player.classList.add("cmode-video");
    wrapper!.prepend(player);
    document.body.appendChild(wrapper!);

    // Moving a <video> in the DOM pauses it.
    if (wasPlaying) video.play();

    bindControls(video);
    for (const [type, handler] of Object.entries(VIDEO_EVENTS)) {
      video.addEventListener(type, handler);
    }
    playerObserver = new MutationObserver(onPlayerClassChange);
    playerObserver.observe(player, { attributes: true, attributeFilter: ["class"] });
    onPlayerClassChange();
    updatePlayState(video);
    updateSpeed(video);
    updateTime();
    command({ type: "getState" });
  }

  function dock() {
    if (!wrapper) return;
    const player = wrapper.querySelector<HTMLElement>(PLAYER);
    const video = player && player.querySelector<HTMLVideoElement>(VIDEO);
    const wasPlaying = video && !video.paused;

    playerObserver!.disconnect();
    playerObserver = null;
    clearTimeout(badgeTimer);
    if (video) {
      for (const [type, handler] of Object.entries(VIDEO_EVENTS)) {
        video.removeEventListener(type, handler);
      }
    }

    if (player) {
      player.classList.remove("cmode-video");
      if (placeholder && placeholder.parentNode) {
        placeholder.replaceWith(player);
      } else {
        const host = document.querySelector(PLAYER_HOST);
        if (host) host.appendChild(player);
      }
    }
    wrapper!.remove();
    wrapper = null;
    placeholder = null;
    slot = null;

    if (wasPlaying) video!.play();
    // Let YouTube's own resize handler re-fit the video.
    setTimeout(() => window.dispatchEvent(new Event("resize")), 0);
  }

  // --- DOM -----------------------------------------------------------------

  function icon(name: string) {
    const { d, solid, text, textY } = ICONS[name];
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("class", `cmode-icon cmode-icon-${name}${solid ? " cmode-icon-solid" : ""}`);
    svg.setAttribute("aria-hidden", "true");
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", d);
    svg.append(path);
    if (text) {
      const label = document.createElementNS(SVG_NS, "text");
      label.setAttribute("x", "12");
      label.setAttribute("y", String(textY));
      label.textContent = text;
      svg.append(label);
    }
    return svg;
  }

  function button(
    action: string,
    title: string,
    children: (Node | string)[],
    attrs: Record<string, string | Record<string, string>> = {},
  ) {
    return el(
      "button",
      { class: "cmode-btn", type: "button", title, "aria-label": title, dataset: { action }, ...attrs },
      children
    );
  }

  function buildControls() {
    return el("div", { class: "cmode-ui" }, [
      ...Object.keys(CORNERS).map((corner) => el("div", { class: "cmode-resizer", dataset: { corner } })),
      button("close", "Close until the next video", [icon("close")], { class: "cmode-btn cmode-close" }),
      // Click zones over the picture: back 10s | play/pause | forward 10s.
      el("div", { class: "cmode-zones" }, [
        el("div", { class: "cmode-zone", dataset: { action: "back" }, title: `Back ${SKIP_SECONDS} seconds` }, [icon("back")]),
        el("div", { class: "cmode-zone", dataset: { action: "play" }, title: "Play or pause" }, [icon("play"), icon("pause")]),
        el("div", { class: "cmode-zone", dataset: { action: "forward" }, title: `Forward ${SKIP_SECONDS} seconds` }, [icon("forward")]),
      ]),
      el("div", { class: "cmode-badge" }),
      el(
        "div",
        { class: "cmode-menu", hidden: "", dataset: { menu: "size" } },
        Object.keys(SIZES).map((size) => button("resize", `Size ${size}`, [size], { dataset: { action: "resize", size } }))
      ),
      el("div", { class: "cmode-menu", hidden: "", dataset: { menu: "speed" } }, rateButtons(DEFAULT_RATES)),
      el("div", { class: "cmode-bar" }, [
        el("div", { class: "cmode-scrub", title: "Seek" }, [
          el("div", { class: "cmode-scrub-track" }, [
            el("div", { class: "cmode-scrub-fill" }),
            el("div", { class: "cmode-scrub-thumb" }),
          ]),
        ]),
        el("div", { class: "cmode-row" }, [
          el("div", { class: "cmode-time" }, [
            el("span", { class: "cmode-current", text: "0:00" }),
            el("span", { class: "cmode-duration" }),
          ]),
          el("div", { class: "cmode-spacer" }),
          button("captions", "Subtitles", [icon("captions")], { class: "cmode-btn cmode-captions", "aria-pressed": "false" }),
          button("menu", "Playback speed (click to choose, scroll to step)", ["1x"], {
            class: "cmode-btn cmode-speed",
            dataset: { action: "menu", menu: "speed" },
          }),
          button("menu", "Window size", [icon("size")], { dataset: { action: "menu", menu: "size" } }),
          button("top", "Back to the top of the page", [icon("top")]),
        ]),
      ]),
    ]);
  }

  function rateButtons(rates: number[]) {
    return rates.map((rate) =>
      button("rate", `${rate}x speed`, [`${rate}x`], { role: "menuitemradio", dataset: { action: "rate", rate: String(rate) } })
    );
  }

  // --- Geometry ------------------------------------------------------------

  function initialGeometry(): Geometry {
    if (
      saved &&
      saved.left + saved.width <= window.innerWidth &&
      saved.top + saved.height <= window.innerHeight
    ) {
      return saved;
    }
    return {
      top: DEFAULT_TOP,
      left: window.innerWidth - SIZES.S.width - DEFAULT_RIGHT_MARGIN,
      ...SIZES.S,
    };
  }

  function applyGeometry(g: Geometry) {
    wrapper!.style.top = `${g.top}px`;
    wrapper!.style.left = `${g.left}px`;
    wrapper!.style.width = `${g.width}px`;
    wrapper!.style.height = `${g.height}px`;
  }

  function currentGeometry(): Geometry {
    const r = wrapper!.getBoundingClientRect();
    return {
      top: Math.round(r.top),
      left: Math.round(r.left),
      width: Math.round(r.width),
      height: Math.round(r.height),
    };
  }

  // Called at the end of every move or resize, so the window always comes
  // back where it was left.
  function saveGeometry(geometry: Geometry = currentGeometry()) {
    saved = geometry;
    settings.set("geometry", geometry);
  }

  function resizeTo({ width, height }: { width: number; height: number }) {
    // Growing must not push the window off the viewport. The size is
    // animated, so save the target rather than measuring mid-transition.
    const current = currentGeometry();
    const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(value, max));
    const geometry = {
      top: clamp(current.top, TOP_MARGIN, window.innerHeight - height - EDGE_MARGIN),
      left: clamp(current.left, EDGE_MARGIN, window.innerWidth - width - EDGE_MARGIN),
      width,
      height,
    };
    applyGeometry(geometry);
    saveGeometry(geometry);
  }

  // --- Controls ------------------------------------------------------------

  function bindControls(video: HTMLVideoElement) {
    const menus = [...wrapper!.querySelectorAll<HTMLElement>(".cmode-menu")];
    const closeMenus = (except?: HTMLElement) => menus.forEach((menu) => menu !== except && (menu.hidden = true));

    const actions: Record<string, (btn?: HTMLElement) => void> = {
      play: () => togglePlay(video),
      // While paused the whole picture is one play button.
      back: () => (video.paused ? video.play() : skip(video, -SKIP_SECONDS)),
      forward: () => (video.paused ? video.play() : skip(video, SKIP_SECONDS)),
      captions: () => command({ type: "toggleCaptions" }),
      rate: (btn) => !isAd() && command({ type: "setRate", rate: Number(btn!.dataset.rate) }),
      menu: (btn) => {
        const menu = menus.find((m) => m.dataset.menu === btn!.dataset.menu);
        closeMenus(menu);
        menu!.hidden = !menu!.hidden;
      },
      resize: (btn) => resizeTo(SIZES[btn!.dataset.size as keyof typeof SIZES]),
      top: () => window.scrollTo({ top: 0, behavior: "smooth" }),
      close: () => {
        dismissed = true;
        dock();
      },
    };

    // A gesture ends with a click on whatever is under the pointer. Swallow
    // that click before it reaches its target.
    wrapper!.addEventListener(
      "click",
      (e) => {
        if (!gestureMoved) return;
        gestureMoved = false;
        e.stopPropagation();
        e.preventDefault();
      },
      true
    );
    wrapper!.addEventListener("click", (e) => {
      // Keep clicks away from YouTube's document-level handlers.
      e.stopPropagation();
      const btn = (e.target as Element).closest<HTMLElement>("[data-action]");
      if (!btn || btn.dataset.action !== "menu") closeMenus();
      if (btn) actions[btn.dataset.action!](btn);
    });
    wrapper!.addEventListener("dblclick", (e) => e.stopPropagation());
    wrapper!.addEventListener("mouseleave", () => closeMenus());

    wrapper!.addEventListener("mousedown", startDrag);
    wrapper!.addEventListener("wheel", onWheel, { passive: false });
    wrapper!.querySelector<HTMLElement>(".cmode-scrub")!.addEventListener("mousedown", (e) => startScrub(e, video));
    for (const handle of wrapper!.querySelectorAll<HTMLElement>(".cmode-resizer")) {
      handle.addEventListener("mousedown", startResize);
    }
  }

  const VIDEO_EVENTS: Record<string, (event: Event) => void> = {
    timeupdate: updateTime,
    durationchange: updateTime,
    play: (e) => updatePlayState(e.target as HTMLVideoElement),
    pause: (e) => updatePlayState(e.target as HTMLVideoElement),
    ratechange: (e) => updateSpeed(e.target as HTMLVideoElement),
    loadeddata: () => command({ type: "getState" }), // next video: speeds and captions may differ
  };

  function skip(video: HTMLVideoElement, seconds: number) {
    if (isAd()) return;
    seekTo(video, video.currentTime + seconds);
    showBadge(`${seconds > 0 ? "+" : ""}${seconds}s`);
  }

  function togglePlay(video: HTMLVideoElement) {
    if (video.paused) video.play();
    else video.pause();
  }

  function seekTo(video: HTMLVideoElement, seconds: number) {
    // Seeking is YouTube's call while an ad plays.
    if (isAd() || !Number.isFinite(video.duration) || !Number.isFinite(seconds)) return;
    video.currentTime = Math.min(video.duration, Math.max(0, seconds));
    updateTime();
  }

  function updatePlayState(video: HTMLVideoElement) {
    if (wrapper) wrapper.classList.toggle("cmode-paused", video.paused);
  }

  function updateSpeed(video: HTMLVideoElement) {
    if (!wrapper) return;
    wrapper.querySelector(".cmode-speed")!.textContent = `${video.playbackRate}x`;
    for (const btn of wrapper.querySelectorAll<HTMLElement>("[data-rate]")) {
      btn.setAttribute("aria-checked", String(Number(btn.dataset.rate) === video.playbackRate));
    }
  }

  // The speeds on offer come from YouTube's player; rebuild the menu if they
  // are not the ones it was built with.
  function updateRates(rates: number[]) {
    const menu = wrapper!.querySelector<HTMLElement>('[data-menu="speed"].cmode-menu')!;
    const current = [...menu.querySelectorAll<HTMLElement>("[data-rate]")].map((btn) => Number(btn.dataset.rate));
    if (rates.length === current.length && rates.every((rate, i) => rate === current[i])) return;
    menu.replaceChildren(...rateButtons(rates));
    updateSpeed(wrapper!.querySelector<HTMLVideoElement>(VIDEO)!);
  }

  // --- Ads / end of video --------------------------------------------------

  function isAd() {
    return !!wrapper && wrapper.classList.contains("cmode-ad");
  }

  // The floating window hides YouTube's own overlays, which would leave an ad
  // unskippable. While an ad shows, content.css lets YouTube's ad overlay
  // (with its real Skip button) through and hides the seek and speed controls.
  function onPlayerClassChange() {
    if (!wrapper) return;
    const player = wrapper.querySelector<HTMLElement>(PLAYER);
    if (!player) return;
    // Not the video's "ended" event: that also fires when an ad finishes.
    if (player.classList.contains(ENDED_CLASS)) dock();
    else wrapper!.classList.toggle("cmode-ad", player.classList.contains(AD_CLASS));
  }

  // --- Volume / speed ------------------------------------------------------

  // Volume, speed and subtitles go through YouTube's player API (see main.ts). Setting
  // them on the <video> directly leaves YouTube's own controls and remembered
  // settings out of sync.
  const bridge = createChannel<PlayerCommand, PlayerState>("comment-mode", "isolated");

  function command(detail: PlayerCommand): void {
    bridge.send(detail);
  }

  bridge.onMessage((state) => {
    if (!wrapper) return;
    if (Array.isArray(state.rates) && state.rates.length) updateRates(state.rates);
    wrapper.querySelector(".cmode-captions")!.setAttribute("aria-pressed", String(Boolean(state.captions)));

    if (typeof state.volume === "number") {
      showBadge(state.muted ? "Muted" : `Volume ${Math.round(state.volume)}%`);
    } else if (state.captionsToggled) {
      if (state.captions) showBadge("Subtitles on");
      else showBadge(state.hasCaptions ? "Subtitles off" : "No subtitles for this video");
    }
  });

  function onWheel(e: WheelEvent) {
    e.preventDefault(); // the page must not scroll under the window
    wheelDelta += e.deltaMode === WheelEvent.DOM_DELTA_PIXEL ? e.deltaY : e.deltaY * WHEEL_NOTCH_PX;
    const steps = Math.trunc(wheelDelta / WHEEL_NOTCH_PX);
    if (steps === 0) return;
    wheelDelta -= steps * WHEEL_NOTCH_PX;

    // Wheel up is negative deltaY.
    if ((e.target as Element).closest(".cmode-speed")) {
      if (!isAd()) command({ type: "rateStep", step: -steps });
    } else {
      command({ type: "volumeBy", delta: -steps * VOLUME_STEP });
    }
  }

  function showBadge(text: string) {
    const badge = wrapper!.querySelector(".cmode-badge")!;
    badge.textContent = text;
    badge.classList.add("cmode-badge-show");
    clearTimeout(badgeTimer);
    badgeTimer = setTimeout(() => badge.classList.remove("cmode-badge-show"), 900);
  }

  // --- Drag ----------------------------------------------------------------

  const NON_DRAG_TARGETS = "button, .cmode-resizer, .cmode-scrub, .cmode-menu";

  // Runs `onMove` for every mousemove until the button is released.
  function trackPointer(onMove: (ev: MouseEvent) => void, onUp: (ev: MouseEvent) => void) {
    const up = (ev: MouseEvent) => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", up);
      if (wrapper) onUp(ev); // may have docked mid-gesture
      // The click, if any, is dispatched right after this mouseup. Clear the
      // flag afterwards so a gesture released outside the window (no click)
      // cannot swallow the next real one.
      setTimeout(() => (gestureMoved = false), 0);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", up);
  }

  function startDrag(e: MouseEvent) {
    if (e.button !== 0 || (e.target as Element).closest(NON_DRAG_TARGETS)) return;
    e.preventDefault(); // no text selection while dragging
    gestureMoved = false;

    const rect = wrapper!.getBoundingClientRect();
    const offsetX = e.clientX - rect.left;
    const offsetY = e.clientY - rect.top;

    trackPointer(
      (ev) => {
        if (!wrapper) return;
        if (
          !gestureMoved &&
          Math.abs(ev.clientX - e.clientX) < DRAG_THRESHOLD_PX &&
          Math.abs(ev.clientY - e.clientY) < DRAG_THRESHOLD_PX
        ) {
          return; // a wobble during a click is not a drag
        }
        gestureMoved = true;
        wrapper!.classList.add("cmode-gesture");
        const maxLeft = window.innerWidth - rect.width - EDGE_MARGIN;
        const maxTop = window.innerHeight - rect.height - EDGE_MARGIN;
        wrapper!.style.left = `${Math.min(maxLeft, Math.max(EDGE_MARGIN, ev.clientX - offsetX))}px`;
        wrapper!.style.top = `${Math.min(maxTop, Math.max(TOP_MARGIN, ev.clientY - offsetY))}px`;
      },
      () => {
        if (!gestureMoved) return;
        wrapper!.classList.remove("cmode-gesture");
        saveGeometry();
      }
    );
  }

  // --- Resize --------------------------------------------------------------

  function startResize(e: MouseEvent) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();

    const corner = CORNERS[(e.currentTarget as HTMLElement).dataset.corner!];
    const start = wrapper!.getBoundingClientRect();
    const ratio = start.height / start.width;
    // The opposite corner stays put, so left/top corners can only grow as far
    // as the viewport margins allow.
    let maxWidth = Infinity;
    if (corner.left) maxWidth = start.right - EDGE_MARGIN;
    if (corner.top) maxWidth = Math.min(maxWidth, (start.bottom - TOP_MARGIN) / ratio);
    wrapper!.classList.add("cmode-gesture");

    trackPointer(
      (ev) => {
        if (!wrapper) return;
        gestureMoved = true;
        const dx = corner.left ? e.clientX - ev.clientX : ev.clientX - e.clientX;
        const width = Math.min(maxWidth, Math.max(MIN_WIDTH, start.width + dx));
        const height = Math.round(width * ratio);
        wrapper!.style.width = `${width}px`;
        wrapper!.style.height = `${height}px`;
        if (corner.left) wrapper!.style.left = `${start.right - width}px`;
        if (corner.top) wrapper!.style.top = `${start.bottom - height}px`;
      },
      () => {
        wrapper!.classList.remove("cmode-gesture");
        saveGeometry();
      }
    );
  }

  // --- Progress ------------------------------------------------------------

  function startScrub(e: MouseEvent, video: HTMLVideoElement) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const track = wrapper!.querySelector(".cmode-scrub-track")!;
    const seek = (ev: MouseEvent) => {
      if (!wrapper) return;
      gestureMoved = ev !== e;
      const rect = track.getBoundingClientRect();
      const fraction = Math.min(1, Math.max(0, (ev.clientX - rect.left) / rect.width));
      seekTo(video, fraction * video.duration);
    };
    wrapper!.classList.add("cmode-gesture");
    seek(e);
    trackPointer(seek, () => wrapper!.classList.remove("cmode-gesture"));
  }

  function updateTime() {
    if (!wrapper) return;
    const video = wrapper.querySelector<HTMLVideoElement>(VIDEO);
    if (!video || !Number.isFinite(video.duration) || video.duration === 0) return;

    const percent = (video.currentTime / video.duration) * 100;
    wrapper!.querySelector<HTMLElement>(".cmode-scrub-fill")!.style.width = `${percent}%`;
    wrapper!.querySelector<HTMLElement>(".cmode-scrub-thumb")!.style.left = `${percent}%`;
    wrapper!.querySelector(".cmode-current")!.textContent = formatTime(video.currentTime);
    wrapper!.querySelector(".cmode-duration")!.textContent = ` / ${formatTime(video.duration)}`;
  }

  function formatTime(totalSeconds: number) {
    const t = Math.floor(totalSeconds);
    const hours = Math.floor(t / 3600);
    const minutes = Math.floor((t % 3600) / 60);
    const seconds = t % 60;
    const pad = (n: number) => String(n).padStart(2, "0");
    return hours > 0
      ? `${hours}:${pad(minutes)}:${pad(seconds)}`
      : `${minutes}:${pad(seconds)}`;
  }
})();
