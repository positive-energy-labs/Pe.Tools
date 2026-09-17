import { Effect } from "effect";
import { readingKey, actionStatusSchema } from "@pe/agent-contracts";
import { OwnerReads, resourceSnapshot, type ResourceObserver, type OwnerValue } from "@pe/runtime";
import type { RevitBridge } from "./bridge.ts";
import type { ActionJournal } from "./action-journal.ts";
import { hostActionJournal } from "./gateway-owner.ts";
import { hostTakeoffCaptures, type TakeoffCaptures } from "./takeoff-captures.ts";
import { listBridgeSessions } from "./local-ops.ts";
import { observeSdkReading } from "./session-route.ts";

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

/** Typed adapters into existing owners. No calls, mutations, or transport-owned revisions. */
export function hostResourceObserver(
  bridge?: RevitBridge["Service"],
  journal: () => ActionJournal = hostActionJournal,
  captures: () => TakeoffCaptures = hostTakeoffCaptures,
  origin = "http://127.0.0.1",
): ResourceObserver {
  const inventoryReads = new OwnerReads();
  return (request, publish) => {
    const key = readingKey(request);
    const accept = (result: OwnerValue<unknown>) => publish(resourceSnapshot(key, result));
    /** Read the host's own HTTP surface once, or on the host's own timer. Never the client's. */
    const oneShot = (
      paths: ReadonlyArray<readonly [string, RequestInit?]>,
      periodMs?: number,
      pair = false,
    ) => {
      const controller = new AbortController();
      const pump = () =>
        Promise.all(
          paths.map(async ([path, init]) => {
            const response = await fetch(new URL(path, origin), {
              ...init,
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
          (bodies) =>
            accept({ value: pair ? { installed: bodies[0], update: bodies[1] } : bodies[0] }),
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
    switch (request.kind) {
      case "sdk":
        return observeSdkReading(request, accept, (notify) =>
          bridge ? bridge.subscribe(() => notify()) : () => {},
        );
      case "install-status":
      case "host-status":
      case "capabilities":
      case "ops-catalog":
      case "schedule-reading":
      case "takeoff-saved":
      case "rhvac-file-version":
        return oneShot(
          request.kind === "install-status"
            ? [["/host/install"], ["/host/update"]]
            : [ONE_SHOT[request.kind]!(request as never)],
          POLL_MS[request.kind],
          request.kind === "install-status",
        );
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
      case "family-readings": {
        const owner = captures();
        return owner.observeFamily(request.work, accept);
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
  };
}
