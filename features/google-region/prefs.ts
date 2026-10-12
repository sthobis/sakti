// Google saves Search settings through a signed link, /setprefs?sig=<token>,
// that it prints into its settings page. These helpers find that link and aim
// it at a results region. They are pure so that Node can test them.

const SETPREFS_ATTR = /data-spbu="([^"]+)"/;

/** The signed setprefs link in the settings page's HTML, or null if there is none. */
export function findSetprefsUrl(html: string): string | null {
  const match = SETPREFS_ATTR.exec(html);
  if (!match) return null;
  const link = match[1]!.replaceAll("&amp;", "&");
  let url: URL;
  try {
    url = new URL(link);
  } catch {
    return null;
  }
  const signed = url.origin === "https://www.google.com" && url.pathname === "/setprefs" && url.searchParams.has("sig");
  return signed ? link : null;
}

/**
 * The request the settings page sends when a results region is picked. The
 * region is appended as text, because rebuilding the query would re-encode
 * the signature.
 */
export function regionUrl(setprefsUrl: string, region: string): string {
  return `${setprefsUrl}&gl=${encodeURIComponent(region)}&noredirect=1`;
}
