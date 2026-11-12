/**
 * First-run import of shipped Pods (installed archives or exported checkout examples). Each sha is
 * offered once (a deleted example stays deleted); an installed id or existing folder is never
 * overwritten. Callers await this before anything reads the pods root.
 */
import { join, dirname, resolve } from "node:path";
import { mkdir, readFile, readdir, writeFile, rename } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { readStored, writeAtomic } from "@pe/host-contracts/store";
import { storedNoticesPath } from "./notice-feed.ts";
import { writeArtifact } from "./page-artifacts.ts";
import { productPathNames, scriptingWorkspaceIdentity } from "@pe/host-contracts/contracts";
import { hostOwnership } from "./host-ownership.ts";
import {
  archiveId,
  preparePodExport,
  writePodExport,
  importRecordPath,
  installArchive,
  readZip,
  TransferRefused,
  type TransferOptions,
} from "./pod-transfer.ts";
import { captureDirectory, isPackageMember, listPackages, productPodsRoots, type AdmittedPackage } from "./packages.ts";
import { shippedPodUpdateRefusals } from "./shipped-pod-status.ts";
import { activateImportedPackage } from "./package-lifecycle.ts";
import { productPodsRootPath } from "./product-paths.ts";

type ShippedPodOutcome =
  | { archive: string; sha256: string; outcome: "imported"; id: string; folder: string }
  | { archive: string; sha256: string; outcome: "updated"; id: string; folder: string }
  | { archive: string; sha256: string; outcome: "present"; id: string; reason: string }
  | { archive: string; sha256: string; outcome: "offered-before" }
  | { archive: string; sha256: string; outcome: "refused"; reason: string };

export type ShippedPodsReport = { shippedRoot: string | null; outcomes: ShippedPodOutcome[] };

const ledgerSchema = z.object({
  offered: z.record(z.string(), z.object({ archive: z.string(), at: z.string(), outcome: z.string() })),
});

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
 * Resolves when a run has settled or `waitMs` has passed, whichever is first. It never rejects: a
 * failed import is reported by its own caller, and a reader only needs it over.
 */
export const settledWithin = (run: Promise<unknown> | undefined, waitMs: number): Promise<void> => {
  if (!run) return Promise.resolve();
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    run.then(
      () => {},
      () => {},
    ),
    new Promise<void>((done) => {
      timer = setTimeout(done, waitMs);
      timer.unref();
    }),
  ]).finally(() => clearTimeout(timer));
};

/**
 * Resolves when this process's shipped-pod import has finished, at once when none has started.
 * Bounded: an import that hangs must not hang every pod listing, so after the bound a reader lists
 * what is there. A fresh dev home takes about 15 s to export and import the checkout's examples.
 */
export const shippedPodsSettled = (): Promise<void> => settledWithin(firstRun, 60_000);

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
async function ensureDefaultPod(podsRoot: string | undefined): Promise<void> {
  const key = scriptingWorkspaceIdentity.defaultWorkspaceKey;
  // Another home may already hold the default pod; a second one would refuse both.
  if ((await listPackages(podsRoot ?? productPodsRoots())).packages.some((pod) => pod.id === key))
    return;
  podsRoot ??= productPodsRootPath();
  const manifest = join(podsRoot, key, "pod.json");
  await mkdir(dirname(manifest), { recursive: true });
  await writeFile(
    manifest,
    `${JSON.stringify({ schemaVersion: 2, id: key, name: key, version: "0.1.0", entrypoints: [] }, null, 2)}
`,
    { flag: "wx" },
  ).then(
    // The host made this pod at this start, so it is on, like an import: a pod first seen after
    // the start census is otherwise off, and `pod.list` would never name it. An existing manifest
    // keeps whatever a person chose.
    () => activateImportedPackage(key, podsRoot!),
    (error: NodeJS.ErrnoException) => {
      if (error.code !== "EEXIST") throw error;
    },
  );
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
  // Machine state (ADR 0039): a ledger that does not decode is discarded with a notice, and every
  // shipped Pod is offered once more.
  const read = readStored(ledgerFile, ledgerSchema, {
    class: "discard",
    place: "Shipped Pods ledger",
    notices: storedNoticesPath(),
  });
  const ledger = read.kind === "ok" ? read.value : { offered: {} };
  // An id is unique across homes (ADR 0037 rule 4): the offer looks in every home, and
  // `installArchive` places a new pod in the user home.
  const everyRoot = options.podsRoot ?? productPodsRoots();
  const outcomes: ShippedPodOutcome[] = [];
  for (const archive of archives) {
    const path = join(shippedRoot, archive);
    const bytes = await readFile(path);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const installed = (await listPackages(everyRoot)).packages.find(pod => pod.id === archiveId(readZip(bytes)));
    if (ledger.offered[sha256] && !installed) {
      outcomes.push({ archive, sha256, outcome: "offered-before" });
      continue;
    }
    const outcome = await offer(archive, path, bytes, sha256, {
      ...options, stateRoot: options.stateRoot ?? dirname(ledgerFile),
      originalsRoot: join(dirname(ledgerFile), "shipped-pod-originals"),
    }, installed);
    outcomes.push(ledger.offered[sha256] && outcome.outcome === "present" && !shippedPodUpdateRefusals.has(installed!.id)
      ? { archive, sha256, outcome: "offered-before" } : outcome);
    ledger.offered[sha256] = {
      archive,
      at: new Date().toISOString(),
      outcome: outcomes.at(-1)!.outcome,
    };
  }
  writeAtomic(ledgerFile, `${JSON.stringify(ledger, null, 2)}\n`);
  return { shippedRoot, outcomes };
}

async function offer(
  archive: string,
  path: string,
  bytes: Buffer,
  sha256: string,
  options: TransferOptions & { originalsRoot: string },
  installed?: AdmittedPackage,
): Promise<ShippedPodOutcome> {
  try {
    const id = archiveId(readZip(bytes));
    // Installed archives may be replaced on upgrade. Retain every offered version in writable state.
    await mkdir(options.originalsRoot, { recursive: true });
    await writeArtifact(options.originalsRoot, join(options.originalsRoot, `${sha256}.zip`), bytes);
    if (installed) {
      // A pod another home holds is that home's to change: the offer never replaces or moves it.
      if (resolve(dirname(installed.directory)) !== resolve(options.podsRoot ?? productPodsRootPath()))
        return { archive, sha256, outcome: "present", id, reason: `installed at '${installed.directory}'` };
      shippedPodUpdateRefusals.delete(id);
      const matches = (entries: ReadonlyMap<string, Buffer>, pod: AdmittedPackage) => {
        const authored = [...entries].filter(([path]) => isPackageMember(path));
        return authored.length === pod.members.length && authored.every(([path, bytes]) =>
          pod.members.some(member => member.path === path && Buffer.from(member.bytes).equals(bytes)));
      };
      if (!matches(readZip(bytes), installed)) {
        try {
          // Derived machine state (ADR 0039): a record that does not decode is discarded with a notice.
          const record = readStored(
            importRecordPath(id, options),
            z.object({ archiveSha256: z.string().regex(/^[a-f0-9]{64}$/) }),
            { class: "discard", place: `Import record for ${id}`, notices: storedNoticesPath() },
          );
          if (record.kind === "missing") throw Error("no import record");
          if (record.kind !== "ok") throw Error("its original import record is incomplete");
          const provenance = record.value;
          // The record holds no machine path: the original is found by its hash in this machine's store.
          const original = await readFile(join(options.originalsRoot, `${provenance.archiveSha256}.zip`))
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
            if (await readFile(join(installed.directory, "pod.json")).then(() => true, () => false))
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
