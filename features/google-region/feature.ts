import { defineFeature } from "../../src/core/feature.ts";

export default defineFeature({
  id: "google-region",
  name: "Google Region",
  description: "Sets Google Search's results region to the United States in incognito windows, which otherwise forget it every session.",
  matches: ["https://www.google.com/*"],
  runAt: "document_start",
  scripts: { content: "./content.ts" },
});
