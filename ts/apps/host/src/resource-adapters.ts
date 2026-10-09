import { invocationContext, hostFetch as fetch } from "@pe/mcps/context";
import { Effect } from "effect";
import { readingKey, actionStatusSchema, type ReadingFrame } from "@pe/agent-contracts";
import { OwnerReads, resourceSnapshot, type ResourceObserver, type OwnerValue } from "@pe/runtime";
import type { RevitBridge } from "./bridge.ts";
import type { ActionJournal } from "./action-journal.ts";
import { hostActionJournal } from "./gateway-owner.ts";
import { hostTakeoffCaptures, type TakeoffCaptures } from "./takeoff-captures.ts";
import { listBridgeSessions } from "./local-ops.ts";
import { observeSdkReading } from "./session-route.ts";
import type { DocumentMarks, DocumentRef } from "./document-marks.ts";
import type { MachineOwner } from "./machine.ts";

/**
 * The host's own HTTP surface, read by the host on the host's clock. A one-shot Reading gets one
 * snapshot; `host-status` gets one every 5s. The browser never opens a second connection for these.
 */
const ONE_SHOT: Record<string, (r: never) => readonly [string, RequestInit?]> = {
  "host-status": () => ["/host/status"],
  capabilities: (r: { doc?: string }) => [
    `/pe/capabilities${r.doc ? `?doc=${encodeURIComponent(r.doc)}` : ""}`,
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
          r.subject === "work" ? { workspaceId: r.id } : r.subject === "saved" ? { id: r.id } : {},
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
 * A document-bound Reading carries the change mark on its envelope: `changed` is false the moment
 * the host serves it and becomes true when Revit changes that document afterwards, which the host
 * publishes as a new envelope over the same value. No consumer compares clocks, and a client that
 * missed the world event still sees what the envelope says. Wraps every Reading the host serves,
 * Work included.
 */
export const markReadings =
  (marks: DocumentMarks) =>
  (observe: ResourceObserver): ResourceObserver =>
  (request, rawPublish) => {
    let bound = documentOf(request as never);
    let servedAt = Number.POSITIVE_INFINITY;
    let latest: (ReadingFrame & { kind: "snapshot" }) | null = null;
    let changed = false;
    const markedNow = () =>
      bound !== null &&
      ((marks.observedSince ?? 0) > servedAt || (marks.changedAt(bound) ?? 0) > servedAt);
    const unwatch = marks.subscribe(() => {
      if (!latest || markedNow() === changed) return;
      changed = markedNow();
      rawPublish({ ...latest, changed });
    });
    const release = observe(request, (frame) => {
      if (frame.kind !== "snapshot") return rawPublish(frame);
      // A request that does not name the document (a workspace id, a capture id) is still one
      // document's Reading: the served value names the document it was read from.
      bound ??= documentIn(frame.value);
      if (bound === null) return rawPublish(frame);
      servedAt = takenIn(frame.value) ?? Date.now();
      changed = markedNow();
      latest = frame;
      rawPublish({ ...frame, changed });
    });
    return () => {
      release();
      unwatch();
    };
  };

/** Typed adapters into existing owners. No calls, mutations, or transport-owned revisions. */
export function hostResourceObserver(
  bridge?: RevitBridge["Service"],
  journal: () => ActionJournal = hostActionJournal,
  captures: () => TakeoffCaptures = hostTakeoffCaptures,
  origin = "http://127.0.0.1",
  // Resolved at the call, not at the build: one observer outlives any one `fetch` binding.
  read: (url: URL, init?: RequestInit) => Promise<Response> = (url, init) => fetch(url, init),
  machine?: MachineOwner,
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
              headers: { ...Object.fromEntries(new Headers(init?.headers)), ...headers },
              signal: controller.signal,
            });
            const value: unknown = await response.json().catch(() => null);
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
        case "machine":
          if (!machine) {
            accept({ error: "Machine owner is unavailable" });
            return () => {};
          }
          return machine.observe((value) => accept({ value }));
        case "sdk":
          return observeSdkReading(request, accept, (notify) =>
            bridge ? bridge.subscribe(() => notify()) : () => {},
          );
        case "host-status":
        case "capabilities":
        case "ops-catalog":
        case "schedule-reading":
        case "takeoff-saved":
        case "rhvac-file-version":
          return oneShot([ONE_SHOT[request.kind]!(request as never)], POLL_MS[request.kind]);
        case "receipts":
          if (request.scope)
            return oneShot(
              [[`/actions?scope=${encodeURIComponent(JSON.stringify(request.scope))}`]],
              1_000,
            );
          return journal().observe(request.target, request.id, (result) =>
            accept(
              "error" in result || request.id
                ? result
                : { value: actionStatusSchema.array().parse(result.value) },
            ),
          );
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
          if (!bridge) {
            accept({ error: "No Revit bridge" });
            return () => {};
          }
          let live = true;
          const { target, key: domain, context } = request;
          void Effect.runPromise(
            bridge.invoke(
              "revit.catalog.field-options",
              { key: domain, context },
              target.session,
              target.openId,
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
                ? Effect.runPromise(listBridgeSessions(bridge.list))
                : Promise.resolve({ sessions: [] }),
            (notify) => (bridge ? bridge.subscribe(() => notify()) : () => {}),
            accept,
          );
        case "world":
          return bridge
            ? bridge.subscribe((event) =>
                publish({
                  kind: "event",
                  key,
                  value: { ...event, atMs: Date.now() },
                }),
              )
            : () => {};
        default:
          accept({ error: `Host does not own '${request.kind}'` });
          return () => {};
      }
    }
  };
}
