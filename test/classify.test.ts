import { test } from "node:test";
import assert from "node:assert/strict";
import { classify, type ResponseInfo } from "../src/media/classify.ts";

function response(url: string, type: string, statusCode: number, headers: Record<string, string>): ResponseInfo {
  return { url, type, statusCode, headers: Object.entries(headers).map(([name, value]) => ({ name, value })) };
}

test("a playlist is HLS by content type or by extension", () => {
  assert.deepEqual(classify(response("https://a.test/live?id=1", "xmlhttprequest", 200, { "Content-Type": "application/vnd.apple.mpegurl" })), {
    kind: "hls",
    size: null,
  });
  assert.deepEqual(classify(response("https://a.test/v/index.M3U8?token=x", "xmlhttprequest", 200, { "content-type": "text/plain" })), {
    kind: "hls",
    size: null,
  });
});

test("a manifest is DASH by content type or by extension", () => {
  assert.deepEqual(classify(response("https://a.test/m", "xmlhttprequest", 200, { "content-type": "application/dash+xml; charset=utf-8" })), {
    kind: "dash",
    size: null,
  });
  assert.deepEqual(classify(response("https://a.test/stream.mpd", "other", 200, {})), { kind: "dash", size: null });
});

test("a video element loading a file is a file, sized from the range total", () => {
  const ranged = response("https://a.test/clip.mp4", "media", 206, { "content-type": "video/mp4", "content-range": "bytes 0-1023/5000" });
  assert.deepEqual(classify(ranged), { kind: "file", size: 5000 });
  const whole = response("https://a.test/clip.webm", "media", 200, { "content-type": "video/webm", "content-length": "777" });
  assert.deepEqual(classify(whole), { kind: "file", size: 777 });
});

test("a video element loading plain bytes counts when the URL names a video", () => {
  const info = response("https://a.test/clip.mp4", "media", 200, { "content-type": "application/octet-stream" });
  assert.deepEqual(classify(info), { kind: "file", size: null });
  assert.equal(classify(response("https://a.test/blob", "media", 200, { "content-type": "application/octet-stream" })), null);
});

test("a script fetching a large file by range is a file", () => {
  const info = response("https://a.test/v.mp4", "xmlhttprequest", 206, { "content-type": "video/mp4", "content-range": "bytes 0-99/52428800" });
  assert.deepEqual(classify(info), { kind: "file", size: 52428800 });
});

test("streaming segments are noise", () => {
  // a transport stream chunk, fetched whole
  assert.equal(classify(response("https://a.test/1.ts", "xmlhttprequest", 200, { "content-type": "video/mp2t", "content-length": "900000" })), null);
  // a fragmented MP4 chunk, fetched whole
  assert.equal(classify(response("https://a.test/seg1.m4s", "xmlhttprequest", 200, { "content-type": "video/mp4", "content-length": "4000000" })), null);
  // a small ranged file
  assert.equal(classify(response("https://a.test/s.mp4", "xmlhttprequest", 206, { "content-type": "video/mp4", "content-range": "bytes 0-9/2000" })), null);
});

test("audio, failures and other schemes are ignored", () => {
  assert.equal(classify(response("https://a.test/a.mp3", "media", 200, { "content-type": "audio/mpeg" })), null);
  assert.equal(classify(response("https://a.test/v.m3u8", "xmlhttprequest", 403, { "content-type": "application/vnd.apple.mpegurl" })), null);
  assert.equal(classify(response("blob:https://a.test/1", "media", 200, { "content-type": "video/mp4" })), null);
});
