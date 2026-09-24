// Builds the extension into dist/.
//   node scripts/build.ts                 development build (inline source maps)
//   node scripts/build.ts --watch         rebuild on every change under src/, features/, icons/
//   node scripts/build.ts --release --zip no source maps, and write releases/sakti-<version>.zip

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build, type Plugin } from "esbuild";
import type { Feature, RegistryEntry } from "../src/core/feature.ts";
import { buildManifest, type Manifest } from "./manifest.ts";
import { toRegistryEntry, validateFeature } from "./validate.ts";
import { buildZip } from "./zip.ts";

const ROOT = path.resolve(import.meta.dirname, "..");
const DIST = path.join(ROOT, "dist");
const FEATURES = path.join(ROOT, "features");
const args = new Set(process.argv.slice(2));
const release = args.has("--release");

interface LoadedFeature {
  feature: Feature;
  dir: string;
}

async function loadFeatures(): Promise<LoadedFeature[]> {
  const loaded: LoadedFeature[] = [];
  const errors: string[] = [];
  const folders = fs
    .readdirSync(FEATURES, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  for (const folder of folders) {
    const dir = path.join(FEATURES, folder);
    const file = path.join(dir, "feature.ts");
    if (!fs.existsSync(file)) {
      errors.push(`features/${folder}: missing feature.ts`);
      continue;
    }
    // The query string defeats Node's module cache so --watch sees edits.
    const module = (await import(`${pathToFileURL(file).href}?t=${Date.now()}`)) as { default?: unknown };
    const problems = validateFeature(module.default, folder, (relative) => fs.existsSync(path.join(dir, relative)));
    if (problems.length) errors.push(...problems);
    else loaded.push({ feature: module.default as Feature, dir });
  }

  if (errors.length) throw new Error(`Invalid features:\n  ${errors.join("\n  ")}`);
  return loaded;
}

/** Resolves `import registry from "sakti:registry"` to the generated registry. */
function registryPlugin(registry: RegistryEntry[]): Plugin {
  return {
    name: "sakti-registry",
    setup(builder) {
      builder.onResolve({ filter: /^sakti:registry$/ }, () => ({ path: "registry", namespace: "sakti" }));
      builder.onLoad({ filter: /.*/, namespace: "sakti" }, () => ({ contents: JSON.stringify(registry), loader: "json" }));
    },
  };
}

async function buildOnce(): Promise<void> {
  const started = Date.now();
  const features = await loadFeatures();
  const registry = features.map(({ feature }) => toRegistryEntry(feature));

  fs.rmSync(DIST, { recursive: true, force: true });
  fs.mkdirSync(DIST, { recursive: true });

  const entryPoints = [
    { in: "src/worker/index.ts", out: "worker" },
    { in: "src/ui/popup/popup.ts", out: "popup" },
    { in: "src/ui/options/options.ts", out: "options" },
  ];
  for (const { feature, dir } of features) {
    if (feature.scripts.content) entryPoints.push({ in: path.join(dir, feature.scripts.content), out: `features/${feature.id}/content` });
    if (feature.scripts.main) entryPoints.push({ in: path.join(dir, feature.scripts.main), out: `features/${feature.id}/main` });
  }

  await build({
    absWorkingDir: ROOT,
    entryPoints,
    outdir: DIST,
    bundle: true,
    format: "iife",
    target: "chrome120",
    charset: "utf8",
    sourcemap: release ? false : "inline",
    logLevel: "warning",
    plugins: [registryPlugin(registry)],
  });

  for (const { feature, dir } of features) {
    if (!feature.scripts.css) continue;
    const out = path.join(DIST, "features", feature.id, "content.css");
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.copyFileSync(path.join(dir, feature.scripts.css), out);
  }

  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")) as { version: string };
  const base = JSON.parse(fs.readFileSync(path.join(ROOT, "manifest.json"), "utf8")) as Manifest;
  const manifest = buildManifest(base, features.map(({ feature }) => feature), pkg.version);
  fs.writeFileSync(path.join(DIST, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  fs.writeFileSync(path.join(DIST, "registry.json"), `${JSON.stringify(registry, null, 2)}\n`);
  fs.copyFileSync(path.join(ROOT, "src/ui/popup/popup.html"), path.join(DIST, "popup.html"));
  fs.copyFileSync(path.join(ROOT, "src/ui/options/options.html"), path.join(DIST, "options.html"));
  fs.cpSync(path.join(ROOT, "icons"), path.join(DIST, "icons"), { recursive: true });
  fs.copyFileSync(path.join(ROOT, "LICENSE.md"), path.join(DIST, "LICENSE.md"));

  const reserved = fs.readdirSync(DIST).filter((name) => name.startsWith("_"));
  if (reserved.length) throw new Error(`Chrome refuses files starting with "_" at the extension root: ${reserved.join(", ")}`);

  console.log(`Built Sakti ${pkg.version} with ${features.length} features -> dist (${Date.now() - started} ms)`);

  if (args.has("--zip")) {
    const zipPath = path.join(ROOT, "releases", `sakti-${pkg.version}.zip`);
    fs.mkdirSync(path.dirname(zipPath), { recursive: true });
    fs.writeFileSync(zipPath, buildZip(DIST));
    console.log(`Zipped -> releases/${path.basename(zipPath)}`);
  }
}

async function main(): Promise<void> {
  if (!args.has("--watch")) {
    await buildOnce();
    return;
  }
  const run = () => buildOnce().catch((error: unknown) => console.error(error instanceof Error ? error.message : error));
  await run();
  let timer: ReturnType<typeof setTimeout> | undefined;
  for (const dir of ["src", "features", "icons"]) {
    fs.watch(path.join(ROOT, dir), { recursive: true }, () => {
      clearTimeout(timer);
      timer = setTimeout(run, 150);
    });
  }
  console.log("Watching src/, features/ and icons/ ...");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
