// Messages between content.ts (isolated world) and main.ts (page world).

export type PlayerCommand =
  | { type: "getState" }
  | { type: "volumeBy"; delta: number }
  | { type: "rateStep"; step: number }
  | { type: "setRate"; rate: number }
  | { type: "toggleCaptions" };

/** Every reply carries rate, rates and captions; a volume change adds volume and muted, a captions toggle adds captionsToggled and hasCaptions. */
export interface PlayerState {
  rate: number;
  rates: number[];
  captions: boolean;
  volume?: number;
  muted?: boolean;
  captionsToggled?: boolean;
  hasCaptions?: boolean;
}
