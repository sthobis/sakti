import type { Feature, RegistryEntry } from "../src/core/feature.ts";
import { compilePattern } from "../src/core/match.ts";

const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const RUN_AT = ["document_start", "document_end", "document_idle"];
const SETTING_TYPES = ["boolean", "number", "string", "enum", "hidden"];

/** Returns human-readable problems; an empty list means the descriptor is usable. */
export function validateFeature(value: unknown, folder: string, fileExists: (relativePath: string) => boolean): string[] {
  const at = `features/${folder}/feature.ts`;
  if (typeof value !== "object" || value === null) return [`${at}: default export must be a feature descriptor.`];
  const feature = value as Partial<Feature>;
  const errors: string[] = [];

  if (typeof feature.id !== "string" || !ID.test(feature.id)) errors.push(`${at}: id must be a lowercase slug.`);
  else if (feature.id !== folder) errors.push(`${at}: id "${feature.id}" must equal the folder name "${folder}".`);
  if (typeof feature.name !== "string" || !feature.name.trim()) errors.push(`${at}: name is required.`);
  if (typeof feature.description !== "string" || !feature.description.trim()) errors.push(`${at}: description is required.`);

  const matches = Array.isArray(feature.matches) ? feature.matches : [];
  const excludes = Array.isArray(feature.excludeMatches) ? feature.excludeMatches : [];
  if (matches.length === 0) errors.push(`${at}: matches must list at least one pattern.`);
  for (const pattern of [...matches, ...excludes]) {
    if (typeof pattern !== "string" || !compilePattern(pattern)) errors.push(`${at}: invalid match pattern ${JSON.stringify(pattern)}.`);
  }

  if (feature.runAt !== undefined && !RUN_AT.includes(feature.runAt)) errors.push(`${at}: runAt must be one of ${RUN_AT.join(", ")}.`);

  const scripts = feature.scripts;
  if (!scripts || typeof scripts !== "object" || !(scripts.content || scripts.main || scripts.css)) {
    errors.push(`${at}: scripts must name at least one of content, main, css.`);
  } else {
    for (const [kind, file] of Object.entries(scripts)) {
      if (typeof file !== "string" || !fileExists(file)) errors.push(`${at}: scripts.${kind} file ${JSON.stringify(file)} does not exist.`);
    }
  }

  for (const [name, def] of Object.entries(feature.settings ?? {})) {
    if (!SETTING_TYPES.includes(def?.type)) errors.push(`${at}: setting "${name}" has an unknown type.`);
    else if (def.type === "enum" && !Array.isArray(def.options)) errors.push(`${at}: enum setting "${name}" needs options.`);
  }
  return errors;
}

export function toRegistryEntry(feature: Feature): RegistryEntry {
  const base = `features/${feature.id}`;
  return {
    id: feature.id,
    name: feature.name,
    description: feature.description,
    matches: [...feature.matches],
    excludeMatches: [...(feature.excludeMatches ?? [])],
    runAt: feature.runAt ?? "document_idle",
    allFrames: feature.allFrames ?? false,
    matchOriginAsFallback: feature.matchOriginAsFallback ?? false,
    perSite: feature.perSite ?? false,
    settings: feature.settings ?? {},
    files: {
      ...(feature.scripts.content ? { content: `${base}/content.js` } : {}),
      ...(feature.scripts.main ? { main: `${base}/main.js` } : {}),
      ...(feature.scripts.css ? { css: `${base}/content.css` } : {}),
    },
  };
}
