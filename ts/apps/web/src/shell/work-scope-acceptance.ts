import { z } from "zod";
import { canonicalRouteInput, type ExecutionTarget, type WorkKey } from "@pe/agent-contracts";
import { createRouteScopeGate } from "../../../../packages/runtime/src/route-scope-gate";
import type { ScopeToken } from "../../../../packages/agent-contracts/src/route-kernel-page";
import { acquireWorkJournal } from "./journal";

export interface WorkScopeAcceptance {
  capture(): ScopeToken;
  current(token: ScopeToken): boolean;
}

/** Adapts legacy scope observations to B's authority; Work writers still own document delivery. */
export function createWorkScopeAcceptance(
  read: () => {
    target: ExecutionTarget;
    work: WorkKey | null;
    generation?: number;
  },
) {
  const owner = createRouteScopeGate({
    workSchema: z.null(),
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
