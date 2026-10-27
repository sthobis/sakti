// What the toolbar badge says for one tab. The badge itself counts the videos
// the popup would list; the tooltip adds what Sakti runs on the site and what
// is switched off there. Pure.

import type { RegistryEntry } from "../core/feature.ts";
import { hostOf, urlMatches } from "../core/match.ts";
import { featureState, type FeaturesState, type UserscriptsState } from "../core/state.ts";
import { visibleDetections } from "../media/group.ts";
import type { Detection } from "../media/types.ts";

export interface BadgeInput {
  registry: readonly RegistryEntry[];
  features: FeaturesState;
  userscripts: UserscriptsState;
  /** False until "Allow User Scripts" is on, when no userscript runs. */
  userScripts: boolean;
  detections: readonly Detection[];
  url: string | undefined;
}

export interface BadgeLabel {
  text: string;
  title: string;
}

const plural = (count: number, word: string): string => `${count} ${word}${count === 1 ? "" : "s"}`;

export function badgeLabel(input: BadgeInput): BadgeLabel {
  const videos = visibleDetections(input.detections).length;
  const lines = ["Sakti"];
  if (videos) lines.push(plural(videos, "video"));

  const host = hostOf(input.url);
  if (host) {
    const url = input.url!;
    const items = [
      ...input.registry.map((entry) => {
        const state = featureState(input.features, entry.id);
        return { on: state.enabled, matches: urlMatches(entry.matches, entry.excludeMatches, url), off: state.disabledHosts.includes(host) };
      }),
      ...Object.values(input.userscripts).map((script) => ({
        on: script.enabled && input.userScripts,
        matches: urlMatches(script.meta.matches, script.meta.excludeMatches, url),
        off: script.disabledHosts.includes(host),
      })),
    ];
    const running = items.filter((item) => item.on && item.matches && !item.off).length;
    const off = items.filter((item) => item.off).length;
    if (running) lines.push(`${running} running on ${host}`);
    if (off) lines.push(`${off} off on ${host}`);
  }

  return { text: videos ? String(videos) : "", title: lines.join("\n") };
}
