import { test } from "node:test";
import assert from "node:assert/strict";
import { bestAudio, fillTemplate, parseDuration, parseManifest } from "../src/media/mpd.ts";
import { parseXml } from "../src/media/xml.ts";

const MANIFEST_URL = "https://cdn.test/v/manifest.mpd";
const urls = (requests: { url: string }[]): string[] => requests.map((request) => request.url);

test("the XML reader handles attributes, text, comments, CDATA and entities", () => {
  const root = parseXml(`<?xml version="1.0"?><!-- c --><a x="1 &amp; 2" ns:y='q'><b/><c>t&lt;<![CDATA[<raw>]]></c></a>`);
  const a = root.children[0]!;
  assert.equal(a.name, "a");
  assert.deepEqual(a.attrs, { x: "1 & 2", y: "q" });
  assert.deepEqual(
    a.children.map((child) => [child.name, child.text]),
    [
      ["b", ""],
      ["c", "t<<raw>"],
    ],
  );
});

test("ISO durations become seconds", () => {
  assert.equal(parseDuration("PT1H2M3.5S"), 3723.5);
  assert.equal(parseDuration("P0Y0M1DT0H0M10S"), 86410);
  assert.equal(parseDuration("soon"), null);
  assert.equal(parseDuration(undefined), null);
});

test("templates are filled with padding and escapes", () => {
  const values = { id: "v1", bandwidth: 500, number: 7, time: 9000 };
  assert.equal(fillTemplate("$RepresentationID$/$Number%05d$.m4s", values), "v1/00007.m4s");
  assert.equal(fillTemplate("$Bandwidth$-$Time$-$$", values), "500-9000-$");
});

test("a numbered template yields the init segment and every segment", () => {
  const manifest = parseManifest(
    `<MPD type="static" mediaPresentationDuration="PT10S">
      <Period>
        <AdaptationSet contentType="video" frameRate="30000/1001">
          <SegmentTemplate timescale="1000" duration="4000" startNumber="1" initialization="$RepresentationID$/init.mp4" media="$RepresentationID$/$Number$.m4s"/>
          <Representation id="hd" bandwidth="3000000" width="1280" height="720"/>
          <Representation id="sd" bandwidth="800000" width="640" height="360"/>
        </AdaptationSet>
        <AdaptationSet mimeType="audio/mp4">
          <Representation id="lo" bandwidth="64000"><BaseURL>audio/lo.mp4</BaseURL><SegmentBase indexRange="0-100"/></Representation>
          <Representation id="hi" bandwidth="128000"><BaseURL>audio/hi.mp4</BaseURL></Representation>
        </AdaptationSet>
      </Period>
    </MPD>`,
    MANIFEST_URL,
  );
  assert.equal(manifest.live, false);
  assert.equal(manifest.duration, 10);
  assert.equal(manifest.protected, false);
  assert.equal(manifest.periods, 1);
  assert.equal(manifest.video.length, 2);
  assert.equal(manifest.video[0]!.height, 720);
  assert.ok(Math.abs(manifest.video[0]!.frameRate! - 29.97) < 0.01);
  assert.deepEqual(urls(manifest.video[0]!.requests), [
    "https://cdn.test/v/hd/init.mp4",
    "https://cdn.test/v/hd/1.m4s",
    "https://cdn.test/v/hd/2.m4s",
    "https://cdn.test/v/hd/3.m4s",
  ]);
  // a representation that is one whole file
  assert.deepEqual(manifest.audio[0]!.requests, [{ url: "https://cdn.test/v/audio/lo.mp4" }]);
  assert.equal(bestAudio(manifest)!.id, "hi");
});

test("a timeline template follows times and repeats", () => {
  const manifest = parseManifest(
    `<MPD mediaPresentationDuration="PT8S"><BaseURL>https://media.test/root/</BaseURL>
      <Period>
        <AdaptationSet mimeType="video/mp4">
          <Representation id="1" bandwidth="1">
            <SegmentTemplate timescale="10" media="t$Time$-n$Number$.m4s" startNumber="5">
              <SegmentTimeline><S t="100" d="20" r="1"/><S d="30"/><S d="10" r="-1"/></SegmentTimeline>
            </SegmentTemplate>
          </Representation>
        </AdaptationSet>
      </Period>
    </MPD>`,
    MANIFEST_URL,
  );
  // the open-ended repeat stops at the end of the 8 s period, which is tick 80
  assert.deepEqual(urls(manifest.video[0]!.requests), [
    "https://media.test/root/t100-n5.m4s",
    "https://media.test/root/t120-n6.m4s",
    "https://media.test/root/t140-n7.m4s",
    "https://media.test/root/t170-n8.m4s",
  ]);
});

test("a segment list gives ranges", () => {
  const manifest = parseManifest(
    `<MPD><Period duration="PT4S">
      <AdaptationSet contentType="video">
        <Representation id="1"><BaseURL>one.mp4</BaseURL>
          <SegmentList><Initialization sourceURL="one.mp4" range="0-99"/><SegmentURL media="one.mp4" mediaRange="100-299"/></SegmentList>
        </Representation>
      </AdaptationSet>
    </Period></MPD>`,
    MANIFEST_URL,
  );
  assert.equal(manifest.duration, 4);
  assert.deepEqual(manifest.video[0]!.requests, [
    { url: "https://cdn.test/v/one.mp4", range: { offset: 0, length: 100 } },
    { url: "https://cdn.test/v/one.mp4", range: { offset: 100, length: 200 } },
  ]);
});

test("live, protected and multi-period manifests are flagged", () => {
  const manifest = parseManifest(
    `<MPD type="dynamic">
      <Period><AdaptationSet contentType="video"><ContentProtection schemeIdUri="urn:uuid:edef8ba9"/>
        <Representation id="1"><BaseURL>a.mp4</BaseURL></Representation></AdaptationSet></Period>
      <Period/>
    </MPD>`,
    MANIFEST_URL,
  );
  assert.equal(manifest.live, true);
  assert.equal(manifest.protected, true);
  assert.equal(manifest.periods, 2);
});

test("a template without a known length is an error", () => {
  const text = `<MPD><Period><AdaptationSet contentType="video"><Representation id="1"><SegmentTemplate duration="2" media="$Number$.m4s"/></Representation></AdaptationSet></Period></MPD>`;
  assert.throws(() => parseManifest(text, MANIFEST_URL), /how long/);
});
