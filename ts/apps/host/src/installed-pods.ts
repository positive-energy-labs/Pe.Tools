/**
 * First-run import of shipped Pods (installed archives or exported checkout examples). Each sha is
 * offered once (a deleted example stays deleted); an installed id or existing folder is never
 * overwritten. Callers await this before anything reads the pods root.
 */
import { join, dirname } from "node:path";
import { mkdir, readFile, readdir, writeFile, rename } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { writeArtifact } from "./page-artifacts.ts";
import { productPathNames, scriptingWorkspaceIdentity } from "@pe/host-contracts/contracts";
import { hostOwnership } from "./host-ownership.ts";
import {
  archiveId,
  preparePodExport,
  writePodExport,
  installArchive,
  readZip,
  TransferRefused,
  type TransferOptions,
} from "./pod-transfer.ts";
import { captureDirectory, isPackageMember, listPackages, type AdmittedPackage } from "./packages.ts";
import { shippedPodUpdateRefusals } from "./shipped-pod-status.ts";
import { productPodsRootPath } from "./product-paths.ts";

type ShippedPodOutcome =
  | { archive: string; sha256: string; outcome: "imported"; id: string; folder: string }
  | { archive: string; sha256: string; outcome: "updated"; id: string; folder: string }
  | { archive: string; sha256: string; outcome: "present"; id: string; reason: string }
  | { archive: string; sha256: string; outcome: "offered-before" }
  | { archive: string; sha256: string; outcome: "refused"; reason: string };

export type ShippedPodsReport = { shippedRoot: string | null; outcomes: ShippedPodOutcome[] };

type Ledger = { offered: Record<string, { archive: string; at: string; outcome: string }> };

/** Dev offers the checkout's examples through the same archive importer; trust stays explicit. */
async function shippedPodsRoot(options: TransferOptions & { ledger?: string }): Promise<string> {
  if (hostOwnership.lane === "installed") return join(dirname(process.execPath), "pods");
  const examples = join(hostOwnership.sourceRoot!, "examples", "pods");
  const listing = await listPackages(examples);
  if (listing.unreadable.length)
    throw Error(`Unreadable shipped Pods: ${listing.unreadable.map((pod) => pod.message).join("; ")}`);
  // The complete admitted input snapshot includes vendored dependencies. Content-addressed
  // archives are shared safely across hosts, and unchanged examples need no export or rewrite.
  const fingerprint = createHash("sha256").update(JSON.stringify(listing.packages.map(pod =>
    [pod.id, pod.members.map(member => [member.path, member.sha256])]))).digest("hex");
  const shipped = join(dirname(options.ledger ?? ledgerPath()), "shipped-pods", fingerprint);
  for (const pod of listing.packages) {
    const archivePath = join(shipped, `${pod.id}.zip`);
    await writePodExport(await preparePodExport(
      { pod: pod.id, archivePath },
      { podsRoot: examples, captures: options.captures }, listing,
    ));
  }
  return shipped;
}

const ledgerPath = () =>
  join(hostOwnership.rootPath, productPathNames.stateDirectoryName, "shipped-pods.json");

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
async function ensureDefaultPod(podsRoot = productPodsRootPath()): Promise<void> {
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
  const shippedRoot = options.shippedRoot === undefined ? await shippedPodsRoot(options) : options.shippedRoot;
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
    const installed = (await listPackages(podsRoot)).packages.find(pod => pod.id === archiveId(readZip(bytes)));
    if (ledger.offered[sha256] && !installed) {
      outcomes.push({ archive, sha256, outcome: "offered-before" });
      continue;
    }
    const outcome = await offer(archive, path, bytes, sha256, {
      ...options, podsRoot, originalsRoot: join(dirname(ledgerFile), "shipped-pod-originals"),
    }, installed);
    outcomes.push(ledger.offered[sha256] && outcome.outcome === "present" && !shippedPodUpdateRefusals.has(installed!.id)
      ? { archive, sha256, outcome: "offered-before" } : outcome);
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
  options: TransferOptions & { podsRoot: string; originalsRoot: string },
  installed?: AdmittedPackage,
): Promise<ShippedPodOutcome> {
  try {
    const id = archiveId(readZip(bytes));
    // Installed archives may be replaced on upgrade. Retain every offered version in writable state.
    await mkdir(options.originalsRoot, { recursive: true });
    await writeArtifact(options.originalsRoot, join(options.originalsRoot, `${sha256}.zip`), bytes);
    if (installed) {
      shippedPodUpdateRefusals.delete(id);
      const matches = (entries: ReadonlyMap<string, Buffer>, pod: AdmittedPackage) => {
        const authored = [...entries].filter(([path]) => isPackageMember(path));
        return authored.length === pod.members.length && authored.every(([path, bytes]) =>
          pod.members.some(member => member.path === path && Buffer.from(member.bytes).equals(bytes)));
      };
      if (!matches(readZip(bytes), installed)) {
        try {
          const provenance = JSON.parse(await readFile(join(installed.directory, "imported.json"), "utf8"));
          if (typeof provenance.locator !== "string" || !/^[a-f0-9]{64}$/.test(provenance.archiveSha256))
            throw Error("its original import record is incomplete");
          const original = await readFile(join(options.originalsRoot, `${provenance.archiveSha256}.zip`))
            .catch(() => readFile(provenance.locator))
            .catch(() => { throw Error("its original archive is unavailable"); });
          if (createHash("sha256").update(original).digest("hex") !== provenance.archiveSha256)
            throw Error("its original archive no longer matches the import record");
          if (archiveId(readZip(original)) !== id || !matches(readZip(original), installed))
            throw Error("its authored members differ from the original archive");
          const retained = join(options.originalsRoot, `${provenance.archiveSha256}.zip`);
          await mkdir(dirname(retained), { recursive: true });
          await writeArtifact(options.originalsRoot, retained, original);
          // Preserve the full old folder too: runtime outputs and other local files are not authored members.
          const backup = join(dirname(options.originalsRoot), "shipped-pod-backups", `${id}-${randomUUID()}`);
          await mkdir(dirname(backup), { recursive: true });
          const fresh = await captureDirectory(installed.directory);
          if (fresh.diagnostics.length || !matches(readZip(original), { ...installed, members: fresh.members }))
            throw Error("its members changed during the update check");
          await rename(installed.directory, backup);
          try {
            const imported = await installArchive(bytes, path, installed.folder, options);
            return { archive, sha256, outcome: "updated", id, folder: imported.folder };
          } catch (error) {
            // A post-rename activation failure must preserve both folders before restoring custody.
            if (await readFile(join(installed.directory, "imported.json")).then(() => true, () => false))
              await rename(installed.directory, `${backup}-failed-update`);
            await rename(backup, installed.directory);
            throw Error("the replacement could not be activated; the original folder was restored", { cause: error });
          }
        } catch (error) {
          console.error("Shipped example update kept", { id, error });
          const reason = error instanceof Error && /^(its |the replacement )/.test(error.message)
            ? error.message : "its provenance could not be verified";
          shippedPodUpdateRefusals.set(id, `Example update kept ${installed.name}: ${reason}. Restore the original import or import the current example into a separate workspace.`);
        }
      }
      return {
        archive,
        sha256,
        outcome: "present",
        id,
        reason: `installed in folder '${installed.folder}'`,
      };
    }
    const imported = await installArchive(bytes, path, undefined, options);
    return { archive, sha256, outcome: "imported", id: imported.id, folder: imported.folder };
  } catch (error) {
    const reason =
      error instanceof Error || error instanceof TransferRefused ? error.message : String(error);
    if (
      error instanceof TransferRefused &&
      error.status === 409 &&
      /folder already exists/.test(reason)
    )
      return { archive, sha256, outcome: "present", id: archiveId(readZip(bytes)), reason };
    return { archive, sha256, outcome: "refused", reason };
  }
}
