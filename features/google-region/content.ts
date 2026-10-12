// Google Region content script: in an incognito window, saves "United States"
// as Google Search's results region, the same way Search settings does.
//
// Google keeps the region in a cookie, and incognito drops that cookie when the
// last window closes, so the region falls back to wherever the IP address is.
// The gl= URL parameter does not replace the saved setting.
//
// Regular windows are left alone: there the setting already persists, and it
// may belong to a signed-in account.

import { findSetprefsUrl, regionUrl } from "./prefs.ts";

(() => {
  const REGION = "US";
  // localStorage is cleared together with the cookie, so the two stay in step.
  const DONE_KEY = "sakti:google-region";

  if (!chrome.extension.inIncognitoContext) return;

  function isDone(): boolean {
    try {
      return localStorage.getItem(DONE_KEY) === REGION;
    } catch {
      return false;
    }
  }

  function markDone(): boolean {
    try {
      localStorage.setItem(DONE_KEY, REGION);
      return true;
    } catch {
      return false;
    }
  }

  async function saveRegion(): Promise<void> {
    const page = await fetch("/preferences");
    if (!page.ok) throw new Error(`the settings page answered ${page.status}`);
    const setprefs = findSetprefsUrl(await page.text());
    if (!setprefs) throw new Error("the settings page has no setprefs link");
    const saved = await fetch(regionUrl(setprefs, REGION));
    if (!saved.ok) throw new Error(`setprefs answered ${saved.status}`);
  }

  if (isDone()) return;

  saveRegion().then(
    () => {
      // Without the mark every page would save and reload again, so no reload.
      if (!markDone()) return;
      // these results were made for the old region
      if (location.pathname === "/search") location.reload();
    },
    (error: unknown) => console.warn("[sakti] google-region could not set the region", error),
  );
})();
