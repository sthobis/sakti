// The contract every built-in feature fulfils. A feature folder default-exports
// defineFeature({...}); the build validates it and turns it into a
// RegistryEntry that the worker and UI read.

export type RunAt = "document_start" | "document_end" | "document_idle";
export type StorageAreaName = "sync" | "local";

export interface SettingDef<T = unknown> {
  type: "boolean" | "number" | "string" | "enum" | "hidden";
  default: T;
  /** Where the value lives. Defaults to "local". Use "sync" only for small values. */
  area?: StorageAreaName;
  /** Shown in the options page. Defaults to the setting's key. */
  label?: string;
  /** Required for type "enum". */
  options?: readonly string[];
}

export interface Feature {
  /** Lowercase slug, equal to the folder name. */
  id: string;
  name: string;
  description: string;
  /** Chrome match patterns. */
  matches: string[];
  excludeMatches?: string[];
  /** Defaults to "document_idle". */
  runAt?: RunAt;
  /** Defaults to false. */
  allFrames?: boolean;
  /** Also inject into about:blank, data: and similar frames. Defaults to false. */
  matchOriginAsFallback?: boolean;
  /** Paths relative to the feature folder. At least one is required. */
  scripts: { content?: string; main?: string; css?: string };
  settings?: Record<string, SettingDef>;
  /** Offer a per-site switch in the popup. Defaults to false. */
  perSite?: boolean;
  /** Extra manifest permissions this feature needs. */
  permissions?: string[];
}

/** A Feature with defaults filled in and script paths pointing into dist/. */
export interface RegistryEntry {
  id: string;
  name: string;
  description: string;
  matches: string[];
  excludeMatches: string[];
  runAt: RunAt;
  allFrames: boolean;
  matchOriginAsFallback: boolean;
  perSite: boolean;
  settings: Record<string, SettingDef>;
  files: { content?: string; main?: string; css?: string };
}

export function defineFeature<F extends Feature>(feature: F): F {
  return feature;
}
