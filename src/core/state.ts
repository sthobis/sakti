// Shapes of what Sakti keeps in chrome.storage.local, plus tiny pure helpers.
//   features:         { [featureId]: FeatureState }
//   userscripts:      { [scriptId]: UserscriptRecord }
//   userscriptErrors: { [scriptId]: message Chrome gave when registering it }
// Feature settings live under `feature:<id>` in the area each setting declares.

import type { UserscriptMeta } from "../userscripts/header.ts";

export const SETTINGS_PREFIX = "feature:";

export interface FeatureState {
  enabled: boolean;
  disabledHosts: string[];
}
export type FeaturesState = Record<string, FeatureState>;

export interface UserscriptRecord {
  id: string;
  enabled: boolean;
  source: string;
  meta: UserscriptMeta;
  updatedAt: string;
  disabledHosts: string[];
}
export type UserscriptsState = Record<string, UserscriptRecord>;
export type UserscriptErrors = Record<string, string>;

/** A feature nobody has touched yet is enabled everywhere. */
export function featureState(features: FeaturesState, id: string): FeatureState {
  return features[id] ?? { enabled: true, disabledHosts: [] };
}

export function toggleHost(hosts: readonly string[], host: string, disabled: boolean): string[] {
  const rest = hosts.filter((h) => h !== host);
  return disabled ? [...rest, host] : rest;
}
