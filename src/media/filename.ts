// Builds the name a download is saved under. Pure.

const RESERVED = /^(con|prn|aux|nul|com\d|lpt\d)$/i;
const EXTENSIONS = new Set(["mp4", "m4v", "mov", "webm", "mkv", "ts"]);
const MAX_LENGTH = 120;

/** Removes what Windows, macOS or chrome.downloads refuse in a file name. */
export function sanitize(text: string): string {
  const cleaned = text
    .replace(/[<>:"/\|?*~\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_LENGTH)
    .replace(/[. ]+$/, "")
    .replace(/^\.+/, "");
  if (!cleaned) return "video";
  return RESERVED.test(cleaned) ? `_${cleaned}` : cleaned;
}

/** The extension of a plain video file, taken from its URL. */
export function extensionOf(url: string): string {
  let path = "";
  try {
    path = new URL(url).pathname;
  } catch {
    // keep the default
  }
  const extension = /\.([a-z0-9]+)$/i.exec(path)?.[1]?.toLowerCase() ?? "";
  return EXTENSIONS.has(extension) ? extension : "mp4";
}

/** "Title (720p).mp4". The quality is left out when it says nothing. */
export function fileName(title: string, quality: string | null, extension: string): string {
  const suffix = quality && quality !== "source" ? ` (${sanitize(quality)})` : "";
  return `${sanitize(title)}${suffix}.${extension}`;
}
