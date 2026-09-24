// What "Save" and "Delete" do to the stored userscripts, as pure functions so
// the rules are testable without Chrome.

import type { UserscriptsState } from "../core/state.ts";
import { parseHeader } from "./header.ts";
import { scriptId, slug } from "./id.ts";

export type SaveResult =
  | { ok: true; id: string; next: UserscriptsState; warnings: string[] }
  | { ok: false; errors: string[] };

/**
 * @param previousId the id the editor had open, or null for a new script.
 *   When the header's name changes, the script moves to its new id and keeps
 *   its enabled flag and disabled hosts.
 */
export function applySave(scripts: UserscriptsState, source: string, previousId: string | null, now: string): SaveResult {
  const { meta, errors, warnings } = parseHeader(source);
  if (!meta) return { ok: false, errors };
  if (!slug(meta.name)) return { ok: false, errors: ["@name must contain at least one letter or digit."] };

  const id = scriptId(meta.name, meta.namespace);
  if (id !== previousId && scripts[id]) return { ok: false, errors: [`A script with this name already exists: ${id}.`] };

  const previous = previousId ? scripts[previousId] : undefined;
  const next: UserscriptsState = { ...scripts };
  if (previousId && previousId !== id) delete next[previousId];
  next[id] = {
    id,
    enabled: previous?.enabled ?? true,
    source,
    meta,
    updatedAt: now,
    disabledHosts: previous?.disabledHosts ?? [],
  };
  return { ok: true, id, next, warnings };
}

export function applyDelete(scripts: UserscriptsState, id: string): UserscriptsState {
  const next = { ...scripts };
  delete next[id];
  return next;
}
