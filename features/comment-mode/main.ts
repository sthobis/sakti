// Comment Mode page script. Runs in the page's own JS world because YouTube's
// player API lives on #movie_player there and is invisible to the isolated
// content script. content.ts sends commands over the Sakti bridge and gets the
// resulting volume back.

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
}

const MIN_WRAP_RATE = 0.5; // clicking past the fastest speed wraps to here
const bridge = createChannel<PlayerState, PlayerCommand>("comment-mode", "main");

bridge.onMessage((cmd) => {
  const player = document.querySelector<YouTubePlayer>("#movie_player");
  if (!player || typeof player.getVolume !== "function") return;

  if (cmd.type === "volumeBy" && Number.isFinite(cmd.delta)) {
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
    bridge.send({ volume, muted: muted || volume === 0 });
  } else if (cmd.type === "rateStep" && Number.isFinite(cmd.step)) {
    const rates = player.getAvailablePlaybackRates();
    const last = rates.length - 1;
    let index = rates.indexOf(player.getPlaybackRate()) + cmd.step;
    if (index > last && cmd.wrap) index = rates.findIndex((rate) => rate >= MIN_WRAP_RATE);
    player.setPlaybackRate(rates[Math.max(0, Math.min(last, index))]);
  }
});
