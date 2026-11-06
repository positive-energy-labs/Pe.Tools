import { observeWorkReceipts } from "./work-receipt-feed.ts";
import { invocationContext, hostFetch as fetch } from "@pe/runtime/context";
import { HOST_RUNTIME_SERVICE_HEADER } from "@pe/host-contracts/contracts";
import { hostOwnership } from "./host-ownership.ts";
import { peRouteUrl } from "@pe/agent-contracts/pe-api";
import { Effect } from "effect";
import {
  discoveryMachine,
  readingKey,
  actionStatusSchema,
  receiptsForWork,
  commandTool,
  type ReadingFrame,
} from "@pe/agent-contracts";
import { OwnerReads, resourceSnapshot, type ResourceObserver, type OwnerValue, type WorkCarriage } from "@pe/runtime";
import type { BridgeError, RevitBridge } from "./bridge.ts";
import type { HostSessionScope } from "@pe/host-contracts/operation-types";
import type { ActionJournal } from "./action-journal.ts";
import type { TakeoffCaptures } from "./takeoff-captures.ts";
import { listBridgeSessions } from "./local-ops.ts";
import { observeSdkReading } from "./session-route.ts";
import { sdkSession } from "./sdk-session.ts";
import type { DocumentMarks, DocumentRef } from "./document-marks.ts";
import type { MachineOwnerPromise } from "./machine.ts";
import { canonicalDuctsSession, ductsReadings } from "./ducts-readings.ts";

/**
 * The host's own HTTP surface, read by the host on the host's clock. A one-shot Reading gets one
 * snapshot; `host-status` gets one every 5s. The browser never opens a second connection for these.
 */
const ONE_SHOT: Record<string, (r: never) => readonly [string, RequestInit?]> = {
  "host-status": () => ["/host/status"],
  capabilities: (r: { doc?: string }) => [
    peRouteUrl("capabilities.find", { query: { doc: r.doc } }),
  ],
  "ops-catalog": (r: { session?: string }) => [
    `/ops${r.session ? `?session=${encodeURIComponent(r.session)}` : ""}`,
  ],
  "schedule-reading": (r: { subject: string; id?: string; target?: unknown }) => [
    "/schedules/readings",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        key: `schedule.grid.${r.subject}`,
        input:
          r.subject === "work" || r.subject === "history"
            ? { workspaceId: r.id }
            : r.subject === "saved"
              ? { id: r.id }
              : {},
        target: r.target,
      }),
    },
  ],
  "takeoff-saved": (r: { id?: string; text?: boolean; document?: string }) => [
    r.id
      ? `/takeoffs/observations?capture=${encodeURIComponent(r.id)}${r.text ? "&text=1" : ""}`
      : "/takeoffs/observations?saved",
  ],
  "rhvac-file-version": (r: { path: string }) => [`/actions?file=${encodeURIComponent(r.path)}`],
};

const POLL_MS: Record<string, number> = { "host-status": 5_000 };

/** The document a Reading is bound to, or null when it is not one document's Reading. */
const documentOf = (request: { kind: string } & Record<string, unknown>): DocumentRef | null =>
  request.kind === "schedule-reading" ||
  request.kind === "takeoff-reading" ||
  request.kind === "families-matrix"
    ? ((request.target as DocumentRef | undefined) ?? null)
    : request.kind === "family-readings"
      ? (((request.work as { open?: DocumentRef }).open ?? null) as DocumentRef | null)
      : request.kind === "work"
        ? (((request.binding === "address" ? request.from : request.open) ??
            null) as DocumentRef | null)
        : null;

/**
 * When the observation in a served value was taken, on the host's clock. A stored capture served
 * again is still the read it was: the mark compares against this, never against the serve.
 */
const takenIn = (value: unknown): number | null => {
  const record = value as
    | {
        doc?: { takenAt?: unknown } | null;
        capturedAt?: unknown;
        takenAt?: unknown;
        snapshot?: { takenAt?: unknown };
        reading?: { observedAt?: unknown };
      }
    | null
    | undefined;
  // A Work slice (`{ doc, revision }`) rests on the Reading its doc says it was staged over.
  const iso =
    record?.doc?.takenAt ??
    record?.capturedAt ??
    record?.snapshot?.takenAt ??
    record?.reading?.observedAt ??
    record?.takenAt;
  const at = typeof iso === "string" ? Date.parse(iso) : Number.NaN;
  return Number.isNaN(at) ? null : at;
};

/** The document a served value says it was read from. */
const documentIn = (value: unknown): DocumentRef | null => {
  const target = (value as { target?: { session?: unknown; openId?: unknown } } | null)?.target;
  return typeof target?.session === "string" && typeof target.openId === "string"
    ? { session: target.session, openId: target.openId }
    : null;
};

/**
 * A document-bound Reading compares captured marks with its source time before publication.
 * Later changes retain that comparison time over the same value; historical frames never compare
 * against today's clock. No consumer compares clocks. Work uses this same envelope boundary.
 */
export const markReadings =
  (marks: DocumentMarks, readFrame: (ref: DocumentRef, key: string, at?: number, carriage?: WorkCarriage, update?: boolean) => Promise<import('./document-marks.ts').MarkFrame>) =>
  (observe: ResourceObserver): ResourceObserver =>
  (request, publish, after) => {
    let bound = documentOf(request as never);
    let latest: (ReadingFrame & { kind: 'snapshot' }) | null = null;
    let servedAt: number | undefined;
    let latestCarriage: WorkCarriage | undefined;
    let emittedChanged: boolean | undefined;
    let closed = false, queued = 0;
    let tail = Promise.resolve();
    let release = () => {};
    let unwatch = () => {};
    const end = () => {
      closed = true;
      const stopSource = release, stopMarks = unwatch;
      release = unwatch = () => {};
      stopSource(); stopMarks();
    };
    const fail = (error: unknown) => {
      if (closed) return;
      const failure = error as { problem?: string; message?: string };
      publish({ kind: 'failure', key: readingKey(request), error: failure.message ?? String(error),
        failure: { kind: 'failed', code: failure.problem ?? 'ReadingFrameFailed', message: failure.message ?? String(error) } });
      end();
    };
    const enqueue = (frame: ReadingFrame, update = false, carriage?: WorkCarriage) => {
      if (closed) return;
      if (!update && frame.kind === 'snapshot') { latest = frame; latestCarriage = carriage; }
      if (++queued > 64) return fail({ problem: 'ReadingFrameBacklog', message: 'Mark-frame capture backlog exceeded its bound' });
      tail = tail.then(async () => {
        if (closed) return;
        if (frame.kind !== 'snapshot') { publish(frame); return; }
        bound ??= documentIn(frame.value);
        if (!bound) { publish(frame); return; }
        const consumed = await readFrame(bound, readingKey(request), update ? servedAt : takenIn(frame.value) ?? undefined, carriage, update);
        if (closed) return;
        if (!update) servedAt = consumed.servedAt;
        const changed = (consumed.marks.observedSince ?? 0) > consumed.servedAt || (consumed.marks.changedAt ?? 0) > consumed.servedAt;
        if (update && changed === emittedChanged) return;
        emittedChanged = changed;
        publish({ ...frame, changed });
      }).catch(fail).finally(() => { queued--; });
    };
    unwatch = marks.subscribe(() => { if (latest) enqueue(latest, true, latestCarriage); });
    try { release = observe(request, (frame, carriage) => enqueue(frame, false, carriage), after); }
    catch (error) { fail(error); }
    if (closed) end();
    return end;
  };
/** Typed adapters into existing owners. No calls, mutations, or transport-owned revisions. */
export function hostResourceObserver(
  bridge?: RevitBridge["Service"],
  journal?: () => ActionJournal,
  captures: () => TakeoffCaptures = () => {
    throw Error("Takeoff captures are unavailable: pass the host's CaptureStore.");
  },
  origin = "http://127.0.0.1",
  // Resolved at the call, not at the build: one observer outlives any one `fetch` binding.
  read: (url: URL, init?: RequestInit) => Promise<Response> = (url, init) => fetch(url, init),
  machine?: MachineOwnerPromise,
  resolveSession: (
    bridge: RevitBridge["Service"],
    scope: HostSessionScope,
  ) => Effect.Effect<{ sessionId: string }, BridgeError> = sdkSession,
): ResourceObserver {
  const inventoryReads = new OwnerReads();
  return (request, publish) => {
    const headers = invocationContext()?.headers;
    const key = readingKey(request);
    const accept = (result: OwnerValue<unknown>) => publish(resourceSnapshot(key, result));
    /** Read the host's own HTTP surface once, or on the host's own timer. Never the client's. */
    const oneShot = (paths: ReadonlyArray<readonly [string, RequestInit?]>, periodMs?: number) => {
      const controller = new AbortController();
      const pump = () =>
        Promise.all(
          paths.map(async ([path, init]) => {
            const response = await read(new URL(path, origin), {
              ...init,
              // The self-read carries the browser's forwarded origin; admission refuses a browser
              // request without its runtime owner (runtime.owner-missing), so name this host.
              headers: {
                ...Object.fromEntries(new Headers(init?.headers)),
                ...headers,
                [HOST_RUNTIME_SERVICE_HEADER]: hostOwnership.serviceName,
              },
              signal: controller.signal,
            });
            const value: unknown = await response.json().catch((error) => {
              console.error("resource-adapters: asynchronous operation failed", error);
              return null;
            });
            if (!response.ok)
              throw Error(
                (value as { error?: string } | null)?.error ??
                  `${path} failed (${response.status})`,
              );
            return value;
          }),
        ).then(
          (bodies) => accept({ value: bodies[0] }),
          (error: unknown) => {
            if (!controller.signal.aborted) accept({ error: String(error) });
          },
        );
      void pump();
      const timer = periodMs ? setInterval(() => void pump(), periodMs) : undefined;
      return () => {
        clearInterval(timer);
        controller.abort();
      };
    };
    return observe();

    function observe(): () => void {
      switch (request.kind) {
        case "ducts-snapshot":
        case "ducts-tables": {
          if (!bridge) {
            accept({ error: "No Revit bridge" });
            return () => {};
          }
          let live = true;
          let release = () => {};
          void canonicalDuctsSession(
            bridge,
            request.kind === "ducts-snapshot" ? request.target.session : request.session,
          )
            .then((session) =>
              // effect-edge: island, phase 5
              Effect.runPromise(
                resolveSession(bridge, {
                  bridgeSessionId: session,
                  openDocumentId:
                    request.kind === "ducts-snapshot" ? request.target.openId : undefined,
                }),
              ),
            )
            .then(
              (resolved) => {
                if (!live) return;
                const canonical =
                  request.kind === "ducts-snapshot"
                    ? {
                        ...request,
                        target: { session: resolved.sessionId, openId: request.target.openId },
                      }
                    : { ...request, session: resolved.sessionId };
                release = ductsReadings(bridge).observe(canonical, (value) => accept({ value }));
              },
              (error: unknown) => {
                if (live) accept({ error: String(error) });
              },
            );
          return () => {
            live = false;
            release();
          };
        }
        case "machine":
          if (!machine) {
            accept({ error: "Machine owner is unavailable" });
            return () => {};
          }
          return machine.observe((value) => accept({ value: discoveryMachine(value) }));
        case "sdk":
          return observeSdkReading(
            request,
            () => {
              if (!machine) throw Error("Machine owner is unavailable");
              return machine.current();
            },
            accept,
            (notify) => (bridge ? bridge.subscribe(() => notify()) : () => {}),
          );
        case "host-status":
        case "capabilities":
        case "ops-catalog":
        case "schedule-reading":
        case "takeoff-saved":
        case "rhvac-file-version":
          return oneShot([ONE_SHOT[request.kind]!(request as never)], POLL_MS[request.kind]);
        case "receipts":
          if (!journal) throw Error("Receipt readings require HostReceipts.");
          if (request.scope)
            return observeWorkReceipts(journal(), request.scope, (value) => accept({ value }));
          return journal().observe(request.target, request.id, (result) => {
            if ("error" in result) return accept(result);
            let rows = request.work ? receiptsForWork(result.value, request.work) : result.value;
            if (request.tool)
              rows = rows.filter((row) => commandTool(row.key)?.name === request.tool);
            accept(
              (request.id || request.work) && request.detail !== "status"
                ? { value: rows }
                : { value: actionStatusSchema.array().parse(rows) },
            );
          });
        case "takeoff-reading":
          return captures().observe(request.target, accept);
        case "families-matrix":
          return captures().observeFamiliesMatrix(request.target, request.filter, accept);
        case "family-readings": {
          const owner = captures();
          return owner.observeFamily(request.work, accept);
        }
        // A LiveDocument key's value names its document, which binds the mark (`documentIn`).
        case "field-options": {
          // TODO: Use the admitted recorded native-read door before recording closes (ADR 0031 rule 1).
          // Runtime falsifier: capture options, replay with a poisoned bridge and require zero live calls;
          // a recorded miss must refuse, never return the current document's live options.
          if (!bridge) {
            accept({ error: "No Revit bridge" });
            return () => {};
          }
          let live = true;
          const { target, key: domain, context } = request;
          // effect-edge: island, phase 5
          void Effect.runPromise(
            resolveSession(bridge, {
              bridgeSessionId: target.session,
              openDocumentId: target.openId,
            }).pipe(
              Effect.flatMap((resolved) =>
                bridge.invoke(
                  "revit.catalog.field-options",
                  { key: domain, context },
                  resolved.sessionId,
                  target.openId,
                ),
              ),
            ),
          ).then(
            ({ value }) => {
              const { descriptor } = value as { descriptor: { requiredRuntimeMode: string } };
              if (live)
                accept({
                  value:
                    descriptor.requiredRuntimeMode === "LiveDocument"
                      ? { ...(value as object), target }
                      : value,
                });
            },
            (error: unknown) => {
              if (live) accept({ error: error instanceof Error ? error.message : String(error) });
            },
          );
          return () => {
            live = false;
          };
        }
        case "inventory":
          return inventoryReads.observe(
            "inventory",
            () =>
              bridge
                ? // effect-edge: island, phase 5
                  Effect.runPromise(listBridgeSessions(bridge.list))
                : Promise.resolve({ sessions: [] }),
            (notify) => (bridge ? bridge.subscribe(() => notify()) : () => {}),
            accept,
          );
        case "world": {
          const release = bridge
            ? bridge.subscribe((event) =>
                publish({
                  kind: "event",
                  key,
                  value: { ...event, atMs: Date.now() },
                }),
              )
            : () => {};
          // Acquire the event tap even when the world is quiet; a gap alone cannot acquire it.
          accept({ value: null });
          return release;
        }
        default:
          accept({ error: `Host does not own '${request.kind}'` });
          return () => {};
      }
    }
  };
}
