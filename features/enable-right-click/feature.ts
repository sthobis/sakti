import { defineFeature } from "../../src/core/feature.ts";

export default defineFeature({
  id: "enable-right-click",
  name: "Enable Right Click",
  description: "Restores the native context menu and blocks scripted popup and new-tab ads.",
  matches: ["<all_urls>"],
  runAt: "document_start",
  allFrames: true,
  matchOriginAsFallback: true,
  scripts: { main: "./main.ts" },
  perSite: true,
});
