import { SdkSession } from "./sdk-session.ts";
import { Clock, Context, Effect, Layer, Semaphore } from "effect";
import { randomUUID } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { freemem } from "node:os";
import { productScratchPath } from "@pe/host-contracts/service-identity";
import {
  canonicalRouteInput,
  type AppliedFilter,
  type DocumentRef,
  type WorkKey,
  workKey,
} from "@pe/agent-contracts";
import type { RevitMatrixLoadedFamilies } from "@pe/host-contracts/generated";
import {
  docOpenArgv,
  sessionStartArgv,
  sessionStopArgv,
  type SessionStartResult,
  type DocOpResult,
} from "@pe/host-contracts/pe-revit-contract";
import { adaptiveWork, type WorkExecutor } from "./adaptive-work.ts";
import { CANCEL_OPERATION_KEY, type RevitBridge } from "./bridge.ts";
import { assertFresh, documentMarks } from "./document-marks.ts";
import { hostOwnership } from "./host-ownership.ts";
import { parsePeRevitEnvelope, peRevitLauncher } from "./pe-revit-launch.ts";
import { resolveStartProject, runPeRevitCli } from "./session-route.ts";
import { type FamiliesObservation, type TakeoffCaptures } from "./takeoff-captures.ts";

type Matrix = RevitMatrixLoadedFamilies.Res.Response;
type Family = Matrix["families"][number];
type Source = NonNullable<Matrix["source"]>;
type Item = Source["families"][number];
type Sample = { ms: number; types: number };
type Costs = { startupMs: number; families: Record<string, Sample> };
type Run = {
  document: DocumentRef;
  work: WorkKey;
  cancelled: boolean;
  cancelNative: () => Promise<void>;
};
const OP = "revit.matrix.loaded-families";
const detail = (error: unknown) => (error instanceof Error ? error.message : String(error));
/** What the reader runs Effects with: the CLI runner's services, captured once by the layer. */
type Needs = Effect.Services<ReturnType<typeof runPeRevitCli>>;

/**
 * The reader's state and Promise adapters. The read below is Promise code until phase 5, so every
 * Effect it needs crosses through `run`, the one island, on the services the layer captured.
 */
type Reader = {
  /** Reads in flight; they are cancelled and forgotten when the layer's scope closes. */
  runs: Map<string, Run>;
  run: <A, E>(effect: Effect.Effect<A, E, Needs>) => Promise<A>;
  /** The SDK serializes checkout lifecycle mutations; keep our own starts/stops in that order too. */
  lifecycle: <T>(operation: () => Promise<T>) => Promise<T>;
  sdk: <T>(args: string[]) => Promise<T>;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
};

async function cancelFamiliesRead({ runs }: Reader, id: string, document: DocumentRef) {
  const run = runs.get(id);
  if (!run || canonicalRouteInput(run.document) !== canonicalRouteInput(document))
    throw Error("This document has no running Families read with that id.");
  run.cancelled = true;
  await run.cancelNative();
}

/** Host orchestration over the document-owned native reader. No Revit process is launched outside the SDK. */
async function readFamiliesProgressively(
  reader: Reader,
  options: {
    bridge: RevitBridge["Service"];
    captures: TakeoffCaptures;
    readId: string;
    work: WorkKey;
    document: DocumentRef;
    documentTitle?: string;
    filter: AppliedFilter;
  },
): Promise<FamiliesObservation> {
  const { bridge, captures, readId, work, document, filter, documentTitle } = options;
  const { runs, run: runEffect, lifecycle, sdk, now, sleep } = reader;
  if (
    runs.has(readId) ||
    [...runs.values()].some(
      (r) =>
        workKey(r.work) === workKey(work) ||
        canonicalRouteInput(r.document) === canonicalRouteInput(document),
    )
  )
    throw Error("A Families read is already running for this Work.");
  const active = new Map<string, DocumentRef>();
  const run: Run = {
    document,
    work,
    cancelled: false,
    cancelNative: async () => {
      // Cancel bypasses the per-session FIFO; the owning calls settle before cleanup.
      await Promise.allSettled(
        [...active].map(([requestId, target]) =>
          runEffect(bridge.invoke(CANCEL_OPERATION_KEY, { requestId }, target.session)),
        ),
      );
    },
  };
  runs.set(readId, run);
  const marks = documentMarks(bridge);
  const capturedAt = new Date(now()).toISOString();
  const records = new Map<string, Family>();
  const base = { work, document, documentTitle, filter, capturedAt };
  let total = 0,
    workers = 1,
    message: string | undefined;
  let publication = Promise.resolve();
  const result = (): Matrix => ({
    families: [...records.values()],
    issues: [],
    page: { totalCount: total, returnedCount: records.size, isTruncated: false },
  });
  let latest: FamiliesObservation | undefined;
  const publish = (state: "reading" | "failed" | "cancelled", phase: string) => {
    publication = publication.then(async () => {
      latest = await captures.saveFamiliesProgress({
        ...base,
        result: result(),
        progress: {
          runId: readId,
          state,
          phase,
          completed: records.size,
          total,
          workers,
          ...(message ? { message } : {}),
        },
      });
    });
    return publication;
  };
  const invoke = async (
    target: DocumentRef,
    input: RevitMatrixLoadedFamilies.Req.Request,
  ): Promise<Matrix> => {
    assertFresh(marks, document, capturedAt);
    if (run.cancelled) throw Error("Families read cancelled.");
    const requestId = randomUUID();
    active.set(requestId, target);
    try {
      const reply = await runEffect(
        bridge.invoke(OP, input, target.session, target.openId, requestId),
      );
      assertFresh(marks, document, capturedAt);
      return reply.value as Matrix;
    } finally {
      active.delete(requestId);
    }
  };
  const costsPath = join(captures.directory, "families", "read-costs.json");
  let costs: Costs = { startupMs: 180_000, families: {} };
  try {
    const stored = JSON.parse(await readFile(costsPath, "utf8")) as Costs;
    if (
      Number.isFinite(stored.startupMs) &&
      stored.startupMs >= 1_000 &&
      stored.families &&
      typeof stored.families === "object"
    )
      costs = stored;
  } catch (error) {
    console.warn("ts/apps/host/src/families-reader.ts: fallback after failure", error);
    /* A missing or damaged timing file is a cold estimate, never a read failure. */
  }
  const samples: Sample[] = [];
  let folder: Promise<string> | undefined;
  const costKey = (item: Item) => `${item.familyUniqueId}:${item.typeCount}`;
  const estimate = (item: Item) => {
    const known = costs.families[costKey(item)];
    if (known && Number.isFinite(known.ms) && known.ms >= 0) return known.ms;
    if (!samples.length) return 0;
    // FamilyComplexity predicts a mutating FF pass AFTER EditFamily, not snapshot extraction.
    // Its geometry coefficients cannot price opening unseen families; prefer measured reads here.
    return (
      samples.reduce(
        (sum, s) => sum + s.ms * (0.5 + (0.5 * item.typeCount) / Math.max(1, s.types)),
        0,
      ) / samples.length
    );
  };
  try {
    await publish("reading", "Preparing families");
    const prepared = await invoke(document, { filter, phase: "Prepare" });
    if (!prepared.source) throw Error("The connected Revit does not supply bounded family reads.");
    const source = prepared.source;
    total = source.families.length;
    // Extracted records carry no project decoration; the catalog's placed count is this document's.
    const placed = new Map(source.families.map((f) => [f.familyUniqueId, f.placedInstanceCount]));
    const keep = (record: Family) =>
      records.set(record.familyUniqueId, {
        ...record,
        placedInstanceCount: placed.get(record.familyUniqueId) ?? 0,
      });
    for (const record of prepared.families) keep(record);
    message = source.copyRefusal ?? undefined;
    await publish("reading", "Reading families");
    const pending = source.families
      .filter((f) => !records.has(f.familyUniqueId))
      .sort((a, b) => b.typeCount - a.typeCount);
    const executor = (target: DocumentRef): WorkExecutor<Item, Matrix> => ({
      run: (item) => invoke(target, { filter, phase: "Extract", familyId: item.familyId }),
      dispose: async () => {},
    });
    await adaptiveWork({
      items: pending,
      primary: executor(document),
      cancelled: () => run.cancelled,
      cost: estimate,
      startupMs: () => costs.startupMs,
      canExpand: () =>
        !!source.copyPath &&
        freemem() > 5 * 1024 ** 3 &&
        (samples.length >= Math.min(3, pending.length) ||
          pending.every((f) => costs.families[costKey(f)])),
      warning: (error) => {
        if (run.cancelled) return;
        message = `Worker unavailable; continuing here. ${detail(error)}`;
      },
      completed: async (item, data) => {
        const record = data.families[0];
        if (!record || record.familyUniqueId !== item.familyUniqueId)
          throw Error("The worker returned another family's record.");
        keep(record);
        if (!data.cacheHit && data.elapsedMs != null) {
          const sample = { ms: data.elapsedMs, types: item.typeCount };
          samples.push(sample);
          costs.families[costKey(item)] = sample;
        }
        await publish("reading", "Reading families");
      },
      acquire: async (useful) => {
        const id = `families-${randomUUID().slice(0, 18)}`;
        const startedAt = now();
        let acquired = false;
        const stop = async () => {
          if (acquired) {
            await lifecycle(() =>
              sdk(
                sessionStopArgv({ id, unsaved: "discard", force: true, requestId: randomUUID() }),
              ),
            );
            acquired = false;
          }
        };
        try {
          const start = {
            id,
            year: source.revitVersion,
            background: true,
            // Quarantine owns one native settings lease; a pool uses the SDK's normal background launches.
            snapshot: hostOwnership.lane === "dev",
            project: resolveStartProject(hostOwnership.lane, hostOwnership.sourceRoot),
          };
          const launched = await lifecycle(async () => {
            if (!useful()) return null;
            await sdk(sessionStartArgv({ ...start, plan: true }));
            acquired = true; // Retain custody even when a launch answers late or fails.
            return sdk<SessionStartResult>(sessionStartArgv({ ...start, requestId: randomUUID() }));
          });
          if (!launched) return null;
          if (launched.phase !== "ready") throw Error("Worker Revit did not become ready.");
          // Even an unused boot teaches us its lower bound; do not repeat the same cheap-start mistake.
          costs.startupMs = Math.max(costs.startupMs, now() - startedAt);
          if (!useful()) {
            await stop();
            return null;
          }
          // Each worker opens its own copy; the version check below rejects a file saved since Prepare.
          folder ??= mkdir(productScratchPath(hostOwnership.rootPath), { recursive: true }).then(
            () => mkdtemp(join(productScratchPath(hostOwnership.rootPath), "families-")),
          );
          const file = join(await folder, `${id}.rvt`);
          await copyFile(source.copyPath!, file);
          const opened = await sdk<DocOpResult>(
            docOpenArgv({
              id,
              source: file,
              detach: true,
              window: "headless",
              links: "allow",
              requestId: randomUUID(),
              timeoutSeconds: 240,
            }),
          );
          const openId = opened.document?.openId;
          if (!openId) throw Error("Worker document has no SDK open id.");
          if (!useful()) {
            await stop();
            return null;
          }
          let target: DocumentRef | undefined;
          const deadline = now() + 15_000;
          do {
            const attached = await runEffect(
              SdkSession.resolve(bridge, { sdkSession: id }).pipe(
                Effect.orElseSucceed(() => undefined),
              ),
            );
            if (attached) {
              target = { session: attached.sessionId, openId };
              break;
            }
            await sleep(250);
          } while (now() < deadline && useful());
          if (!target) throw Error("Worker's product bridge did not attach.");
          const check = await invoke(target, { filter, phase: "Prepare" });
          if (
            check.source?.version !== source.version ||
            canonicalRouteInput(
              check.source.families.map((f) => [f.familyId, f.familyUniqueId]),
            ) !== canonicalRouteInput(source.families.map((f) => [f.familyId, f.familyUniqueId]))
          )
            throw Error("Worker copy does not match the requested revision and families.");
          costs.startupMs = Math.max(1_000, costs.startupMs * 0.5 + (now() - startedAt) * 0.5);
          workers++;
          await publish("reading", "Reading families");
          return {
            ...executor(target),
            dispose: async () => {
              await stop();
              workers--;
            },
          };
        } catch (error) {
          await stop();
          throw error;
        }
      },
    });
    if (run.cancelled) {
      message = undefined;
      await publish("cancelled", "Cancelled");
      return latest!;
    }
    await publish("reading", "Collecting project values and schedules");
    const final = await invoke(document, {
      filter,
      budget: { maxEntries: total || 1, maxSamplesPerEntry: 1000 },
      snapshots: [...records.values()],
      includeTempPlacement: true,
    });
    if (run.cancelled) {
      message = undefined;
      await publish("cancelled", "Cancelled");
      return latest!;
    }
    const saved = await captures.saveFamilies({
      ...base,
      result: final,
      progress: {
        runId: readId,
        state: "complete",
        phase: "Complete",
        completed: total,
        total,
        workers: 1,
      },
    });
    await captures.clearFamiliesProgress(document, filter);
    return saved;
  } catch (error) {
    message = run.cancelled ? undefined : detail(error);
    await publish(
      run.cancelled ? "cancelled" : "failed",
      run.cancelled ? "Cancelled" : "Read failed",
    );
    return latest!;
  } finally {
    runs.delete(readId);
    await folder
      ?.then((dir) => rm(dir, { recursive: true, force: true }))
      .catch((error) => {
        console.error("families-reader: asynchronous operation failed", error);
      });
    const temp = `${costsPath}.${randomUUID()}.tmp`;
    try {
      await mkdir(join(captures.directory, "families"), { recursive: true });
      await writeFile(temp, JSON.stringify(costs));
      await rename(temp, costsPath);
    } catch {
      await rm(temp, { force: true }).catch((error) => {
        console.error("families-reader: asynchronous operation failed", error);
      });
    }
  }
}

const makeFamiliesReader = Effect.gen(function* () {
  const services = yield* Effect.context<Needs>();
  const clock = yield* Clock.clockWith(Effect.succeed);
  const lock = yield* Semaphore.make(1);
  const run = <A, E>(effect: Effect.Effect<A, E, Needs>) =>
    // effect-edge: island, phase 5
    Effect.runPromiseWith(services)(effect);
  const reader: Reader = {
    runs: new Map(),
    run,
    lifecycle: (operation) => run(lock.withPermits(1)(Effect.promise(operation))),
    sdk: async <T>(args: string[]) => {
      const raw = await run(runPeRevitCli(args));
      const envelope = parsePeRevitEnvelope<T>(raw, args, peRevitLauncher());
      if (envelope.exitCode !== 0)
        throw Error(envelope.diagnostics.map((d) => `${d.code}: ${d.detail}`).join("; "));
      return envelope.result!;
    },
    now: () => clock.currentTimeMillisUnsafe(),
    sleep: (ms) => run(Effect.sleep(ms)),
  };
  // Every admitted read, start to cleanup (SDK stops, publication, scratch, costs file).
  const reads = new Set<Promise<unknown>>();
  let closed = false;
  // Stop admission, cancel, then JOIN: a read finishes its own cleanup (publishing `cancelled`, its
  // typed outcome) before this scope's dependencies close. A read starting an SDK worker has no
  // native request to cancel yet; its `cancelled` flag stops it at the next checkpoint.
  yield* Effect.addFinalizer(() =>
    Effect.promise(async () => {
      closed = true;
      const open = [...reader.runs.values()];
      for (const r of open) r.cancelled = true;
      await Promise.allSettled(open.map((r) => r.cancelNative()));
      while (reads.size) await Promise.allSettled([...reads]);
      reader.runs.clear();
    }),
  );
  return {
    read: (options: Parameters<typeof readFamiliesProgressively>[1]) => {
      if (closed) return Promise.reject(Error("The Families reader closed with its host."));
      const read = readFamiliesProgressively(reader, options);
      reads.add(read);
      void read.then(
        () => reads.delete(read),
        () => reads.delete(read),
      );
      return read;
    },
    cancel: (id: string, document: DocumentRef) => cancelFamiliesRead(reader, id, document),
    /** Serialized with every SDK start and stop this reader makes; exposed for the one test of that. */
    lifecycle: reader.lifecycle,
  };
});

export class FamiliesReader extends Context.Service<
  FamiliesReader,
  Effect.Success<typeof makeFamiliesReader>
>()("pe/FamiliesReader") {
  static readonly layer = Layer.effect(FamiliesReader, makeFamiliesReader);
}
