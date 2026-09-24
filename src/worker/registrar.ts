// The only code that registers scripts with Chrome. The UI writes storage;
// this turns storage + the built-in registry into Chrome registrations.

import registry from "sakti:registry";
import { readState } from "../core/storage.ts";
import {
  desiredContentScripts,
  desiredUserScripts,
  diff,
  normalizeContentScript,
  normalizeUserScript,
  USERSCRIPT_PREFIX,
  type ContentScriptSpec,
  type UserScriptSpec,
} from "./plan.ts";

/**
 * chrome.userScripts throws until the user allows it: the "Allow User Scripts"
 * switch on Sakti's details page (Chrome 138+) or Developer mode (Chrome 120-137).
 */
export function userScriptsAvailable(): boolean {
  try {
    chrome.userScripts.getScripts().catch(() => {});
    return true;
  } catch {
    return false;
  }
}

function toChromeContentScript(spec: ContentScriptSpec): chrome.scripting.RegisteredContentScript {
  return {
    id: spec.id,
    matches: spec.matches,
    ...(spec.excludeMatches.length ? { excludeMatches: spec.excludeMatches } : {}),
    ...(spec.js.length ? { js: spec.js } : {}),
    ...(spec.css.length ? { css: spec.css } : {}),
    world: spec.world,
    runAt: spec.runAt,
    allFrames: spec.allFrames,
    matchOriginAsFallback: spec.matchOriginAsFallback,
    persistAcrossSessions: spec.persistAcrossSessions,
  } as unknown as chrome.scripting.RegisteredContentScript;
}

function toChromeUserScript(spec: UserScriptSpec): chrome.userScripts.RegisteredUserScript {
  return {
    id: spec.id,
    matches: spec.matches,
    ...(spec.excludeMatches.length ? { excludeMatches: spec.excludeMatches } : {}),
    js: [{ code: spec.code }],
    world: spec.world,
    runAt: spec.runAt,
    allFrames: spec.allFrames,
  } as unknown as chrome.userScripts.RegisteredUserScript;
}

async function syncContentScripts(desired: ContentScriptSpec[]): Promise<void> {
  const current = (await chrome.scripting.getRegisteredContentScripts()).map(normalizeContentScript);
  const { unregister, register } = diff(desired, current);
  if (unregister.length) await chrome.scripting.unregisterContentScripts({ ids: unregister });
  // One at a time, so one bad descriptor cannot block the others.
  for (const spec of register) {
    try {
      await chrome.scripting.registerContentScripts([toChromeContentScript(spec)]);
    } catch (error) {
      console.error(`[sakti] could not register ${spec.id}`, error);
    }
  }
}

async function syncUserScripts(desired: UserScriptSpec[]): Promise<void> {
  if (!userScriptsAvailable()) {
    await chrome.storage.local.set({ userscriptErrors: {} });
    return;
  }
  const current = (await chrome.userScripts.getScripts()).map(normalizeUserScript);
  const { unregister, register } = diff(desired, current);
  if (unregister.length) await chrome.userScripts.unregister({ ids: unregister });

  // A script Chrome rejected is not registered, so it is retried (and its error
  // recorded again) on every pass until it is fixed or disabled.
  const errors: Record<string, string> = {};
  for (const spec of register) {
    try {
      await chrome.userScripts.register([toChromeUserScript(spec)]);
    } catch (error) {
      errors[spec.id.slice(USERSCRIPT_PREFIX.length)] = error instanceof Error ? error.message : String(error);
    }
  }
  await chrome.storage.local.set({ userscriptErrors: errors });
}

export async function reconcile(): Promise<void> {
  const { features, userscripts } = await readState();
  await syncContentScripts(desiredContentScripts(registry, features));
  await syncUserScripts(desiredUserScripts(userscripts));
}

let queue: Promise<void> = Promise.resolve();

/** Runs reconcile() after any pass already in flight. Never rejects. */
export function scheduleReconcile(): Promise<void> {
  queue = queue.then(reconcile).catch((error: unknown) => console.error("[sakti] reconcile failed", error));
  return queue;
}
