// chrome.storage access for the worker and the extension pages. Content
// scripts use settings.ts instead.

import type { Snapshot } from "./backup.ts";
import { pickSettings } from "./backup.ts";
import type { FeatureState, FeaturesState, UserscriptErrors, UserscriptRecord, UserscriptsState } from "./state.ts";
import { featureState } from "./state.ts";

export interface StoredState {
  features: FeaturesState;
  userscripts: UserscriptsState;
  userscriptErrors: UserscriptErrors;
}

export async function readState(): Promise<StoredState> {
  const items = await chrome.storage.local.get(["features", "userscripts", "userscriptErrors"]);
  return {
    features: (items.features ?? {}) as FeaturesState,
    userscripts: (items.userscripts ?? {}) as UserscriptsState,
    userscriptErrors: (items.userscriptErrors ?? {}) as UserscriptErrors,
  };
}

export async function updateFeature(id: string, change: (state: FeatureState) => FeatureState): Promise<void> {
  const { features } = await readState();
  await chrome.storage.local.set({ features: { ...features, [id]: change(featureState(features, id)) } });
}

export async function updateUserscript(id: string, change: (record: UserscriptRecord) => UserscriptRecord): Promise<void> {
  const { userscripts } = await readState();
  const record = userscripts[id];
  if (!record) return;
  await chrome.storage.local.set({ userscripts: { ...userscripts, [id]: change(record) } });
}

export async function writeUserscripts(userscripts: UserscriptsState): Promise<void> {
  await chrome.storage.local.set({ userscripts });
}

export async function readSnapshot(): Promise<Snapshot> {
  const [local, sync] = await Promise.all([chrome.storage.local.get(null), chrome.storage.sync.get(null)]);
  return {
    features: (local.features ?? {}) as FeaturesState,
    userscripts: (local.userscripts ?? {}) as UserscriptsState,
    settings: { local: pickSettings(local), sync: pickSettings(sync) },
  };
}

export async function writeSnapshot(snapshot: Snapshot): Promise<void> {
  await chrome.storage.local.set({ features: snapshot.features, userscripts: snapshot.userscripts, ...snapshot.settings.local });
  if (Object.keys(snapshot.settings.sync).length) await chrome.storage.sync.set(snapshot.settings.sync);
}
