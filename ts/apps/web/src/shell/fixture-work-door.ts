import {
  workHandle,
  workKey,
  type WorkKey,
  type RouteStateSpec,
  type WorkHandle,
} from "@pe/agent-contracts";
import { RouteWorkspace } from "../../../../packages/runtime/src/route-workspace";
import type { z } from "zod";
import type {
  WorkJournalDoor,
  WorkWriteOutcome,
  AcceptedResult,
  JournalCommandId,
} from "../../../../packages/agent-contracts/src/work-journal-door";
import type { CausalParentId } from "../../../../packages/agent-contracts/src/route-kernel-page";
import { completion, workOutcome, failedWrite } from "./work-door-observation";
import { mergeTimeline } from "../../../../packages/runtime/src/work-timeline";
import type { TimelineClient } from "./work-feed-client";

/** Deterministic host fixture: exercise the workspace's real Timeline and step implementation. */
export function fixtureTimeline(workspace: RouteWorkspace, receipts: () => Promise<import("@pe/agent-contracts").ActionStatus[]> | import("@pe/agent-contracts").ActionStatus[] = () => [], subscribeReceipts?: (changed: () => void) => () => void): TimelineClient {
  return {
    open(works, deliver) {
      let closed = false, generation = 0;
      const refresh = async () => {
        deliver(null, "Refreshing Timeline");
        const turn = ++generation;
        try { const part = await workspace.timeline(works, "human", await receipts());
          if (!closed && turn === generation) deliver(mergeTimeline([part]).timeline);
        } catch (error) { if (!closed && turn === generation) deliver(null, String(error)); }
      };
      const stop = workspace.subscribeUncaptured(() => { void refresh(); });
      const stopReceipts = subscribeReceipts?.(() => { void refresh(); });
      void refresh(); return () => { closed = true; stop(); stopReceipts?.(); };
    },
    async step(request) {
      const result = await workspace.step(request.works, "human", request.direction, request.expected, await receipts());
      return result.ok ? null : { message: "error" in result ? result.error : JSON.stringify(result) };
    },
  };
}

/** Each fixture mount owns its store. There is no native transport fallback. */
export function createFixtureWorkDoor(
  spec: RouteStateSpec<z.ZodType>,
  seed: unknown,
  readings: Readonly<Record<string, z.ZodType | undefined>> = {},
  works?: Readonly<Record<string, unknown>>,
  owners: Readonly<Record<string, string>> = {},
): WorkJournalDoor & { timeline: TimelineClient } {
  const stored = new Map<string, unknown>();
  const initialize = (key: WorkKey) => {
    const id = workKey(key);
    if (stored.has(id)) return;
    const provided =
      works &&
      (Object.hasOwn(works, key.route)
        ? works[key.route]
        : key.binding === "workspace"
          ? works[key.work]
          : undefined);
    if (works && provided === undefined) throw Error(`Missing fixture Work: ${id}`);
    stored.set(
      id,
      structuredClone({
        version: 1,
        schemaVersion: spec.schemaVersion ?? 1,
        revision: 0,
        doc: provided ?? seed,
      }),
    );
  };
  const workspace = new RouteWorkspace({
    registrations: [
      { spec },
      ...Object.entries(owners)
        .filter(([, route]) => route !== spec.route)
        .map(([reading, route]) => ({
          spec: { route, title: route, description: "Fixture Work", schema: readings[reading]! },
        })),
    ],
    store: {
      getState: async ({ targetKey }) => structuredClone(stored.get(targetKey)),
      setState: async ({ targetKey, value }) => {
        stored.set(targetKey, structuredClone(value));
      },
    },
  });
  return {
    timeline: fixtureTimeline(workspace),
    lifetime: "subscription",
    receipts: () => ({
      subscribe(deliver) {
        deliver({
          kind: "ready",
          receipts: {
            rows: [],
            from: 0 as import("../../../../packages/agent-contracts/src/work-journal-door").ReceiptCursor,
            through:
              0 as import("../../../../packages/agent-contracts/src/work-journal-door").ReceiptCursor,
          },
        });
        return () => {};
      },
    }),
    open: (scope) => ({
      subscribe(deliver, end) {
        deliver({ kind: "pending" });
        if (scope.reading && !owners[scope.reading]) {
          try {
            const schema = readings[scope.reading];
            if (!schema) throw Error("Undeclared fixture Work reading");
            deliver({
              kind: "ready",
              history: { from: 1, acks: [] },
              snapshot: { handle: workHandle(scope.key, 0), revision: 0, value: schema.parse({}) },
            });
          } catch (error) {
            deliver({
              kind: "failed",
              failure: { kind: "failed", code: "FixtureWorkUnavailable", message: String(error) },
            });
            end();
          }
          return () => {};
        }
        try {
          initialize(scope.key);
        } catch (error) {
          deliver({
            kind: "failed",
            failure: { kind: "failed", code: "FixtureWorkUnavailable", message: String(error) },
          });
          end();
          return () => {};
        }
        return workspace.observeFeed(
          scope.key,
          (value) => {
            const snapshot = value as {
              doc: unknown;
              revision: number;
              handle: WorkHandle;
              history: { from: number; acks: import("@pe/agent-contracts").WorkWriteAck[] };
            };
            deliver({
              kind: "ready",
              history: snapshot.history,
              snapshot: {
                handle: snapshot.handle,
                revision: snapshot.revision,
                value: snapshot.doc,
              },
            });
          },
          (ack) => deliver({ kind: "ack", ack }),
          (error) => {
            deliver({
              kind: "failed",
              failure: { kind: "failed", code: "FixtureWorkUnavailable", message: String(error) },
            });
            end();
          },
        );
      },
    }),
    submitWork: (scope, write) =>
      completion<WorkWriteOutcome>({ kind: "pending" }, async () => {
        try {
          if (scope.reading && !owners[scope.reading]) throw Error("A Work reading is read-only");
          initialize(scope.key);
          return workOutcome(await workspace.write(scope.key, scope.key.route, "human", write));
        } catch (error) {
          return failedWrite(error);
        }
      }),
    submit: (command) => ({
      lifetime: "command",
      key: command.key,
      handle: {
        lifetime: "command",
        id: command.id as JournalCommandId,
        causalParent: command.id as CausalParentId,
      },
      accepted: completion<AcceptedResult>({ kind: "pending" }, async () => ({
        kind: "rejected",
        failure: "unavailable",
        problem: "Native commands unavailable in fixtures",
      })),
    }),
    accepted: () => ({
      kind: "rejected",
      failure: "expired",
      problem: "No fixture native receipt",
    }),
  };
}
