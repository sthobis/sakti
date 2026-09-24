// Comment Mode page script: runs in the page's own JS world because YouTube's
// player API lives on #movie_player there and is invisible to the isolated
// content script. content.ts sends commands over the Sakti bridge and gets
// the result back the same way.
//
// Commands:  { type: "getState" }
//            { type: "volumeBy", delta }      percent, may be negative
//            { type: "rateStep", step }       move along the available speeds
//            { type: "setRate", rate }
//            { type: "toggleCaptions" }
// Every reply carries { rate, rates, captions }; a volume change adds
// { volume, muted } and a captions toggle adds { captionsToggled, hasCaptions }.

import { createChannel } from "../../src/core/bridge.ts";
import type { PlayerCommand, PlayerState } from "./protocol.ts";

interface YouTubePlayer extends HTMLElement {
  getVolume(): number;
  setVolume(volume: number): void;
  isMuted(): boolean;
  unMute(): void;
  getAvailablePlaybackRates(): number[];
  getPlaybackRate(): number;
  setPlaybackRate(rate: number): void;
  toggleSubtitles?(): void;
  isSubtitlesOn?(): boolean;
  getOption?(category: string, option: string): unknown[];
}

const CAPTIONS_SETTLE_MS = 250; // isSubtitlesOn() lags the toggle a little

const bridge = createChannel<PlayerState, PlayerCommand>("comment-mode", "main");

bridge.onMessage((cmd) => {
  const player = document.querySelector<YouTubePlayer>("#movie_player");
  if (!player || typeof player.getVolume !== "function") return;

  if (cmd.type === "getState") {
    reply(player);
  } else if (cmd.type === "volumeBy" && Number.isFinite(cmd.delta)) {
    // Like YouTube's arrow keys: turning up while muted just unmutes.
    let muted = player.isMuted();
    let volume = player.getVolume();
    if (muted && cmd.delta > 0) {
      player.unMute();
      muted = false;
    } else {
      volume = Math.max(0, Math.min(100, volume + cmd.delta));
      player.setVolume(volume);
    }
    reply(player, { volume, muted: muted || volume === 0 });
  } else if (cmd.type === "rateStep" && Number.isFinite(cmd.step)) {
    const rates = player.getAvailablePlaybackRates();
    const index = rates.indexOf(player.getPlaybackRate()) + cmd.step;
    player.setPlaybackRate(rates[Math.max(0, Math.min(rates.length - 1, index))]);
    reply(player);
  } else if (cmd.type === "setRate" && player.getAvailablePlaybackRates().includes(cmd.rate)) {
    player.setPlaybackRate(cmd.rate);
    reply(player);
  } else if (cmd.type === "toggleCaptions" && typeof player.toggleSubtitles === "function") {
    player.toggleSubtitles();
    setTimeout(() => {
      const tracks = (player.getOption && player.getOption("captions", "tracklist")) || [];
      reply(player, { captionsToggled: true, hasCaptions: captionsOn(player) || tracks.length > 0 });
    }, CAPTIONS_SETTLE_MS);
  }
});

function captionsOn(player: YouTubePlayer): boolean {
  return typeof player.isSubtitlesOn === "function" && Boolean(player.isSubtitlesOn());
}

function reply(player: YouTubePlayer, extra: Partial<PlayerState> = {}): void {
  const state: PlayerState = {
    rate: player.getPlaybackRate(),
    rates: player.getAvailablePlaybackRates(),
    captions: captionsOn(player),
    ...extra,
  };
  bridge.send(state);
}
