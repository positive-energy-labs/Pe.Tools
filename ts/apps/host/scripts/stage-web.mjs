// Stages the built web SPA into the host payload (contract with the C# installer:
// static root = <dir of Pe.Host.exe>/web/client). Run via `pnpm --filter @pe/host build:payload`.
import { cpSync, existsSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, "..", "..", "web", "dist", "client");
const dest = join(here, "..", "dist-installed", "web", "client");

if (!existsSync(src)) {
  console.error(`web build not found at ${src} — run \`pnpm --filter @pe/web build\` first`);
  process.exit(1);
}
rmSync(dest, { recursive: true, force: true });
cpSync(src, dest, { recursive: true });
console.log(`staged web SPA -> ${dest}`);

// Page assets (pages-route.ts reads them from <dir of Pe.Host.exe>/pages when installed).
const pages = join(here, "..", "dist-installed", "pages");
rmSync(pages, { recursive: true, force: true });
cpSync(join(here, "..", "src", "pages"), pages, { recursive: true });
cpSync(join(here, "..", "..", "web", "src", "base.css"), join(pages, "base.css"));
for (const name of ["revit.js", "revit.css"])
  cpSync(join(here, "..", "..", "web", "src", "revit", name), join(pages, name));
console.log(`staged page assets -> ${pages}`);

// Shipped Pods (installed-pods.ts imports <dir of Pe.Host.exe>/pods/*.zip on first run). Each
// examples/pods/<folder> is exported by the production exporter, so the zip is exactly what a
// user's own export would carry. An empty capture store: a shipped Pod that names a capture refuses.
// The exporter's module graph resolves host ownership on load; staging is a build step on the source lane.
process.env.PE_LANE ??= "dev";
const { createJiti } = await import("jiti");
const { exportPod } = await createJiti(import.meta.url).import("../src/pod-transfer.ts");
const { CaptureStore } = await createJiti(import.meta.url).import("../src/captures-route.ts");
const { listPackages } = await createJiti(import.meta.url).import("../src/packages.ts");
const examples = join(here, "..", "..", "..", "..", "examples", "pods");
const shipped = join(here, "..", "dist-installed", "pods");
rmSync(shipped, { recursive: true, force: true });
const noCaptures = new CaptureStore(join(shipped, ".no-captures"));
const listing = await listPackages(examples);
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
