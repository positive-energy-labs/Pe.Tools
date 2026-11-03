import { routeDocDelta } from "../../../../packages/agent-contracts/src/route-doc";
import { applyPatches, workKey, type RouteStateSpec, type WorkWriteAck } from "@pe/agent-contracts";
import type { z } from "zod";
import type {
  WorkJournalDoor,
  WorkFeedState,
  WorkScope,
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
): WorkJournalDoor {
  const states = new Map<
    string,
    {
      revision: number;
      value: unknown;
      acks: WorkWriteAck[];
      listeners: Set<(state: WorkFeedState) => void>;
    }
  >();
  const stateFor = (scope: WorkScope) => {
    const id = workKey(scope.key);
    let state = states.get(id);
    if (!state) {
      state = {
        revision: 0,
        acks: [],
        value: spec.schema.parse(structuredClone(seed)),
        listeners: new Set(),
      };
      states.set(id, state);
    }
    return state;
  };
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
        try {
          const state = stateFor(scope);
          state.listeners.add(deliver);
          deliver({
            kind: "ready",
            history: {
              from: state.acks[0]?.revision ?? state.revision + 1,
              acks: structuredClone(state.acks),
            },
            snapshot: {
              key: scope.key,
              revision: state.revision,
              value: structuredClone(state.value),
            },
          });
          return () => {
            state.listeners.delete(deliver);
          };
        } catch (error) {
          deliver({
            kind: "failed",
            failure: { kind: "failed", code: "FixtureWorkUnavailable", message: String(error) },
          });
          end();
          return () => {};
        }
      },
    }),
    submitWork: (scope, write) =>
      completion<WorkWriteOutcome>({ kind: "pending" }, async () => {
        try {
          const state = stateFor(scope);
          const prior = state.value;
          const result = applyPatches(
            spec,
            { version: 1, revision: state.revision, doc: prior },
            "human",
            write.patches,
            write.expectedRevision,
            write.kind === "restore",
            write.kind === "restore",
          );
          if (!result.ok) return workOutcome(result);
          const ack: WorkWriteAck = {
            key: scope.key,
            kind: write.kind,
            by: "human",
            press: write.press,
            ...(write.label && { label: write.label }),
            base: state.revision,
            revision: result.envelope.revision,
            patches: routeDocDelta(
              prior,
              result.envelope.doc,
              [],
              write.patches.filter((p) => p.path.length > 1).map((p) => String(p.path[0])),
            ),
            inverse: routeDocDelta(
              result.envelope.doc,
              prior,
              [],
              write.patches.filter((p) => p.path.length > 1).map((p) => String(p.path[0])),
            ),
            undoable: true,
            ...(write.restoreOf !== undefined && { restoreOf: write.restoreOf }),
          };
          state.acks.push(ack);
          state.revision = ack.revision;
          state.value = result.envelope.doc;
          state.listeners.forEach((deliver) => deliver({ kind: "ack", ack }));
          return { kind: "accepted", ack };
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
