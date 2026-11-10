import { defineConfig } from "vite-plus";
import { browserGuardianPlugin } from "@pe/browser/build";
import { dirname, join } from "node:path";
import { receiptBuildDefines } from "./src/build-stamp.ts";
import { prepareSourceClosures } from "./src/source-closures.ts";
import { mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  currentRouteStartupProjection,
  routeStartupOwner,
  routeStartupSourceHash,
  type RouteStartupProjection,
} from "@pe/host-contracts/route-startup";

const checkout = fileURLToPath(new URL("../../../", import.meta.url));
const webSource = fileURLToPath(new URL("../web/src/", import.meta.url));
const stampPath = join(import.meta.dirname, "node_modules", ".cache", "source-closures.json");
const diskClosures = () =>
  Object.fromEntries(
    readdirSync(webSource, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .flatMap((d) => {
        const path = join(webSource, d.name, "source-closure.generated.json");
        try {
          return [[path, readFileSync(path, "utf8")] as const];
        } catch {
          return [];
        }
      }),
  );
/** Test lane only (Vitest sets VITEST before it loads this file). The closure producer
 * (route-graphs.ts --builtin-closure-only) took ~45 s of every host test run before Vitest started.
 * Skip it while the disk closures are exactly the ones a stamp recorded and
 * `currentRouteStartupProjection` (the dev host's source-hash + closure-member check) still passes;
 * otherwise produce and stamp. Pack and source startup always produce. */
async function prepareTestSourceClosures() {
  try {
    const stamp = JSON.parse(readFileSync(stampPath, "utf8")) as RouteStartupProjection;
    const disk = diskClosures();
    if (
      JSON.stringify(Object.keys(disk).sort()) ===
        JSON.stringify(Object.keys(stamp.projections).sort()) &&
      Object.entries(stamp.projections).every(([path, text]) => disk[path] === text) &&
      currentRouteStartupProjection(checkout, stamp)
    )
      return;
  } catch {
    // No or malformed stamp: produce.
  }
  const before = routeStartupSourceHash(checkout);
  await prepareSourceClosures();
  // The producer also rewrites tracked generated sources; stamp only a run that found them current.
  const sourceHash = routeStartupSourceHash(checkout);
  if (sourceHash !== before) return;
  const stamp: RouteStartupProjection = {
    checkout: routeStartupOwner(checkout),
    sourceHash,
    projections: diskClosures(),
  };
  mkdirSync(dirname(stampPath), { recursive: true });
  writeFileSync(`${stampPath}.${process.pid}`, JSON.stringify(stamp));
  renameSync(`${stampPath}.${process.pid}`, stampPath);
}

await (process.env.VITEST === "true" ? prepareTestSourceClosures() : prepareSourceClosures());

const browserTestFiles = ["tests/**/*.browser.test.{ts,tsx}"];

// Pack and tests consume the same ignored producer output as source startup.
export default defineConfig(({ mode }) => ({
  pack: {
    entry: ["src/index.ts"],
    outDir: "dist-installed/bundle",
    clean: ["dist-installed"],
    shims: true,
    define: receiptBuildDefines("release"),
    plugins: [
      browserGuardianPlugin(join(import.meta.dirname, "dist-installed")),
      {
        name: "preserve-node-socket-context",
        transform: {
          filter: { id: /@effect\/platform-node-shared\/dist\/NodeSocket\.js$/ },
          // Rolldown drops Context while retaining the unused NetSocket superclass call.
          handler: () => ({ moduleSideEffects: "no-treeshake" }),
        },
      },
    ],
    deps: {
      alwaysBundle: [/./],
      onlyBundle: false,
    },
    loader: {
      ".wasm": "base64",
      ".scm": "text",
    },
    exe: {
      fileName: "Pe.Host",
      outDir: "dist-installed",
    },
  },
  lint: {
    options: {
      typeAware: true,
      typeCheck: true,
    },
  },
  fmt: {},
  // Unit tests import the host module graph directly (not via the source entry points), so
  // ensure-source-lane.ts does not run — declare the dev lane here so resolveHostLane's PE_LANE
  // fail-fast (IPC-SEAM-SPEC D7) sees a valid signal instead of throwing at module load.
  // Host boundary scenarios claim the same source service identity; parallel files would make
  // one test take over another test's server instead of testing either lifecycle.
  // Real processes and files on Windows: the 5 s default fails honest tests under load. Heavy ones
  // carry their own 30 s.
  test: {
    include: mode === "browser" ? browserTestFiles : ["tests/**/*.test.{ts,tsx}"],
    // Browser fixtures require BUDGET BROWSER_FIXTURE_START_GIB (8 GiB); one browser at a time.
    exclude: mode === "browser" ? [] : browserTestFiles,
    env: { PE_LANE: "dev" },
    fileParallelism: false,
    testTimeout: 15_000,
    // expect.poll waits 1 s by default; real HTTP and child processes need more when the box is busy.
    expect: { poll: { timeout: 10_000 } },
    globalSetup: ["../../tests/isolated-home/global-setup.ts"],
    setupFiles: ["../../tests/isolated-home/setup.ts"],
  },
}));
