// The export/import file. Import merges by id: entries in the file replace
// same-id entries here, entries only on this machine stay, nothing is deleted.

import type { FeaturesState, UserscriptRecord, UserscriptsState } from "./state.ts";
import { SETTINGS_PREFIX } from "./state.ts";
import { parseHeader } from "../userscripts/header.ts";
import { scriptId } from "../userscripts/id.ts";

export interface SettingsSnapshot {
  sync: Record<string, unknown>;
  local: Record<string, unknown>;
}

export interface Snapshot {
  features: FeaturesState;
  userscripts: UserscriptsState;
  settings: SettingsSnapshot;
}

export interface ExportFile extends Snapshot {
  sakti: 1;
  exportedAt: string;
}

export type ImportResult = { ok: true; file: ExportFile } | { ok: false; error: string };

export function pickSettings(items: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(items).filter(([key]) => key.startsWith(SETTINGS_PREFIX)));
}

export function buildExport(snapshot: Snapshot, now: string): ExportFile {
  return {
    sakti: 1,
    exportedAt: now,
    features: snapshot.features,
    settings: snapshot.settings,
    userscripts: snapshot.userscripts,
  };
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const isStringList = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === "string");

export function parseImport(text: string): ImportResult {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, error: "Not a valid JSON file." };
  }
  if (!isObject(data) || data.sakti !== 1) return { ok: false, error: "Not a Sakti backup file." };

  const { features, userscripts, settings } = data;
  if (!isObject(features) || !isObject(userscripts) || !isObject(settings) || !isObject(settings.sync) || !isObject(settings.local)) {
    return { ok: false, error: "The backup file is incomplete." };
  }

  const cleanFeatures: FeaturesState = {};
  for (const [id, entry] of Object.entries(features)) {
    if (!isObject(entry) || typeof entry.enabled !== "boolean" || !isStringList(entry.disabledHosts)) {
      return { ok: false, error: `Feature "${id}" has an invalid entry.` };
    }
    cleanFeatures[id] = { enabled: entry.enabled, disabledHosts: entry.disabledHosts };
  }

  // Never trust stored meta or ids: derive both from the source again.
  const cleanScripts: UserscriptsState = {};
  for (const [key, entry] of Object.entries(userscripts)) {
    if (!isObject(entry) || typeof entry.source !== "string") return { ok: false, error: `Userscript "${key}" has no source.` };
    const { meta, errors } = parseHeader(entry.source);
    if (!meta) return { ok: false, error: `Userscript "${key}" has an invalid header: ${errors.join(" ")}` };
    const id = scriptId(meta.name, meta.namespace);
    const record: UserscriptRecord = {
      id,
      enabled: typeof entry.enabled === "boolean" ? entry.enabled : true,
      source: entry.source,
      meta,
      updatedAt: typeof entry.updatedAt === "string" ? entry.updatedAt : "",
      disabledHosts: isStringList(entry.disabledHosts) ? entry.disabledHosts : [],
    };
    cleanScripts[id] = record;
  }

  return {
    ok: true,
    file: {
      sakti: 1,
      exportedAt: typeof data.exportedAt === "string" ? data.exportedAt : "",
      features: cleanFeatures,
      settings: { sync: pickSettings(settings.sync), local: pickSettings(settings.local) },
      userscripts: cleanScripts,
    },
  };
}

export function mergeImport(current: Snapshot, file: Snapshot): Snapshot {
  return {
    features: { ...current.features, ...file.features },
    userscripts: { ...current.userscripts, ...file.userscripts },
    settings: {
      sync: { ...current.settings.sync, ...file.settings.sync },
      local: { ...current.settings.local, ...file.settings.local },
    },
  };
}
