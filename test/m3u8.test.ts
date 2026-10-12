import { test } from "node:test";
import assert from "node:assert/strict";
import { audioFor, parseAttributes, parsePlaylist, type MasterPlaylist, type MediaPlaylist } from "../src/media/m3u8.ts";

const BASE = "https://cdn.test/path/index.m3u8?token=1";

function media(lines: string[]): MediaPlaylist {
  const playlist = parsePlaylist(lines.join("\n"), BASE);
  assert.equal(playlist.type, "media");
  return playlist as MediaPlaylist;
}

test("attributes keep commas inside quotes", () => {
  assert.deepEqual(parseAttributes('BANDWIDTH=800,CODECS="avc1.4d,mp4a.40",RESOLUTION=640x360'), {
    BANDWIDTH: "800",
    CODECS: "avc1.4d,mp4a.40",
    RESOLUTION: "640x360",
  });
});

test("anything that is not a playlist is refused", () => {
  assert.throws(() => parsePlaylist("<html>", BASE), /Not an HLS playlist/);
});

test("a master playlist lists variants with resolved URLs", () => {
  const playlist = parsePlaylist(
    [
      "#EXTM3U",
      '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud",NAME="English",DEFAULT=YES,URI="audio/en.m3u8"',
      '#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="sub",NAME="English",URI="subs/en.m3u8"',
      '#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=640x360,CODECS="avc1.4d401e,mp4a.40.2",AUDIO="aud"',
      "360/index.m3u8",
      "#EXT-X-STREAM-INF:BANDWIDTH=6000000,RESOLUTION=1920x1080,FRAME-RATE=60.000",
      "https://other.test/1080.m3u8",
    ].join("\n"),
    BASE,
  ) as MasterPlaylist;

  assert.equal(playlist.type, "master");
  assert.deepEqual(playlist.variants, [
    { url: "https://cdn.test/path/360/index.m3u8", bandwidth: 800000, width: 640, height: 360, frameRate: null, audioGroup: "aud" },
    { url: "https://other.test/1080.m3u8", bandwidth: 6000000, width: 1920, height: 1080, frameRate: 60, audioGroup: null },
  ]);
  assert.deepEqual(playlist.audio, [{ group: "aud", name: "English", isDefault: true, url: "https://cdn.test/path/audio/en.m3u8" }]);
  assert.equal(audioFor(playlist, playlist.variants[0]!), "https://cdn.test/path/audio/en.m3u8");
  assert.equal(audioFor(playlist, playlist.variants[1]!), null);
});

test("a finished media playlist gives its segments and length", () => {
  const playlist = parsePlaylist(
    ["#EXTM3U", "#EXT-X-TARGETDURATION:4", "#EXTINF:4.0,", "a.ts", "#EXTINF:2.5,", "/abs/b.ts", "#EXT-X-ENDLIST"].join("\r\n"),
    BASE,
  ) as MediaPlaylist;
  assert.equal(playlist.ended, true);
  assert.equal(playlist.duration, 6.5);
  assert.equal(playlist.protection, "none");
  assert.deepEqual(playlist.requests, [{ url: "https://cdn.test/path/a.ts" }, { url: "https://cdn.test/abs/b.ts" }]);
});

test("a playlist without an end tag is live", () => {
  assert.equal(media(["#EXTM3U", "#EXTINF:2,", "a.ts"]).ended, false);
});

test("byte ranges continue from the previous one when no offset is given", () => {
  const playlist = media(["#EXTM3U", "#EXTINF:1,", "#EXT-X-BYTERANGE:100@50", "all.ts", "#EXTINF:1,", "#EXT-X-BYTERANGE:200", "all.ts", "#EXT-X-ENDLIST"]);
  assert.deepEqual(playlist.requests, [
    { url: "https://cdn.test/path/all.ts", range: { offset: 50, length: 100 } },
    { url: "https://cdn.test/path/all.ts", range: { offset: 150, length: 200 } },
  ]);
});

test("the init section is requested once, before the segments", () => {
  const map = '#EXT-X-MAP:URI="init.mp4",BYTERANGE="700@0"';
  const playlist = media(["#EXTM3U", map, "#EXTINF:1,", "1.m4s", map, "#EXTINF:1,", "2.m4s", "#EXT-X-ENDLIST"]);
  assert.deepEqual(playlist.requests, [
    { url: "https://cdn.test/path/init.mp4", range: { offset: 0, length: 700 } },
    { url: "https://cdn.test/path/1.m4s" },
    { url: "https://cdn.test/path/2.m4s" },
  ]);
});

test("AES-128 keys attach to the segments after them", () => {
  const playlist = media([
    "#EXTM3U",
    "#EXT-X-MEDIA-SEQUENCE:7",
    '#EXT-X-KEY:METHOD=AES-128,URI="key.bin",IV=0x00000000000000000000000000ABCDEF',
    "#EXTINF:1,",
    "a.ts",
    '#EXT-X-KEY:METHOD=AES-128,URI="key2.bin"',
    "#EXTINF:1,",
    "b.ts",
    "#EXT-X-KEY:METHOD=NONE",
    "#EXTINF:1,",
    "c.ts",
    "#EXT-X-ENDLIST",
  ]);
  assert.equal(playlist.protection, "aes-128");
  assert.deepEqual(playlist.requests, [
    { url: "https://cdn.test/path/a.ts", key: { url: "https://cdn.test/path/key.bin", iv: "00000000000000000000000000abcdef" } },
    // no IV given: the segment's sequence number, 8
    { url: "https://cdn.test/path/b.ts", key: { url: "https://cdn.test/path/key2.bin", iv: "00000000000000000000000000000008" } },
    { url: "https://cdn.test/path/c.ts" },
  ]);
});

test("sample encryption and vendor key formats are DRM", () => {
  const sample = media(["#EXTM3U", '#EXT-X-KEY:METHOD=SAMPLE-AES,URI="skd://x"', "#EXTINF:1,", "a.ts", "#EXT-X-ENDLIST"]);
  assert.equal(sample.protection, "drm");
  const vendor = media(["#EXTM3U", '#EXT-X-KEY:METHOD=AES-128,URI="data:x",KEYFORMAT="com.apple.streamingkeydelivery"', "#EXTINF:1,", "a.ts", "#EXT-X-ENDLIST"]);
  assert.equal(vendor.protection, "drm");
});
