export type Tab = "features" | "userscripts" | "backup";
export const TABS: readonly Tab[] = ["features", "userscripts", "backup"];

export interface Route {
  tab: Tab;
  id: string | null;
}

const FALLBACK: Route = { tab: "features", id: null };

export function parseRoute(hash: string): Route {
  let raw: string;
  try {
    raw = decodeURIComponent(hash.replace(/^#/, ""));
  } catch {
    return FALLBACK;
  }
  const slash = raw.indexOf("/");
  const name = slash === -1 ? raw : raw.slice(0, slash);
  const id = slash === -1 ? "" : raw.slice(slash + 1);
  if (name === "") return FALLBACK;
  if (!(TABS as readonly string[]).includes(name)) return FALLBACK;
  return { tab: name as Tab, id: id || null };
}

export function routeHash(route: Route): string {
  return `#${route.tab}${route.id ? `/${route.id}` : ""}`;
}
