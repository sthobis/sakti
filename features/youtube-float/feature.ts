import { defineFeature } from "../../src/core/feature.ts";

export interface Geometry {
  top: number;
  left: number;
  width: number;
  height: number;
}

export default defineFeature({
  id: "youtube-float",
  name: "YouTube Float",
  description: "Keeps the YouTube player floating while you read the comments. Timestamps seek without losing your place.",
  matches: ["https://www.youtube.com/*"],
  runAt: "document_idle",
  scripts: { content: "./content.ts", main: "./main.ts", css: "./content.css" },
  settings: {
    geometry: { type: "hidden", default: null as Geometry | null, area: "sync" },
  },
});
