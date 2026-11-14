// Stages the built web SPA into the host payload (contract with the C# installer:
// static root = <dir of Pe.Host.exe>/web/client). Run via `pnpm --filter @pe/host build:payload`.
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { splitWebMaps } from "./web-maps.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, "..", "..", "web", "dist", "client");
const dest = join(here, "..", "dist-installed", "web", "client");

if (!existsSync(src)) {
  console.error(`web build not found at ${src} — run \`pnpm --filter @pe/web build\` first`);
  process.exit(1);
}
// Maps stay private: outside dist-installed (the installer payload), keyed by chunk debug id.
const maps = join(here, "..", "dist", "web-maps");
const split = splitWebMaps(src, dest, maps);
console.log(`staged web SPA -> ${dest}; ${split.length} private maps -> ${maps}`);

// Page assets (pages-route.ts reads them from <dir of Pe.Host.exe>/pages when installed).
const pages = join(here, "..", "dist-installed", "pages");
rmSync(pages, { recursive: true, force: true });
const { createJiti } = await import("jiti");
const { PAGE_LIBRARY_SOURCES } = await createJiti(import.meta.url).import<
  typeof import("../src/page-library-sources.ts")
>("../src/page-library-sources.ts");
for (const [name, source] of Object.entries(PAGE_LIBRARY_SOURCES)) {
  const from = fileURLToPath(new URL(source, new URL("../src/page-library-sources.ts", import.meta.url)));
  const to = join(pages, name);
  mkdirSync(dirname(to), { recursive: true });
  cpSync(from, to);
}
console.log(`staged page assets -> ${pages}`);

// Shipped Pods (installed-pods.ts imports <dir of Pe.Host.exe>/pods/*.zip on first run). Each
// examples/pods/<folder> is exported by the production exporter, so the zip is exactly what a
// user's own export would carry. An empty capture store: a shipped Pod that names a capture refuses.
// The exporter's module graph resolves host ownership on load; staging is a build step on the source lane.
process.env.PE_LANE ??= "dev";
const { exportPod } = await createJiti(import.meta.url).import<
  typeof import("../src/pod-transfer.ts")
>("../src/pod-transfer.ts");
const { PictureCaptures } = await createJiti(import.meta.url).import<
  typeof import("../src/captures-route.ts")
>("../src/captures-route.ts");
const { listPackages } = await createJiti(import.meta.url).import<
  typeof import("../src/packages.ts")
>("../src/packages.ts");
const { stateTree } = await createJiti(import.meta.url).import<
  typeof import("@pe/host-contracts/service-identity")
>("@pe/host-contracts/service-identity");
const examples = join(here, "..", "..", "..", "..", "examples", "pods");
const shipped = join(here, "..", "dist-installed", "pods");
rmSync(shipped, { recursive: true, force: true });
const noCaptures = new PictureCaptures(
  stateTree(join(shipped, ".no-captures")).directory("captures"),
  0,
  () => 0,
);
const listing = await listPackages({ podsRoots: examples });
if (listing.unreadable.length) {
  console.error(`unreadable example pods: ${JSON.stringify(listing.unreadable)}`);
  process.exit(1);
}
for (const pod of listing.packages) {
  const result = await exportPod(
    { pod: pod.id, archivePath: join(shipped, `${pod.id}.zip`) },
    { podsRoot: examples, captures: noCaptures },
  );
  console.log(`staged pod ${result.id} -> ${result.archivePath} (sha256 ${result.archiveSha256})`);
}
