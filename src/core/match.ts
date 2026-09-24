// Chrome match patterns, for the popup, which has to know which features apply
// to the current tab. Grammar: https://developer.chrome.com/docs/extensions/develop/concepts/match-patterns
// The registrar never uses this module; Chrome does its own matching.

export type UrlTest = (url: URL) => boolean;

const ALL_URLS_SCHEMES = new Set(["http:", "https:", "ws:", "wss:", "ftp:", "file:"]);
const PATTERN = /^(\*|https?|wss?|ftp|file):\/\/([^/]*)(\/.*)$/;
const DEFAULT_PORTS: Record<string, string> = { "http:": "80", "https:": "443", "ws:": "80", "wss:": "443", "ftp:": "21" };

function globToRegExp(glob: string): RegExp {
  const source = glob
    .split("*")
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${source}$`, "s");
}

export function compilePattern(pattern: string): UrlTest | null {
  if (pattern === "<all_urls>") return (url) => ALL_URLS_SCHEMES.has(url.protocol);

  const parts = PATTERN.exec(pattern);
  if (!parts) return null;
  const [, scheme, authority, path] = parts;
  const protocols = scheme === "*" ? ["http:", "https:"] : [`${scheme}:`];

  let host = authority.toLowerCase();
  let port: string | null = null;
  const withPort = /^(.*):(\*|\d+)$/.exec(host);
  if (withPort) {
    host = withPort[1];
    port = withPort[2];
  }

  if (scheme === "file") {
    if (host !== "") return null;
  } else {
    if (host === "") return null;
    const wildcardOk = host === "*" || !host.includes("*") || (host.startsWith("*.") && !host.slice(2).includes("*"));
    if (!wildcardOk) return null;
  }

  const pathTest = globToRegExp(path);

  return (url) => {
    if (!protocols.includes(url.protocol)) return false;
    if (scheme !== "file") {
      const actual = url.hostname.toLowerCase();
      if (host.startsWith("*.")) {
        const base = host.slice(2);
        if (actual !== base && !actual.endsWith(`.${base}`)) return false;
      } else if (host !== "*" && actual !== host) {
        return false;
      }
      if (port !== null && port !== "*" && (url.port || DEFAULT_PORTS[url.protocol]) !== port) return false;
    }
    return pathTest.test(url.pathname + url.search);
  };
}

export function matchesPattern(pattern: string, url: string): boolean {
  const test = compilePattern(pattern);
  if (!test) return false;
  try {
    return test(new URL(url));
  } catch {
    return false;
  }
}

export function urlMatches(matches: readonly string[], excludeMatches: readonly string[], url: string): boolean {
  return matches.some((p) => matchesPattern(p, url)) && !excludeMatches.some((p) => matchesPattern(p, url));
}

/** The hostname of an http(s) page, or null for anything Sakti can't be switched off on. */
export function hostOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return parsed.hostname.toLowerCase() || null;
  } catch {
    return null;
  }
}

/** The pattern that switches a feature off for one host. */
export function hostPattern(host: string): string {
  return `*://${host}/*`;
}
