/**
 * First-run import of the shipped Pods (`<exeDir>/pods/*.zip`) as ordinary archives. Each sha is
 * offered once (a deleted example stays deleted); an installed id or existing folder is never
 * overwritten. Callers await this before anything reads the pods root.
 */
import { join, dirname } from "node:path";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { writeArtifact } from "./page-artifacts.ts";
import { productPathNames, scriptingWorkspaceIdentity } from "@pe/host-contracts/contracts";
import { hostOwnership, productRoot } from "./host-ownership.ts";
import {
  archiveId,
  installArchive,
  readZip,
  TransferRefused,
  type TransferOptions,
} from "./pod-transfer.ts";
import { listPackages } from "./packages.ts";
import { productPodsRootPath } from "./product-paths.ts";

type ShippedPodOutcome =
  | { archive: string; sha256: string; outcome: "imported"; id: string; folder: string }
  | { archive: string; sha256: string; outcome: "present"; id: string; reason: string }
  | { archive: string; sha256: string; outcome: "offered-before" }
  | { archive: string; sha256: string; outcome: "refused"; reason: string };

export type ShippedPodsReport = { shippedRoot: string | null; outcomes: ShippedPodOutcome[] };

type Ledger = { offered: Record<string, { archive: string; at: string; outcome: string }> };

/** The installed host's shipped pods; the source lane ships none (its examples stay in the checkout). */
const shippedPodsRoot = (): string | null =>
  hostOwnership.lane === "installed" ? join(dirname(process.execPath), "pods") : null;

const ledgerPath = () =>
  join(productRoot(), productPathNames.stateDirectoryName, "shipped-pods.json");

let firstRun: Promise<ShippedPodsReport> | undefined;

/**
 * Import every shipped pod not yet offered. Memoized per process: every caller awaits the same run.
 * Resolves with per-archive outcomes; it rejects only if the ledger itself cannot be written.
 */
export const importShippedPods = (
  options: TransferOptions & { shippedRoot?: string | null; ledger?: string } = {},
): Promise<ShippedPodsReport> => {
  if (options.shippedRoot !== undefined || options.ledger !== undefined) return run(options);
  return (firstRun ??= run(options));
};

/**
 * The default pod: where inline scripts land their runs and traces. A fresh install has none, and
 * an inline probe then fails before it runs ("No unique admitted pod owns output folder", Cody,
 * 2026-10-14). Written once; an existing manifest is never touched.
 */
export async function ensureDefaultPod(podsRoot = productPodsRootPath()): Promise<void> {
  const key = scriptingWorkspaceIdentity.defaultWorkspaceKey;
  const manifest = join(podsRoot, key, "pod.json");
  await mkdir(dirname(manifest), { recursive: true });
  await writeFile(
    manifest,
    `${JSON.stringify({ schemaVersion: 2, id: key, name: key, version: "0.1.0", entrypoints: [] }, null, 2)}
`,
    { flag: "wx" },
  ).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "EEXIST") throw error;
  });
}

async function run(
  options: TransferOptions & { shippedRoot?: string | null; ledger?: string },
): Promise<ShippedPodsReport> {
  await ensureDefaultPod(options.podsRoot);
  const shippedRoot = options.shippedRoot === undefined ? shippedPodsRoot() : options.shippedRoot;
  if (!shippedRoot) return { shippedRoot, outcomes: [] };
  const archives = (await readdir(shippedRoot).catch(() => [] as string[]))
    .filter((name) => /\.zip$/i.test(name))
    .sort();
  if (!archives.length) return { shippedRoot, outcomes: [] };

  const ledgerFile = options.ledger ?? ledgerPath();
  const ledger: Ledger = await readFile(ledgerFile, "utf8").then(
    (text) => JSON.parse(text) as Ledger,
    () => ({ offered: {} }),
  );
  const podsRoot = options.podsRoot ?? productPodsRootPath();
  const outcomes: ShippedPodOutcome[] = [];
  for (const archive of archives) {
    const path = join(shippedRoot, archive);
    const bytes = await readFile(path);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    if (ledger.offered[sha256]) {
      outcomes.push({ archive, sha256, outcome: "offered-before" });
      continue;
    }
    outcomes.push(await offer(archive, path, bytes, sha256, { ...options, podsRoot }));
    ledger.offered[sha256] = {
      archive,
      at: new Date().toISOString(),
      outcome: outcomes.at(-1)!.outcome,
    };
  }
  await writeArtifact(
    dirname(ledgerFile),
    ledgerFile,
    `${JSON.stringify(ledger, null, 2)}\n`,
    true,
  );
  return { shippedRoot, outcomes };
}

async function offer(
  archive: string,
  path: string,
  bytes: Buffer,
  sha256: string,
  options: TransferOptions & { podsRoot: string },
): Promise<ShippedPodOutcome> {
  try {
    const id = archiveId(readZip(bytes));
    const installed = (await listPackages(options.podsRoot)).packages.find((p) => p.id === id);
    if (installed)
      return {
        archive,
        sha256,
        outcome: "present",
        id,
        reason: `installed in folder '${installed.folder}'`,
      };
    const imported = await installArchive(bytes, path, undefined, options);
    return { archive, sha256, outcome: "imported", id: imported.id, folder: imported.folder };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    if (
      error instanceof TransferRefused &&
      error.status === 409 &&
      /folder already exists/.test(reason)
    )
      return { archive, sha256, outcome: "present", id: archiveId(readZip(bytes)), reason };
    return { archive, sha256, outcome: "refused", reason };
  }
}
