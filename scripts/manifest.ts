import type { Feature } from "../src/core/feature.ts";

export interface Manifest {
  version?: string;
  permissions?: string[];
  host_permissions?: string[];
  [key: string]: unknown;
}

const union = (lists: (readonly string[] | undefined)[]): string[] => [...new Set(lists.flatMap((list) => list ?? []))].sort();

/** The hand-written manifest plus exactly what the features ask for. */
export function buildManifest(base: Manifest, features: readonly Feature[], version: string): Manifest {
  const hosts = union([base.host_permissions, ...features.map((feature) => feature.matches)]);
  return {
    ...base,
    version,
    permissions: union([base.permissions, ...features.map((feature) => feature.permissions)]),
    host_permissions: hosts.includes("<all_urls>") ? ["<all_urls>"] : hosts,
  };
}
