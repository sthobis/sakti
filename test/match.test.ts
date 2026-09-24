import { test } from "node:test";
import assert from "node:assert/strict";
import { compilePattern, hostOf, hostPattern, matchesPattern, urlMatches } from "../src/core/match.ts";

test("<all_urls> matches web and file pages but not browser or extension pages", () => {
  assert.equal(matchesPattern("<all_urls>", "https://example.com/a"), true);
  assert.equal(matchesPattern("<all_urls>", "http://example.com/"), true);
  assert.equal(matchesPattern("<all_urls>", "file:///C:/notes.html"), true);
  assert.equal(matchesPattern("<all_urls>", "chrome-extension://abc/popup.html"), false);
  assert.equal(matchesPattern("<all_urls>", "chrome://extensions/"), false);
});

test("a * scheme matches http and https only", () => {
  assert.equal(matchesPattern("*://example.com/*", "https://example.com/x"), true);
  assert.equal(matchesPattern("*://example.com/*", "http://example.com/x"), true);
  assert.equal(matchesPattern("*://example.com/*", "ftp://example.com/x"), false);
});

test("an exact host matches only that host and scheme", () => {
  const pattern = "https://www.youtube.com/*";
  assert.equal(matchesPattern(pattern, "https://www.youtube.com/watch?v=1"), true);
  assert.equal(matchesPattern(pattern, "https://youtube.com/watch?v=1"), false);
  assert.equal(matchesPattern(pattern, "https://m.youtube.com/"), false);
  assert.equal(matchesPattern(pattern, "http://www.youtube.com/"), false);
});

test("a *. host matches the domain and its subdomains", () => {
  const pattern = "*://*.example.com/*";
  assert.equal(matchesPattern(pattern, "https://example.com/"), true);
  assert.equal(matchesPattern(pattern, "https://a.b.example.com/"), true);
  assert.equal(matchesPattern(pattern, "https://badexample.com/"), false);
});

test("the path glob covers the query string", () => {
  assert.equal(matchesPattern("https://example.com/foo*", "https://example.com/foo"), true);
  assert.equal(matchesPattern("https://example.com/foo*", "https://example.com/foobar"), true);
  assert.equal(matchesPattern("https://example.com/foo*", "https://example.com/foo?x=1"), true);
  assert.equal(matchesPattern("https://example.com/foo*", "https://example.com/bar"), false);
  assert.equal(matchesPattern("https://example.com/a/*/c", "https://example.com/a/b/c"), true);
  assert.equal(matchesPattern("https://example.com/a/*/c", "https://example.com/a/c"), false);
});

test("a pattern without a port matches any port; an explicit port must match", () => {
  assert.equal(matchesPattern("http://localhost/*", "http://localhost:4000/"), true);
  assert.equal(matchesPattern("http://localhost:3000/*", "http://localhost:3000/x"), true);
  assert.equal(matchesPattern("http://localhost:3000/*", "http://localhost:4000/x"), false);
  assert.equal(matchesPattern("https://example.com:443/*", "https://example.com/"), true);
});

test("invalid patterns do not compile", () => {
  assert.equal(compilePattern("example.com"), null);
  assert.equal(compilePattern("https://*foo.com/*"), null);
  assert.equal(compilePattern("https://example.com"), null);
  assert.equal(compilePattern("file://host/x"), null);
  assert.equal(compilePattern("https:///x"), null);
  assert.notEqual(compilePattern("file:///*"), null);
});

test("urlMatches applies excludes after matches", () => {
  const url = "https://github.com/settings/profile";
  assert.equal(urlMatches(["https://github.com/*"], [], url), true);
  assert.equal(urlMatches(["https://github.com/*"], ["https://github.com/settings/*"], url), false);
  assert.equal(urlMatches([], [], url), false);
  assert.equal(matchesPattern("https://github.com/*", "not a url"), false);
});

test("hostOf returns the lowercase hostname of http and https pages only", () => {
  assert.equal(hostOf("https://GitHub.com/x"), "github.com");
  assert.equal(hostOf("http://localhost:3000/"), "localhost");
  assert.equal(hostOf("chrome://extensions/"), null);
  assert.equal(hostOf("file:///C:/x.html"), null);
  assert.equal(hostOf("garbage"), null);
  assert.equal(hostOf(undefined), null);
});

test("hostPattern builds a match pattern for one host", () => {
  assert.equal(hostPattern("github.com"), "*://github.com/*");
});
