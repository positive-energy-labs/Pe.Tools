import { createPeClient } from "@pe/agent-contracts/pe-api";
import { readPeError } from "@pe/host-contracts/pe-api";
import { z } from "zod";
import { retainedScriptIntent } from "./script-intent.ts";
import { refusalSchema } from "@pe/agent-contracts";
import {
  contextFetch as fetch,
  invocationContext,
  readOutbox,
  writeOutbox,
  type InvocationRecord,
} from "@pe/runtime/context";
import {
  canonicalRouteInput,
  commands,
  commandTarget,
  actionAdmissionSchema,
  type ExecutionTarget,
  type Command,
  type WorkHandle,
  actionReceiptSchema,
  actionStatusSchema,
  actionControls,
  type ActionControlKey,
  type ActionAdmission,
  type DocumentRef,
  type ActionReceipt,
  type SemanticActionKey,
  familyCaptureSchema,
  type FamilyReadKey,
  type WorkKey,
} from "@pe/agent-contracts";

/**
 * A refused admission. A door's typed refusal rides on the error (`refusal`) and its sentence is
 * the message; any other body stays text, because only a host door speaks the typed shape.
 */
async function refusedAdmission(id: string, response: Response) {
  const problem = await readPeError(response);
  const notDispatched =
    (problem.details as { notDispatched?: unknown } | null)?.notDispatched === true;
  const typed = z.object({ refusal: refusalSchema }).safeParse(problem.details);
  if (!typed.success)
    return Object.assign(Error(`Action '${id}' refused: ${problem.message}`), {
      notDispatched,
    });
  const { reason, remedy } = typed.data.refusal;
  const said = remedy && !reason.includes(remedy) ? `${reason} ${remedy}` : reason;
  return Object.assign(Error(`Action '${id}' refused. ${said}`), {
    refusal: typed.data.refusal,
    notDispatched,
  });
}

// Diagnostic projection only; persisted outbox bytes decide every retry.
const retained = new Map<string, InvocationRecord>();
const retentionKey = (base: string, key: string, target: unknown) =>
  `pe-action:${base}:${key}:${canonicalRouteInput(target)}`;
function getRetained(slot: string): InvocationRecord | undefined {
  return readOutbox(slot);
}
function retain(slot: string, value?: InvocationRecord) {
  writeOutbox(slot, value);
  const records = invocationContext()?.admissions ?? retained;
  if (value) records.set(slot, structuredClone(value));
  else records.delete(slot);
}
const terminal = (row: ActionReceipt) => ["succeeded", "failed", "cancelled"].includes(row.state);
const normalizedInput = (key: string, input: Record<string, unknown>) =>
  Object.hasOwn(commands, key) ? commands[key as SemanticActionKey].input.parse(input) : input;
function assertIdentity(admission: ActionAdmission, row: ActionReceipt) {
  if (
    row.id !== admission.id ||
    row.key !== admission.key ||
    canonicalRouteInput(row.target) !== canonicalRouteInput(admission.target) ||
    canonicalRouteInput(normalizedInput(row.key, row.input)) !==
      canonicalRouteInput(normalizedInput(admission.key, admission.input))
  )
    throw Error(`Action '${admission.id}' returned a receipt for different intent or target`);
}
function transportLost(error: unknown) {
  if (error instanceof z.ZodError || (error as { receiptRejected?: boolean })?.receiptRejected)
    throw error;
  return undefined;
}
function forget(slot: string, id: string) {
  if (getRetained(slot)?.id === id) retain(slot);
}
/**
 * Admissions this client has posted and not yet seen settle, so a stop control can name them.
 * Keyed by id; the value is the endpoint that owns the journal row.
 */
const localInFlight = new Map<string, string>();
const inFlight = () => invocationContext()?.running ?? localInFlight;
export const runningAdmissions = () => [...inFlight()].map(([id, base]) => ({ id, base }));
type ActionObserver = (
  id: string,
  base: string,
  accept: (row: ActionReceipt) => void,
  fail: (error: Error) => void,
) => () => void;
let actionObserver: ActionObserver | undefined;
/** The browser binds its existing receipt owner; Node uses the authenticated GET wait door. */
export function bindActionObserver(observer: ActionObserver): () => void {
  if (actionObserver) throw Error("Action completion already has an observer");
  actionObserver = observer;
  return () => {
    if (actionObserver === observer) actionObserver = undefined;
  };
}

/**
 * Stop a running action: the host signals its in-flight bridge request past the session gate, and
 * the row settles `cancelled` at the operation's next checkpoint. Work already written stands.
 */
export async function cancelAction(id: string, base = "") {
  const response = await createPeClient(base, fetch).response(
    "action.cancel",
    { body: { id } },
    {
      signal: AbortSignal.timeout(30_000),
    },
  );
  if (!response.ok) {
    throw Error((await readPeError(response)).message);
  }
  return actionReceiptSchema.parse(await response.json());
}

/** Stop everything this client still has in flight. Each refusal is the caller's to report. */
export const cancelRunningAdmissions = () =>
  Promise.allSettled(runningAdmissions().map(({ id, base }) => cancelAction(id, base)));
export async function readAction(id: string, base = "", signal?: AbortSignal, wait?: number) {
  const response = await createPeClient(base, fetch).response(
    "actions.read",
    { query: { id, ...(wait ? { wait: String(wait) } : {}) } },
    { signal },
  );
  if (!response.ok)
    throw Object.assign(Error(`Action recovery failed (${response.status})`), {
      receiptRejected: true,
    });
  const row = actionReceiptSchema.array().parse(await response.json())[0];
  if (row && row.id !== id)
    throw Object.assign(Error(`Action '${id}' returned a different receipt id`), {
      receiptRejected: true,
    });
  return row;
}

/** An explicit retry recovers its original target before consulting a current catalogue or Work. */
export async function recoverAction(
  id: string,
  key: string,
  input: Record<string, unknown>,
  target: ExecutionTarget | undefined,
  base = "",
  waitMs = Infinity,
): Promise<ActionReceipt | DetachedAction | undefined> {
  const slot = retentionKey(base, id, null);
  const pending = getRetained(slot);
  const row = await readAction(
    id,
    base,
    AbortSignal.timeout(Math.max(1, Math.min(5000, waitMs))),
  ).catch(transportLost);
  const original = row ?? pending?.admission;
  if (!original) {
    if (pending)
      throw Error(`Acknowledged action '${id}' is unavailable; retain its id for recovery`);
    return undefined;
  }
  const script = retainedScriptIntent(key, input, original.input);
  if (script) ({ key, input } = script);
  if (
    original.key !== key ||
    canonicalRouteInput(normalizedInput(key, input)) !==
      canonicalRouteInput(normalizedInput(key, original.input))
  )
    throw Error(`Action '${id}' conflicts with its original intent`);
  if (target && canonicalRouteInput(target) !== canonicalRouteInput(original.target))
    throw Error(`Action '${id}' conflicts with its original target`);
  if (row) {
    retain(slot, { id });
    const result = await waitForAction(id, base, waitMs, undefined, row);
    if (result.state !== "detached" && terminal(result)) forget(slot, id);
    return result;
  }
  return recoverInvocation(slot, pending!, base, waitMs);
}

export async function runSemanticAction(
  key: SemanticActionKey,
  input: Record<string, unknown>,
  target?: DocumentRef | ExecutionTarget,
  work?: WorkHandle,
  base = "",
  id?: string | (() => string),
  waitMs = Infinity,
): Promise<ActionReceipt | DetachedAction> {
  const definition: Command = commands[key];
  const bound = work && definition.work ? definition.work.bind(input, work) : input;
  if (typeof id === "string") {
    const exact =
      target && "kind" in target
        ? target
        : target
          ? { kind: "document" as const, ref: target }
          : undefined;
    const recovered = await recoverAction(
      id,
      key,
      bound as Record<string, unknown>,
      exact,
      base,
      waitMs,
    );
    if (recovered) return recovered;
  }
  const destination =
    target && "kind" in target
      ? target
      : commandTarget(key, bound as Record<string, unknown>, target);
  const slot =
    typeof id === "string"
      ? retentionKey(base, id, null)
      : retentionKey(base, key, work?.key ?? destination);
  const prior = getRetained(slot);
  if (prior && typeof id !== "string") {
    const row = await recoverInvocation(slot, prior, base, waitMs);
    if (prior.admission || row.state === "detached" || !terminal(row)) return row;
    forget(slot, prior.id);
  }
  const admission = actionAdmissionSchema.parse({
    id: typeof id === "function" ? id() : (id ?? crypto.randomUUID()),
    key,
    target: destination,
    input: bound,
  });
  return submitAction(admission, base, waitMs, slot);
}

/** Retry the immutable pre-ack bytes; after acknowledgement status needs only the id. */
async function recoverInvocation(
  slot: string,
  pending: InvocationRecord,
  base: string,
  waitMs: number,
): Promise<ActionReceipt | DetachedAction> {
  const row = await readAction(pending.id, base).catch(transportLost);
  if (row) {
    if (pending.admission) assertIdentity(pending.admission, row);
    retain(slot, { id: pending.id });
    return waitForAction(pending.id, base, waitMs, undefined, row);
  }
  if (pending.admission) return submitAction(pending.admission, base, waitMs, slot);
  throw Error(`Acknowledged action '${pending.id}' is unavailable; retain its id for recovery`);
}

export async function submitAction(
  admission: ActionAdmission,
  base = "",
  waitMs = Infinity,
  slot = retentionKey(base, admission.id, null),
): Promise<ActionReceipt | DetachedAction> {
  admission = structuredClone(actionAdmissionSchema.parse(admission));
  const prior = getRetained(slot);
  if (prior?.admission && canonicalRouteInput(prior.admission) !== canonicalRouteInput(admission))
    throw Error(`Action '${prior.id}' has an unacknowledged immutable request`);
  retain(slot, { id: admission.id, admission });
  const deadline = Date.now() + waitMs;
  inFlight().set(admission.id, base);
  let row: ActionReceipt | undefined;
  let acceptance: DetachedAction["acceptance"] = "unknown";
  try {
    while (!row) {
      let response: Response;
      try {
        response = await createPeClient(base, fetch).response(
          "actions.admit",
          { body: admission },
          { signal: AbortSignal.timeout(Math.max(1, Math.min(30_000, deadline - Date.now()))) },
        );
      } catch {
        row = await readAction(admission.id, base, AbortSignal.timeout(5000)).catch(transportLost);
        if (row) assertIdentity(admission, row);
        if (!row) {
          if (Date.now() >= deadline)
            return { state: "detached", id: admission.id, key: admission.key, acceptance };
          // HTTP refusals are decisions. Only a lost transport may repeat the same retained bytes.
          await new Promise((resolve) => setTimeout(resolve, 250));
        }
        continue;
      }
      if (!response.ok) {
        const refusal = await refusedAdmission(admission.id, response);
        if (response.status < 500 && refusal.notDispatched) forget(slot, admission.id);
        throw refusal;
      }
      row = actionReceiptSchema.parse(await response.json());
      assertIdentity(admission, row);
    }
    acceptance = "admitted";
    retain(slot, { id: admission.id });
    const result = await waitForAction(
      admission.id,
      base,
      Math.max(0, deadline - Date.now()),
      undefined,
      row,
    );
    if (result.state !== "detached" && terminal(result)) forget(slot, admission.id);
    return result;
  } finally {
    inFlight().delete(admission.id);
  }
}

export async function waitForAction(
  id: string,
  base = "",
  waitMs = Infinity,
  signal?: AbortSignal,
  initial?: ActionReceipt,
): Promise<ActionReceipt | DetachedAction> {
  const deadline = Date.now() + waitMs;
  let row = initial ?? (await readAction(id, base, signal));
  if (!row) throw Error(`Action '${id}' has no retained receipt`);
  inFlight().set(id, base);
  try {
    if (
      actionObserver &&
      (row.state === "waiting" || row.state === "running") &&
      Date.now() < deadline
    ) {
      const original = row;
      const observer = actionObserver;
      const deadlineSignal = Number.isFinite(waitMs)
        ? AbortSignal.timeout(Math.max(1, waitMs))
        : undefined;
      const abort =
        signal && deadlineSignal
          ? AbortSignal.any([signal, deadlineSignal])
          : (signal ?? deadlineSignal);
      return await new Promise<ActionReceipt | DetachedAction>((resolve, reject) => {
        let unsubscribe = () => {};
        let settled = false;
        const finish = (complete: () => void) => {
          if (settled) return;
          settled = true;
          unsubscribe();
          abort?.removeEventListener("abort", interrupted);
          complete();
        };
        const interrupted = () =>
          finish(() =>
            signal?.aborted
              ? reject(signal.reason)
              : resolve({ state: "detached", id, key: original.key, acceptance: "admitted" }),
          );
        abort?.addEventListener("abort", interrupted, { once: true });
        if (abort?.aborted) return interrupted();
        const release = observer(
          id,
          base,
          (next) => {
            try {
              assertIdentity(original, next);
              if (next.state !== "waiting" && next.state !== "running") finish(() => resolve(next));
            } catch (error) {
              finish(() => reject(error));
            }
          },
          (error) => finish(() => reject(error)),
        );
        if (settled) release();
        else unsubscribe = release;
      });
    }
    while (row.state === "waiting" || row.state === "running") {
      if (Date.now() >= deadline)
        return { state: "detached", id, key: row.key, acceptance: "admitted" };
      const timeout = Math.max(1, Math.min(25_000, deadline - Date.now()));
      try {
        const next = await readAction(
          id,
          base,
          signal
            ? AbortSignal.any([signal, AbortSignal.timeout(timeout + 1000)])
            : AbortSignal.timeout(timeout + 1000),
          timeout,
        );
        if (!next) throw Error(`Action '${id}' lost its durable receipt`);
        row = next;
      } catch (error) {
        if (Date.now() >= deadline)
          return { state: "detached", id, key: row.key, acceptance: "admitted" };
        throw error;
      }
    }
    return row;
  } finally {
    inFlight().delete(id);
  }
}
export class ActionResultError extends Error {
  constructor(readonly action: ActionReceipt | DetachedAction) {
    super(`${action.id}: ${action.state}: ${"error" in action ? action.error : "outcome pending"}`);
  }
}
export function actionResult(row: ActionReceipt | DetachedAction): unknown {
  if (row.state !== "succeeded") throw new ActionResultError(row);
  return row.result;
}

export type DetachedAction = {
  state: "detached";
  id: string;
  key: string;
  acceptance: "admitted" | "unknown";
};
export async function controlAction(
  key: ActionControlKey,
  input: unknown,
  base = "",
): Promise<ActionReceipt> {
  const { id } = actionControls[key].input.parse(input);
  if (key === "action.read") {
    const row = await readAction(id, base);
    if (!row) throw Error("Original action not found");
    return row;
  }
  const response = await createPeClient(base, fetch).response(
    key,
    { body: { id } },
    {
      signal: AbortSignal.timeout(30_000),
    },
  );
  if (!response.ok) throw Error(await response.text());
  return actionReceiptSchema.parse(await response.json());
}
export async function readFamilyCapture(
  key: FamilyReadKey,
  input: unknown,
  scope: WorkKey,
  target?: DocumentRef,
  base = "",
) {
  const response = await fetch(`${base}/family/readings`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ key, input, scope, target }),
  });
  if (!response.ok) throw Error(await response.text());
  return familyCaptureSchema.parse(await response.json());
}

export async function readActionStatuses(
  subject: { work?: WorkKey; tool?: string },
  base = "",
  signal?: AbortSignal,
) {
  const query = {
    ...(subject.work ? { work: JSON.stringify(subject.work) } : {}),
    ...(subject.tool ? { tool: subject.tool } : {}),
  };
  const response = await createPeClient(base, fetch).response(
    "actions.read",
    { query },
    { signal },
  );
  if (!response.ok)
    throw Error(`Action list failed (${response.status}): ${await response.text()}`);
  return actionStatusSchema.array().parse(await response.json());
}

/** Retained local admission evidence only; no recovery or dispatch. */
export const inspectRetainedActions = () => structuredClone([...retained.values()]);
