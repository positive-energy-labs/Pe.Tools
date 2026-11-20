/**
 * First-run import of shipped Pods (installed archives or exported checkout examples). Each sha is
 * offered once (a deleted example stays deleted); an installed id or existing folder is never
 * overwritten. Callers await this before anything reads the pods root.
 */
import { basename, join, dirname, resolve } from "node:path";
import { lstat, mkdir, readFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { z } from "zod";
import {
  note,
  read as readStoredFile,
  writeHome,
  writeState,
  stateKind,
  type StateDirectory,
} from "@pe/host-contracts/kinds";
import { sha256Hex, validatePageHtml, writeArtifact } from "./page-artifacts.ts";
import { scriptingWorkspaceIdentity } from "@pe/host-contracts/contracts";
import { stateDirectory, stateTree, stateSegments } from "@pe/host-contracts/service-identity";
import { hostOwnership, hostState } from "./host-ownership.ts";
import {
  archiveId,
  preparePodExport,
  writePodExport,
  importRecordFile,
  installArchive,
  readZip,
  TransferRefused,
  type TransferOptions,
} from "./pod-transfer.ts";
import {
  captureDirectory,
  isPackageMember,
  listPackages,
  productPodsRoots,
  type AdmittedPackage,
} from "./packages.ts";
import { shippedPodUpdateRefusals } from "./shipped-pod-status.ts";
import { activateImportedPackage, reconcilePackageChanges } from "./package-lifecycle.ts";
import { productPodsRootPath } from "./product-paths.ts";
import { rollbackHomeMembers, podMemberKind, type HomeMemberUndo } from "./settings.ts";

type ShippedPodOutcome =
  | { archive: string; sha256: string; outcome: "imported"; id: string; folder: string }
  | { archive: string; sha256: string; outcome: "updated"; id: string; folder: string }
  | { archive: string; sha256: string; outcome: "present"; id: string; reason: string }
  | { archive: string; sha256: string; outcome: "offered-before" }
  | { archive: string; sha256: string; outcome: "refused"; reason: string };

export type ShippedPodsReport = { shippedRoot: string | null; outcomes: ShippedPodOutcome[] };

const originalArchiveKind = stateKind({
  schema: z.unknown(),
  place: (_sha: string) => "Shipped Pod original",
  segments: (sha: string) => [`${sha}.zip`],
});
const shippedArchiveKind = stateKind({
  schema: z.unknown(),
  place: (_fingerprint: string, _id: string) => "Shipped Pod archive",
  segments: (fingerprint: string, id: string) => [
    ...stateSegments("shippedPods"),
    fingerprint,
    `${id}.zip`,
  ],
});

const ledgerSchema = z.object({
  offered: z.record(
    z.string(),
    z.object({ archive: z.string(), at: z.string(), outcome: z.string() }),
  ),
});

/** Dev offers the checkout's examples through the same archive importer; trust stays explicit. */
async function shippedPodsRoot(
  options: TransferOptions & { ledger?: ReturnType<typeof ledgerKind.in> },
): Promise<string> {
  if (hostOwnership.lane === "installed") return join(dirname(process.execPath), "pods");
  const examples = join(hostOwnership.sourceRoot!, "examples", "pods");
  await readdir(examples);
  const listing = await listPackages({ podsRoots: examples });
  options.signal?.throwIfAborted();
  if (listing.unreadable.length)
    throw Error(
      `Unreadable shipped Pods: ${listing.unreadable.map((pod) => pod.message).join("; ")}`,
    );
  // The complete admitted input snapshot includes vendored dependencies. Content-addressed
  // archives are shared safely across hosts, and unchanged examples need no export or rewrite.
  const fingerprint = createHash("sha256")
    .update(
      JSON.stringify(
        listing.packages.map((pod) => [
          pod.id,
          pod.members.map((member) => [member.path, member.sha256]),
        ]),
      ),
    )
    .digest("hex");
  const machine = options.machine ?? options.ledger?.machine ?? hostState();
  const shipped = dirname(shippedArchiveKind.in(machine, fingerprint, "archive").path);
  for (const pod of listing.packages) {
    const file = shippedArchiveKind.in(machine, fingerprint, pod.id);
    const archivePath = file.path;
    const prepared = await preparePodExport(
      { pod: pod.id, archivePath },
      { podsRoot: examples, captures: options.captures },
      listing,
    );
    options.signal?.throwIfAborted();
    await writePodExport(prepared, file);
  }
  return shipped;
}

export const ledgerKind = stateKind<z.infer<typeof ledgerSchema>, [name?: string]>({
  schema: ledgerSchema,
  place: (_name: string = "shipped-pods.json") => "Shipped Pods ledger",
  segments: (name: string = "shipped-pods.json") => [name],
});

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
  options: TransferOptions & {
    shippedRoot?: string | null;
    ledger?: ReturnType<typeof ledgerKind.in>;
  } = {},
): Promise<ShippedPodsReport> => {
  const owned = { ...options, machine: options.machine ?? options.ledger?.machine ?? hostState() };
  if (options.shippedRoot !== undefined || options.ledger !== undefined) return run(owned);
  return (firstRun ??= run(owned));
};

/**
 * The default pod: where inline scripts land their runs and traces. A fresh install has none, and
 * an inline probe then fails before it runs ("No unique admitted pod owns output folder", Cody,
 * 2026-10-14). Written once; an existing manifest is never touched.
 */
async function ensureDefaultPod(podsRoot: string | undefined, signal?: AbortSignal): Promise<void> {
  const key = scriptingWorkspaceIdentity.defaultWorkspaceKey;
  // Another home may already hold the default pod; a second one would refuse both.
  const listing = await listPackages({ podsRoots: podsRoot ?? productPodsRoots() });
  signal?.throwIfAborted();
  if (listing.packages.some((pod) => pod.id === key)) return;
  podsRoot ??= productPodsRootPath();
  const wrote = writeHome(
    podMemberKind.in(hostState().home({ root: dirname(podsRoot), tier: "user" }), [
      basename(podsRoot),
      key,
      "pod.json",
    ]),
    `${JSON.stringify({ schemaVersion: 2, id: key, name: key, version: "0.1.0", entrypoints: [] }, null, 2)}
`,
    null,
  );
  // The host made this Pod, so record the import's explicit on choice. An existing manifest
  // keeps whatever a person chose; discovery itself also defaults to on.
  if (wrote.ok) await activateImportedPackage(key, podsRoot);
}

async function run(
  options: TransferOptions & {
    shippedRoot?: string | null;
    ledger?: ReturnType<typeof ledgerKind.in>;
  },
): Promise<ShippedPodsReport> {
  options.signal?.throwIfAborted();
  await ensureDefaultPod(options.podsRoot, options.signal);
  let shippedRoot = options.shippedRoot ?? null;
  let archives: string[];
  try {
    if (options.shippedRoot === undefined) shippedRoot = await shippedPodsRoot(options);
    if (!shippedRoot) return { shippedRoot, outcomes: [] };
    archives = (await readdir(shippedRoot)).filter((name) => /\.zip$/i.test(name)).sort();
  } catch (error) {
    options.signal?.throwIfAborted();
    note(options.machine ?? hostState(), {
      class: "keep",
      place: "Shipped examples",
      path:
        shippedRoot ??
        join(hostOwnership.sourceRoot ?? dirname(process.execPath), "examples", "pods"),
      sha256: null,
      reason: `Examples unavailable: ${String(error)}`,
    });
    return { shippedRoot, outcomes: [] };
  }
  if (!shippedRoot) return { shippedRoot, outcomes: [] };
  if (!archives.length) return { shippedRoot, outcomes: [] };

  const ledgerFile = options.ledger ?? ledgerKind.in(options.machine ?? hostState());
  // Machine state (ADR 0039): a ledger that does not decode is discarded with a notice, and every
  // shipped Pod is offered once more.
  const read = readStoredFile(ledgerFile);
  const ledger = read.kind === "ok" ? read.value : { offered: {} };
  // An id is unique across homes (ADR 0037 rule 4): the offer looks in every home, and
  // `installArchive` places a new pod in the user home.
  const everyRoot = options.podsRoot ?? productPodsRoots();
  const outcomes: ShippedPodOutcome[] = [];
  for (const archive of archives) {
    options.signal?.throwIfAborted();
    const path = join(shippedRoot, archive);
    const bytes = await readFile(path);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const installed = (await listPackages({ podsRoots: everyRoot })).packages.find(
      (pod) => pod.id === archiveId(readZip(bytes)),
    );
    // A manifest-free folder may be a prior torn import, even if an old host called it present.
    const partial =
      !installed &&
      (await lstat(
        join(options.podsRoot ?? productPodsRootPath(), archiveId(readZip(bytes))),
      ).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== "ENOENT") throw error;
        return null;
      }));
    if (ledger.offered[sha256] && !installed && !partial) {
      outcomes.push({ archive, sha256, outcome: "offered-before" });
      continue;
    }
    const outcome = await offer(
      archive,
      path,
      bytes,
      sha256,
      {
        ...options,
        machine: options.machine ?? ledgerFile.machine,
        originalsRoot: stateDirectory(ledgerFile.machine, "shipped-pod-originals"),
      },
      installed,
    );
    outcomes.push(
      ledger.offered[sha256] &&
        outcome.outcome === "present" &&
        (!installed || !shippedPodUpdateRefusals.has(installed.id))
        ? { archive, sha256, outcome: "offered-before" }
        : outcome,
    );
    ledger.offered[sha256] = {
      archive,
      at: new Date().toISOString(),
      outcome: outcomes.at(-1)!.outcome,
    };
  }
  options.signal?.throwIfAborted();
  writeState(ledgerFile, `${JSON.stringify(ledger, null, 2)}\n`);
  return { shippedRoot, outcomes };
}

async function offer(
  archive: string,
  path: string,
  bytes: Buffer,
  sha256: string,
  options: TransferOptions & { originalsRoot: StateDirectory },
  installed?: AdmittedPackage,
): Promise<ShippedPodOutcome> {
  try {
    options.signal?.throwIfAborted();
    const id = archiveId(readZip(bytes));
    // Installed archives may be replaced on upgrade. Retain every offered version in writable state.
    await mkdir(options.originalsRoot.path, { recursive: true });
    await writeArtifact(
      options.originalsRoot.path,
      originalArchiveKind.in(options.originalsRoot, sha256),
      bytes,
    );
    if (installed) {
      // A pod another home holds is that home's to change: the offer never replaces or moves it.
      if (
        resolve(dirname(installed.directory)) !== resolve(options.podsRoot ?? productPodsRootPath())
      )
        return {
          archive,
          sha256,
          outcome: "present",
          id,
          reason: `installed at '${installed.directory}'`,
        };
      shippedPodUpdateRefusals.delete(id);
      const matches = (entries: ReadonlyMap<string, Buffer>, pod: AdmittedPackage) => {
        const authored = [...entries].filter(([path]) => isPackageMember(path));
        return (
          authored.length === pod.members.length &&
          authored.every(([path, bytes]) =>
            pod.members.some(
              (member) => member.path === path && Buffer.from(member.bytes).equals(bytes),
            ),
          )
        );
      };
      if (!matches(readZip(bytes), installed)) {
        const writes: HomeMemberUndo[] = [];
        try {
          // Derived machine state (ADR 0039): a record that does not decode is discarded with a notice.
          const record = readStoredFile(importRecordFile(id, options));
          if (record.kind === "missing") throw Error("no import record");
          if (record.kind !== "ok") throw Error("its original import record is incomplete");
          const provenance = record.value;
          // The record holds no machine path: the original is found by its hash in this machine's store.
          const original = await readFile(
            join(options.originalsRoot.path, `${provenance.archiveSha256}.zip`),
          ).catch(() => {
            throw Error("its original archive is unavailable");
          });
          if (createHash("sha256").update(original).digest("hex") !== provenance.archiveSha256)
            throw Error("its original archive no longer matches the import record");
          if (archiveId(readZip(original)) !== id || !matches(readZip(original), installed))
            throw Error("its authored members differ from the original archive");
          const retained = join(options.originalsRoot.path, `${provenance.archiveSha256}.zip`);
          await mkdir(dirname(retained), { recursive: true });
          await writeArtifact(
            options.originalsRoot.path,
            originalArchiveKind.in(options.originalsRoot, provenance.archiveSha256),
            original,
          );
          const fresh = await captureDirectory(installed.directory);
          if (
            fresh.diagnostics.length ||
            !matches(readZip(original), { ...installed, members: fresh.members })
          )
            throw Error("its members changed during the update check");
          const next = readZip(bytes);
          for (const [member, content] of next) {
            if (/^pages\/[^/]+\/index\.html$/.test(member))
              validatePageHtml(content.toString("utf8"), true);
            const capture = /^captures\/([0-9a-f]{64})\.png$/.exec(member);
            if (capture && sha256Hex(content) !== capture[1])
              throw Error(`Capture '${member}' does not hash to its name.`);
          }
          // The write door has no delete verb. Keep an example that needs member removal,
          // rather than bypassing CAS or moving its home folder across volumes.
          if (fresh.members.some((member) => !next.has(member.path))) {
            note(options.machine ?? hostState(), {
              class: "keep",
              place: `Shipped example ${installed.name}`,
              path: installed.directory,
              sha256,
              reason:
                "Its update removes members; the example was kept. Import the current example into a separate workspace.",
            });
            throw Error("its update removes members; import the example into a separate workspace");
          }
          try {
            for (const [member, content] of [...next].sort(
              ([a], [b]) => Number(a === "pod.json") - Number(b === "pod.json"),
            )) {
              options.signal?.throwIfAborted();
              const prior = fresh.members.find((m) => m.path === member);
              const target = join(installed.directory, member);
              const file = podMemberKind.in(
                stateTree(dirname((options.machine ?? hostState()).state)).home({
                  root: dirname(dirname(installed.directory)),
                  tier: "user",
                }),
                [
                  basename(dirname(installed.directory)),
                  basename(installed.directory),
                  ...member.split("/"),
                ],
              );
              const wrote = writeHome(file, content, prior?.sha256 ?? null);
              if (!wrote.ok) throw Error(`its member changed during the update write: ${target}`);
              writes.push({ file, sha256: wrote.sha256, prior: prior?.bytes ?? null });
            }
            for (const [member, content] of next)
              if (/^captures\/[0-9a-f]{64}\.png$/.test(member))
                await options.captures!.adopt(content);
            await activateImportedPackage(id, options.podsRoot ?? productPodsRootPath());
            options.signal?.throwIfAborted();
            writeState(
              importRecordFile(id, options),
              `${JSON.stringify({ archiveSha256: sha256, archive, date: new Date().toISOString() })}\n`,
            );
            return { archive, sha256, outcome: "updated", id, folder: installed.folder };
          } catch (error) {
            // Shutdown keeps already-published bytes; rollback must not restore a released home.
            options.signal?.throwIfAborted();
            const kept = rollbackHomeMembers(writes);
            if (writes.length) await reconcilePackageChanges();
            if (kept.length)
              throw Error(
                `its update failed: ${String(error)}; rollback kept: ${kept.join("; ")}`,
                { cause: error },
              );
            throw error;
          }
        } catch (error) {
          options.signal?.throwIfAborted();
          const reason =
            error instanceof Error && /^(its |the replacement )/.test(error.message)
              ? error.message
              : "its provenance could not be verified";
          shippedPodUpdateRefusals.set(
            id,
            `${installed.name} was kept with your changes. Only the example update was skipped because ${reason}. To take the update, import the current example into a separate workspace beside this Pod, or undo your local edits and the next start takes the update.`,
          );
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
    // Cancellation is owned by startup, not an offer refusal or a new notice.
    options.signal?.throwIfAborted();
    const reason =
      error instanceof Error || error instanceof TransferRefused ? error.message : String(error);
    if (
      error instanceof TransferRefused &&
      error.status === 409 &&
      /folder already exists/.test(reason)
    ) {
      const id = archiveId(readZip(bytes));
      note(options.machine ?? hostState(), {
        class: "keep",
        place: `Shipped example ${id}`,
        path: join(options.podsRoot ?? productPodsRootPath(), id),
        sha256,
        reason,
      });
      return { archive, sha256, outcome: "present", id, reason };
    }
    note(options.machine ?? hostState(), {
      class: "keep",
      place: `Shipped example ${archiveId(readZip(bytes))}`,
      path,
      sha256,
      reason: `Shipped example import failed. Import '${path}' from Pods to try again. Reason: ${reason}`,
    });
    return { archive, sha256, outcome: "refused", reason };
  }
}
