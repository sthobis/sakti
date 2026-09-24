// Per-feature settings. Each feature's values live under `feature:<id>` in the
// storage area its descriptor declares. Content-script calls are wrapped: once
// the extension is reloaded the old script is orphaned and chrome.* throws.

import type { Feature, SettingDef, StorageAreaName } from "./feature.ts";
import { SETTINGS_PREFIX } from "./state.ts";

export interface SettingsHandle<S = Record<string, unknown>> {
  get<K extends keyof S & string>(name: K): Promise<S[K]>;
  set<K extends keyof S & string>(name: K, value: S[K]): Promise<void>;
  onChange<K extends keyof S & string>(name: K, listener: (value: S[K]) => void): void;
}

export type SettingsOf<F extends Feature> = F["settings"] extends Record<string, SettingDef>
  ? { [K in keyof F["settings"]]: F["settings"][K]["default"] }
  : Record<string, never>;

const storageArea = (name: StorageAreaName): chrome.storage.StorageArea =>
  name === "sync" ? chrome.storage.sync : chrome.storage.local;

export function settingsHandle(featureId: string, defs: Record<string, SettingDef>): SettingsHandle {
  const key = SETTINGS_PREFIX + featureId;
  const areaOf = (name: string): StorageAreaName => defs[name]?.area ?? "local";
  const fallback = (name: string): unknown => defs[name]?.default ?? null;

  async function readValues(area: StorageAreaName): Promise<Record<string, unknown>> {
    const items = await storageArea(area).get(key);
    return (items[key] ?? {}) as Record<string, unknown>;
  }

  return {
    async get(name) {
      try {
        const values = await readValues(areaOf(name));
        return name in values ? values[name] : fallback(name);
      } catch {
        return fallback(name);
      }
    },
    async set(name, value) {
      try {
        const area = areaOf(name);
        const values = await readValues(area);
        await storageArea(area).set({ [key]: { ...values, [name]: value } });
      } catch {
        // orphaned script: nothing to save to
      }
    },
    onChange(name, listener) {
      try {
        chrome.storage.onChanged.addListener((changes, changedArea) => {
          const change = changes[key];
          if (!change || changedArea !== areaOf(name)) return;
          const before = (change.oldValue as Record<string, unknown> | undefined)?.[name];
          const after = (change.newValue as Record<string, unknown> | undefined)?.[name];
          if (JSON.stringify(before) !== JSON.stringify(after)) listener(after === undefined ? fallback(name) : after);
        });
      } catch {
        // orphaned script
      }
    },
  };
}

/** Typed settings for a feature's own content script. */
export function useSettings<F extends Feature>(feature: F): SettingsHandle<SettingsOf<F>> {
  return settingsHandle(feature.id, feature.settings ?? {}) as unknown as SettingsHandle<SettingsOf<F>>;
}
