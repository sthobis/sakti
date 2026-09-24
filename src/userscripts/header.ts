// Parses the // ==UserScript== block. Parsing happens once, at save time; the
// registrar only ever reads the resulting meta.

import type { RunAt } from "../core/feature.ts";

export interface UserscriptMeta {
  name: string;
  namespace?: string;
  description?: string;
  version?: string;
  matches: string[];
  excludeMatches: string[];
  runAt: RunAt;
  world: "MAIN" | "USER_SCRIPT";
}

export interface HeaderResult {
  meta: UserscriptMeta | null;
  errors: string[];
  warnings: string[];
}

const START = /^\s*\/\/\s*==UserScript==\s*$/;
const END = /^\s*\/\/\s*==\/UserScript==\s*$/;
const ENTRY = /^\s*\/\/\s*@([\w-]+)(:[\w-]+)?(?:\s+(.*?))?\s*$/;
const RUN_AT: Record<string, RunAt> = {
  "document-start": "document_start",
  "document-end": "document_end",
  "document-idle": "document_idle",
};
// Descriptive keys that change nothing about how or where a script runs.
const IGNORED = new Set([
  "author", "icon", "iconURL", "icon64", "icon64URL", "homepage", "homepageURL", "website", "source",
  "supportURL", "downloadURL", "updateURL", "license", "copyright", "contributionURL", "antifeature",
  "noframes", "compatible", "incompatible",
]);

export function parseHeader(source: string): HeaderResult {
  const errors = new Set<string>();
  const warnings = new Set<string>();
  const done = (meta: UserscriptMeta | null): HeaderResult => ({
    meta: errors.size ? null : meta,
    errors: [...errors],
    warnings: [...warnings],
  });

  const lines = source.split(/\r?\n/);
  const start = lines.findIndex((line) => START.test(line));
  if (start === -1) {
    errors.add("Missing // ==UserScript== header.");
    return done(null);
  }
  const length = lines.slice(start + 1).findIndex((line) => END.test(line));
  if (length === -1) {
    errors.add("Missing // ==/UserScript== closing line.");
    return done(null);
  }

  let name = "";
  let namespace = "";
  let description = "";
  let version = "";
  let runAt: RunAt = "document_idle";
  const matches: string[] = [];
  const excludeMatches: string[] = [];
  const grants: string[] = [];

  for (const line of lines.slice(start + 1, start + 1 + length)) {
    const entry = ENTRY.exec(line);
    if (!entry) continue;
    const [, key, locale, raw] = entry;
    const value = (raw ?? "").trim();
    if (locale) continue; // @name:ja and friends

    switch (key) {
      case "name":
        name ||= value;
        break;
      case "namespace":
        namespace ||= value;
        break;
      case "description":
        description ||= value;
        break;
      case "version":
        version ||= value;
        break;
      case "match":
        if (value) matches.push(value);
        break;
      case "exclude":
      case "exclude-match":
        if (value) excludeMatches.push(value);
        break;
      case "include":
        errors.add("@include is not supported. Use @match instead.");
        break;
      case "run-at": {
        const mapped = RUN_AT[value];
        if (mapped) runAt = mapped;
        else errors.add(`Unsupported @run-at value "${value}". Use document-start, document-end or document-idle.`);
        break;
      }
      case "grant":
        if (value) grants.push(value);
        break;
      default:
        if (!IGNORED.has(key)) warnings.add(`@${key} is not supported and was ignored.`);
    }
  }

  if (!name) errors.add("@name is required.");
  if (matches.length === 0) errors.add("At least one @match is required.");
  const isolated = grants.some((grant) => grant !== "none");
  if (isolated) warnings.add("GM_* APIs are not available. The script runs in the isolated USER_SCRIPT world.");

  return done({
    name,
    ...(namespace ? { namespace } : {}),
    ...(description ? { description } : {}),
    ...(version ? { version } : {}),
    matches,
    excludeMatches,
    runAt,
    world: isolated ? "USER_SCRIPT" : "MAIN",
  });
}
