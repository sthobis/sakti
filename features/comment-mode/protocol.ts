// Messages between content.ts (isolated world) and main.ts (page world).

export type PlayerCommand = { type: "volumeBy"; delta: number } | { type: "rateStep"; step: number; wrap?: boolean };

export interface PlayerState {
  volume: number;
  muted: boolean;
}
