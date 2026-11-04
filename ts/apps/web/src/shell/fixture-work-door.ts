import { type RouteStateSpec } from "@pe/agent-contracts";
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

/** Each fixture mount owns its store. There is no native transport fallback. */
export function createFixtureWorkDoor(
  spec: RouteStateSpec<z.ZodType>,
  seed: unknown,
  readings: Readonly<Record<string, z.ZodType | undefined>> = {},
): WorkJournalDoor {
  const stored = new Map<string, unknown>();
  const workspace = new RouteWorkspace({
    registrations: [{ spec }],
    store: {
      getState: async ({ targetKey }) =>
        structuredClone(
          stored.get(targetKey) ?? {
            version: 1,
            schemaVersion: spec.schemaVersion ?? 1,
            revision: 0,
            doc: seed,
          },
        ),
      setState: async ({ targetKey, value }) => {
        stored.set(targetKey, structuredClone(value));
      },
    },
  });
  return {
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
        if (scope.reading) {
          try {
            const schema = readings[scope.reading];
            if (!schema) throw Error("Undeclared fixture Work reading");
            deliver({
              kind: "ready",
              history: { from: 1, acks: [] },
              snapshot: { key: scope.key, revision: 0, value: schema.parse({}) },
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
        return workspace.observeFeed(
          scope.key,
          (value) => {
            const snapshot = value as {
              doc: unknown;
              revision: number;
              history: { from: number; acks: import("@pe/agent-contracts").WorkWriteAck[] };
            };
            deliver({
              kind: "ready",
              history: snapshot.history,
              snapshot: { key: scope.key, revision: snapshot.revision, value: snapshot.doc },
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
          if (scope.reading) throw Error("A Work reading is read-only");
          return workOutcome(await workspace.write(scope.key, spec.route, "human", write));
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
