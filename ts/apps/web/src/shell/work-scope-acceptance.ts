import { z } from "zod";
import {
  canonicalRouteInput,
  type ExecutionTarget,
  type WorkKey,
  type WorkHandle,
  type WorkWriteAck,
} from "@pe/agent-contracts";
import { createRouteScopeGate } from "../../../../packages/runtime/src/route-scope-gate";
import type {
  InvocationToken,
  WorkReduction,
  ScopeToken,
} from "../../../../packages/agent-contracts/src/route-kernel-page";
import type { RouteGraphJson } from "../../../../packages/agent-contracts/src/route-kernel-data";
import { acquireWorkJournal } from "./journal";

export interface WorkScopeAcceptance {
  close(): void;
  capture(): ScopeToken;
  current(token: ScopeToken): boolean;
  observe(work: { handle: WorkHandle; doc: unknown } | null): void;
  readWork(): { handle: WorkHandle; doc: unknown } | null;
  begin(): InvocationToken;
  accept(token: InvocationToken, write: WorkWriteAck): WorkReduction;
}

type WorkGraph = RouteGraphJson & {
  work: { schema: "work"; route: string; version: number; migrations: Record<string, string> };
};

/** B owns revision acceptance even while legacy callers observe React-delayed snapshots. */
export function createWorkScopeAcceptance(
  read: () => {
    target: ExecutionTarget;
    work: WorkKey | null;
    generation?: number;
  },
): WorkScopeAcceptance {
  const owner = createRouteScopeGate<WorkGraph, { work: z.ZodUnknown }>({
    workSchema: z.unknown(),
    hashWork: canonicalRouteInput,
    journal: (key) => acquireWorkJournal(key).journal,
    dependencies: () => ({}),
    preparePage: () => ({ ok: false, reason: "Page belongs to the mounted Page owner" }),
  });
  let identity: string | undefined;
  let token: ScopeToken;
  let closed = false;
  const capture = () => {
    if (closed) return token;
    const scope = read();
    const next = canonicalRouteInput(scope);
    if (next !== identity) {
      identity = next;
      token = owner.enter({ target: scope.target, work: scope.work }, {});
    }
    return token;
  };
  capture();
  return {
    capture,
    observe(work: { handle: WorkHandle; doc: unknown } | null) {
      capture();
      if (closed || !work) return;
      const attempt = owner.capture("snapshot");
      owner.acceptWork(attempt, {
        kind: "snapshot",
        key: work.handle.key,
        revision: work.handle.revision,
        value: work.doc,
        hash: canonicalRouteInput(work.doc),
      });
    },
    readWork() {
      capture();
      const state = owner.read();
      const key = state?.scope.identity.work;
      return key && state?.work
        ? { handle: { key, revision: state.work.revision }, doc: state.work.value }
        : null;
    },
    begin() {
      capture();
      const issued = owner.invocation(owner.capture("write"), {});
      if (!issued.ok) throw Error(issued.reason);
      return issued.value;
    },
    accept(invocation: InvocationToken, write: WorkWriteAck) {
      capture();
      return owner.acceptWork(invocation, { kind: "ack", write });
    },
    current(value: ScopeToken) {
      capture();
      return owner.current(value);
    },
    close() {
      closed = true;
      owner.close();
    },
  };
}
