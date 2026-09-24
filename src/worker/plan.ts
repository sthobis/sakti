// The pure half of the registrar: what should be registered, and what has to
// change to get there from what Chrome currently has.

import type { RegistryEntry, RunAt } from "../core/feature.ts";
import type { FeaturesState, UserscriptsState } from "../core/state.ts";
import { featureState } from "../core/state.ts";
import { hostPattern } from "../core/match.ts";

export interface ContentScriptSpec {
  id: string;
  matches: string[];
  excludeMatches: string[];
  js: string[];
  css: string[];
  world: "ISOLATED" | "MAIN";
  runAt: RunAt;
  allFrames: boolean;
  matchOriginAsFallback: boolean;
  persistAcrossSessions: boolean;
}

export interface UserScriptSpec {
  id: string;
  matches: string[];
  excludeMatches: string[];
  code: string;
  world: "MAIN" | "USER_SCRIPT";
  runAt: RunAt;
  allFrames: boolean;
}

export const USERSCRIPT_PREFIX = "us:";

const sortedSet = (list: readonly string[]): string[] => [...new Set(list)].sort();

// Fixed key order and sorted pattern lists, so JSON.stringify is a fair comparison.
function contentSpec(s: ContentScriptSpec): ContentScriptSpec {
  return {
    id: s.id,
    matches: sortedSet(s.matches),
    excludeMatches: sortedSet(s.excludeMatches),
    js: [...s.js],
    css: [...s.css],
    world: s.world,
    runAt: s.runAt,
    allFrames: s.allFrames,
    matchOriginAsFallback: s.matchOriginAsFallback,
    persistAcrossSessions: s.persistAcrossSessions,
  };
}

function userSpec(s: UserScriptSpec): UserScriptSpec {
  return {
    id: s.id,
    matches: sortedSet(s.matches),
    excludeMatches: sortedSet(s.excludeMatches),
    code: s.code,
    world: s.world,
    runAt: s.runAt,
    allFrames: s.allFrames,
  };
}

export function desiredContentScripts(registry: readonly RegistryEntry[], features: FeaturesState): ContentScriptSpec[] {
  const specs: ContentScriptSpec[] = [];
  for (const entry of registry) {
    const state = featureState(features, entry.id);
    if (!state.enabled) continue;
    const common = {
      matches: entry.matches,
      excludeMatches: [...entry.excludeMatches, ...state.disabledHosts.map(hostPattern)],
      runAt: entry.runAt,
      allFrames: entry.allFrames,
      matchOriginAsFallback: entry.matchOriginAsFallback,
      persistAcrossSessions: true,
    };
    if (entry.files.content || entry.files.css) {
      specs.push(
        contentSpec({
          id: entry.id,
          js: entry.files.content ? [entry.files.content] : [],
          css: entry.files.css ? [entry.files.css] : [],
          world: "ISOLATED",
          ...common,
        }),
      );
    }
    if (entry.files.main) {
      specs.push(contentSpec({ id: `${entry.id}:main`, js: [entry.files.main], css: [], world: "MAIN", ...common }));
    }
  }
  return specs;
}

export function desiredUserScripts(scripts: UserscriptsState): UserScriptSpec[] {
  return Object.values(scripts)
    .filter((script) => script.enabled)
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((script) =>
      userSpec({
        id: USERSCRIPT_PREFIX + script.id,
        matches: script.meta.matches,
        excludeMatches: [...script.meta.excludeMatches, ...script.disabledHosts.map(hostPattern)],
        code: script.source,
        world: script.meta.world,
        runAt: script.meta.runAt,
        allFrames: false,
      }),
    );
}

// Chrome leaves defaulted fields out of what it returns; fill them back in.
// String() keeps these comparisons valid whether @types/chrome models the
// world and runAt fields as string unions or as enums.
export function normalizeContentScript(raw: chrome.scripting.RegisteredContentScript): ContentScriptSpec {
  return contentSpec({
    id: raw.id,
    matches: raw.matches ?? [],
    excludeMatches: raw.excludeMatches ?? [],
    js: raw.js ?? [],
    css: raw.css ?? [],
    world: String(raw.world ?? "ISOLATED") === "MAIN" ? "MAIN" : "ISOLATED",
    runAt: String(raw.runAt ?? "document_idle") as RunAt,
    allFrames: raw.allFrames ?? false,
    matchOriginAsFallback: raw.matchOriginAsFallback ?? false,
    persistAcrossSessions: raw.persistAcrossSessions ?? true,
  });
}

export function normalizeUserScript(raw: chrome.userScripts.RegisteredUserScript): UserScriptSpec {
  const first = raw.js?.[0] as { code?: string } | undefined;
  return userSpec({
    id: raw.id,
    matches: raw.matches ?? [],
    excludeMatches: raw.excludeMatches ?? [],
    code: first?.code ?? "",
    world: String(raw.world ?? "USER_SCRIPT") === "MAIN" ? "MAIN" : "USER_SCRIPT",
    runAt: String(raw.runAt ?? "document_idle") as RunAt,
    allFrames: raw.allFrames ?? false,
  });
}

export function diff<T extends { id: string }>(desired: T[], current: T[]): { unregister: string[]; register: T[] } {
  const currentJson = new Map(current.map((spec) => [spec.id, JSON.stringify(spec)]));
  const desiredById = new Map(desired.map((spec) => [spec.id, spec]));
  const unregister: string[] = [];
  const register: T[] = [];
  for (const [id, json] of currentJson) {
    const wanted = desiredById.get(id);
    if (!wanted || JSON.stringify(wanted) !== json) unregister.push(id);
  }
  for (const spec of desired) {
    if (currentJson.get(spec.id) !== JSON.stringify(spec)) register.push(spec);
  }
  return { unregister, register };
}
