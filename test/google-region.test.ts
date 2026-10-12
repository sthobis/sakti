import { test } from "node:test";
import assert from "node:assert/strict";
import { findSetprefsUrl, regionUrl } from "../features/google-region/prefs.ts";

const SETPREFS = "https://www.google.com/setprefs?sig=0_abc-DEF_123%3D&authuser=0";

function settingsPage(spbu: string): string {
  return `<div jscontroller="gri7yb" class="iORcjf" data-spbu="${spbu}"><style>:root{}</style></div>`;
}

test("findSetprefsUrl reads the signed link and decodes its entities", () => {
  assert.equal(findSetprefsUrl(settingsPage(SETPREFS.replace("&", "&amp;"))), SETPREFS);
});

test("findSetprefsUrl is null when the page has no link", () => {
  assert.equal(findSetprefsUrl("<html><body>Search settings</body></html>"), null);
  assert.equal(findSetprefsUrl(""), null);
});

test("findSetprefsUrl refuses anything but a signed google.com/setprefs link", () => {
  assert.equal(findSetprefsUrl(settingsPage("https://evil.example/setprefs?sig=0_abc")), null);
  assert.equal(findSetprefsUrl(settingsPage("https://www.google.com/search?sig=0_abc")), null);
  assert.equal(findSetprefsUrl(settingsPage("https://www.google.com/setprefs?authuser=0")), null);
  assert.equal(findSetprefsUrl(settingsPage("not a url")), null);
});

test("regionUrl appends the region without re-encoding the signature", () => {
  assert.equal(regionUrl(SETPREFS, "US"), `${SETPREFS}&gl=US&noredirect=1`);
});
