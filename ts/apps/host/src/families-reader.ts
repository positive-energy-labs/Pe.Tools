import { Effect } from "effect";
import { NodeServices } from "@effect/platform-node";
import { randomUUID } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { freemem, tmpdir } from "node:os";
import {
  canonicalRouteInput,
  type AppliedFilter,
  type DocumentRef,
  type WorkKey,
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
import { BridgeError, CANCEL_OPERATION_KEY, type RevitBridge } from "./bridge.ts";
import { assertFresh, documentMarks } from "./document-marks.ts";
import { hostOwnership, productRoot } from "./host-ownership.ts";
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
const runs = new Map<string, Run>();
const OP = "revit.matrix.loaded-families";
const costsPath = () => join(productRoot(), "state", "families", "read-costs.json");
const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const detail = (error: unknown) =>
  error instanceof Error || error instanceof BridgeError ? error.message : String(error);
let lifecycleTail = Promise.resolve();
/** The SDK serializes checkout lifecycle mutations; keep our own starts/stops in that order too. */
function lifecycle<T>(operation: () => Promise<T>): Promise<T> {
  const next = lifecycleTail.then(operation);
  lifecycleTail = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

async function sdk<T>(args: string[]): Promise<T> {
  const raw = await Effect.runPromise(runPeRevitCli(args).pipe(Effect.provide(NodeServices.layer)));
  const envelope = parsePeRevitEnvelope<T>(raw, args, peRevitLauncher());
  if (envelope.exitCode !== 0)
    throw Error(envelope.diagnostics.map((d) => `${d.code}: ${d.detail}`).join("; "));
  return envelope.result!;
}

export async function cancelFamiliesRead(id: string, document: DocumentRef) {
  const run = runs.get(id);
  if (!run || canonicalRouteInput(run.document) !== canonicalRouteInput(document))
    throw Error("This document has no running Families read with that id.");
  run.cancelled = true;
  await run.cancelNative();
}

/** Host orchestration over the document-owned native reader. No Revit process is launched outside the SDK. */
export async function readFamiliesProgressively(options: {
  bridge: RevitBridge["Service"];
  captures: TakeoffCaptures;
  readId: string;
  work: WorkKey;
  document: DocumentRef;
  documentTitle?: string;
  filter: AppliedFilter;
}): Promise<FamiliesObservation> {
  const { bridge, captures, readId, work, document, filter, documentTitle } = options;
  if (
    runs.has(readId) ||
    [...runs.values()].some(
      (r) =>
        canonicalRouteInput(r.work) === canonicalRouteInput(work) ||
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
          Effect.runPromise(bridge.invoke(CANCEL_OPERATION_KEY, { requestId }, target.session)),
        ),
      );
    },
  };
  runs.set(readId, run);
  const marks = documentMarks(bridge);
  const capturedAt = new Date().toISOString();
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
      const reply = await Effect.runPromise(
        bridge.invoke(OP, input, target.session, target.openId, requestId),
      );
      assertFresh(marks, document, capturedAt);
      return reply.value as Matrix;
    } finally {
      active.delete(requestId);
    }
  };
  let costs: Costs = { startupMs: 180_000, families: {} };
  try {
    const stored = JSON.parse(await readFile(costsPath(), "utf8")) as Costs;
    if (
      Number.isFinite(stored.startupMs) &&
      stored.startupMs >= 1_000 &&
      stored.families &&
      typeof stored.families === "object"
    )
      costs = stored;
  } catch {
    /* A missing or damaged timing file is a cold estimate, never a read failure. */
  }
  const samples: Sample[] = [];
  let startingWorkers = 0;
  let frozenPath: string | undefined;
  let freezing: Promise<string> | undefined;
  let folder: string | undefined;
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
    for (const record of prepared.families) records.set(record.familyUniqueId, record);
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
        !!(source.copyPath || source.cloudSource) &&
        freemem() > (5 + 3 * startingWorkers) * 1024 ** 3 &&
        (samples.length >= Math.min(3, pending.length) ||
          pending.every((f) => costs.families[costKey(f)])),
      warning: (error) => {
        message = `Worker unavailable; continuing here. ${detail(error)}`;
      },
      completed: async (item, data) => {
        const record = data.families[0];
        if (!record || record.familyUniqueId !== item.familyUniqueId)
          throw Error("The worker returned another family's record.");
        records.set(record.familyUniqueId, {
          ...record,
          placedInstanceCount: item.placedInstanceCount,
        });
        if (!data.cacheHit && data.elapsedMs != null) {
          const sample = { ms: data.elapsedMs, types: item.typeCount };
          samples.push(sample);
          costs.families[costKey(item)] = sample;
        }
        await publish("reading", "Reading families");
      },
      acquire: async (useful) => {
        startingWorkers++;
        const id = `families-${randomUUID().slice(0, 18)}`;
        const startedAt = Date.now();
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
          if (source.copyPath) {
            freezing ??= (async () => {
              folder = await mkdtemp(join(tmpdir(), "Pe.Tools.families-"));
              const candidate = join(folder, "source.rvt");
              // One immutable input for this run, copied before any worker opens it.
              await copyFile(source.copyPath!, candidate);
              return candidate;
            })();
            frozenPath = await freezing;
          }
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
          costs.startupMs = Math.max(costs.startupMs, Date.now() - startedAt);
          if (!useful()) {
            await stop();
            return null;
          }
          const file = frozenPath ? join(dirname(frozenPath), `${id}.rvt`) : undefined;
          if (frozenPath) await copyFile(frozenPath, file!);
          const opened = await sdk<DocOpResult>(
            docOpenArgv({
              id,
              source: source.cloudSource ?? file!,
              detach: !source.cloudSource,
              // Keep reads the saved local cloud revision; never discard unsynced work or sync.
              unsynced: source.cloudSource ? "keep" : undefined,
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
          const deadline = Date.now() + 15_000;
          do {
            const attached = (await Effect.runPromise(bridge.list)).find(
              (s) => s.connected && s.sdkSessionId === id,
            );
            if (attached?.sessionId) {
              target = { session: attached.sessionId, openId };
              break;
            }
            await delay(250);
          } while (Date.now() < deadline && useful());
          if (!target) throw Error("Worker's product bridge did not attach.");
          const check = await invoke(target, { filter, phase: "Prepare" });
          if (
            check.source?.version !== source.version ||
            canonicalRouteInput(
              check.source.families.map((f) => [f.familyId, f.familyUniqueId]),
            ) !== canonicalRouteInput(source.families.map((f) => [f.familyId, f.familyUniqueId]))
          )
            throw Error("Worker copy does not match the requested revision and families.");
          costs.startupMs = Math.max(1_000, costs.startupMs * 0.5 + (Date.now() - startedAt) * 0.5);
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
        } finally {
          startingWorkers--;
        }
      },
    });
    if (run.cancelled) {
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
    if (folder) await rm(folder, { recursive: true, force: true }).catch(() => {});
    const temp = `${costsPath()}.${randomUUID()}.tmp`;
    try {
      await mkdir(join(productRoot(), "state", "families"), { recursive: true });
      await writeFile(temp, JSON.stringify(costs));
      await rename(temp, costsPath());
    } catch {
      await rm(temp, { force: true }).catch(() => {});
    }
  }
}
