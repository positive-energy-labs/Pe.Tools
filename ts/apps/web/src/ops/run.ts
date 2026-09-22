/**
 * The two lanes one host call can take. A read is `POST /call` and returns a value with no
 * identity. A mutation is admitted to the host action journal under an id, and the receipt read
 * back by that id is the truth of what happened (`ActionReceiptView`).
 */
import { actionAdmissionSchema, type ExecutionTarget } from "@pe/agent-contracts";
import { isTsOnlyOperationKey } from "@pe/host-contracts/operation-types";

import {
  readAction,
  submitAction,
} from "../../../../packages/mcps/src/shared/takeoff-action-client";
import type { HostCaller } from "#/route";
import { isMutation, type HostOperationCatalogEntry } from "#/ops/manifest";

export type RunOutcome =
  | { kind: "value"; value: unknown; elapsedMs: number }
  | { kind: "action"; id: string; state: string };

export async function runOp(input: {
  op: HostOperationCatalogEntry;
  request: unknown;
  target: ExecutionTarget;
  call: HostCaller;
  /** The page's last journaled action; a second mutation waits until it is settled. */
  priorActionId: string | null;
  base?: string;
}): Promise<RunOutcome> {
  const started = performance.now();
  if (!isMutation(input.op))
    return {
      kind: "value",
      value: await input.call(input.op.key, input.request),
      elapsedMs: Math.round(performance.now() - started),
    };
  if (input.priorActionId) {
    const prior = await readAction(input.priorActionId, input.base);
    if (!prior || (prior.state !== "succeeded" && prior.state !== "failed"))
      throw Error("Read or reconcile the original action before starting another operation");
  }
  const admission = actionAdmissionSchema.parse({
    id: crypto.randomUUID(),
    kind: "operation",
    key: input.op.key,
    actor: "human",
    destination: isTsOnlyOperationKey(input.op.key) ? { kind: "host" } : input.target,
    input: input.request ?? {},
    bases: {},
  });
  const action = await submitAction(admission, input.base, 30_000);
  return { kind: "action", id: action.id, state: action.state };
}
