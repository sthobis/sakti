// Turns what a manifest says about a rendition into the label shown in the
// quality picker. Pure.

import type { Quality } from "./types.ts";

export interface Rendering {
  id: string;
  height: number | null;
  frameRate: number | null;
  bandwidth: number | null;
}

/** "1080p60", "720p", or the bitrate when the manifest gives no resolution. */
export function qualityLabel(rendering: Rendering): string {
  if (rendering.height) {
    const fps = rendering.frameRate && rendering.frameRate > 40 ? String(Math.round(rendering.frameRate)) : "";
    return `${rendering.height}p${fps}`;
  }
  if (rendering.bandwidth) return `${Math.round(rendering.bandwidth / 1000)} kbps`;
  return "source";
}

/** Highest resolution first, then highest bitrate. Two renditions that would share a label get their bitrate appended. */
export function toQualities(renderings: readonly Rendering[]): Quality[] {
  const sorted = [...renderings].sort((a, b) => (b.height ?? 0) - (a.height ?? 0) || (b.bandwidth ?? 0) - (a.bandwidth ?? 0));
  const count = new Map<string, number>();
  for (const rendering of sorted) count.set(qualityLabel(rendering), (count.get(qualityLabel(rendering)) ?? 0) + 1);
  return sorted.map((rendering) => {
    const label = qualityLabel(rendering);
    const ambiguous = (count.get(label) ?? 0) > 1 && rendering.height && rendering.bandwidth;
    return { id: rendering.id, label: ambiguous ? `${label} · ${Math.round(rendering.bandwidth! / 1000)} kbps` : label };
  });
}
