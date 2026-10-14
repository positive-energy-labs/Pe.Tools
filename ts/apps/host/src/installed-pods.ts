/**
 * First-run import of the Pods the product ships (`<dir of Pe.Host.exe>/pods/*.zip`, staged by
 * scripts/stage-web.mjs from examples/pods through the production exporter). Ordinary import,
 * nothing special: the shipped Pod lands in Documents/Pe.Tools/Pods like any shared archive.
 *
 * Idempotent and never destructive: an archive whose sha is in the ledger was offered once and is
 * not offered again (a user who deletes the example keeps it deleted); an archive whose id is
 * already installed, or whose folder exists, is recorded as present and never overwritten. The
 * ledger is product state, not Documents. No catalog, HTTP or Revit dependency: callers await this
 * before the catalog, skill publication and harness threads read the pods root.
 */
import { join, dirname } from "node:path";
import { readFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { writeArtifact } from "./page-artifacts.ts";
import { productPathNames } from "@pe/host-contracts/contracts";
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

async function run(
  options: TransferOptions & { shippedRoot?: string | null; ledger?: string },
): Promise<ShippedPodsReport> {
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
