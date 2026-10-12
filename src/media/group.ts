// Decides which detections the popup lists. A page that plays an HLS stream
// loads the master playlist and then the playlist of the quality it picked;
// both are detected, but only the master is a video the user can choose from.
// Pure.

import type { Detection } from "./types.ts";

export function visibleDetections(detections: readonly Detection[]): Detection[] {
  const children = new Set<string>();
  for (const detection of detections) {
    if (detection.probe && "children" in detection.probe) {
      for (const url of detection.probe.children) children.add(url);
    }
  }
  return detections.filter((detection) => detection.probe?.status !== "hidden" && !children.has(detection.url));
}
