import { actionListFilterSchema, type ActionListFilter } from "@pe/agent-contracts";
import {
  HOST_RPC_BRIDGE_SESSION_HEADER,
  HOST_RPC_DOCUMENT_HEADER,
} from "@pe/host-contracts/operation-types";
import {
  canonicalRouteInput,
  semanticActions,
  actionReceiptSchema,
  actionStatusSchema,
  actionControls,
  type ActionControlKey,
  type ActionAdmission,
  type ActionBases,
  type DocumentRef,
  type ActionReceipt,
  type TakeoffActionKey,
  type SemanticActionKey,
  familyCaptureSchema,
  type FamilyReadKey,
  type WorkKey,
} from "@pe/agent-contracts";
import { readTakeoffObservation } from "./takeoff-capture-client.ts";

const retained = new Map<string, ActionAdmission>();
const retentionKey = (base: string, key: string, target: DocumentRef | undefined, path: unknown) =>
  `pe-action:${base}:${key}:${target ? `${target.session}:${target.openId}` : String(path)}`;
function getRetained(key: string) {
  try {
    const saved = (
      Object.hasOwn(globalThis, "window") ? globalThis.localStorage : undefined
    )?.getItem(key);
    if (saved) return JSON.parse(saved) as ActionAdmission;
  } catch {
    /* unavailable outside a browser */
  }
  return retained.get(key);
}
function retain(key: string, value?: ActionAdmission) {
  if (value) retained.set(key, value);
  else retained.delete(key);
  try {
    if (value)
      (Object.hasOwn(globalThis, "window") ? globalThis.localStorage : undefined)?.setItem(
        key,
        JSON.stringify(value),
      );
    else
      (Object.hasOwn(globalThis, "window") ? globalThis.localStorage : undefined)?.removeItem(key);
  } catch {
    /* the process reference still retains identity */
  }
}
/**
 * Admissions this client has posted and not yet seen settle, so a stop control can name them.
 * Keyed by id; the value is the endpoint that owns the journal row.
 */
const inFlight = new Map<string, string>();
export const runningAdmissions = () => [...inFlight].map(([id, base]) => ({ id, base }));

/**
 * Stop a running action: the host signals its in-flight bridge request past the session gate, and
 * the row settles `cancelled` at the operation's next checkpoint. Work already written stands.
 */
export async function cancelAction(id: string, base = "") {
  const response = await fetch(`${base}/actions/cancel`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw Error(await response.text());
  return actionReceiptSchema.parse(await response.json());
}

/** Stop everything this client still has in flight. Each refusal is the caller's to report. */
export const cancelRunningAdmissions = () =>
  Promise.allSettled(runningAdmissions().map(({ id, base }) => cancelAction(id, base)));

export async function readActionStatuses(target: DocumentRef, base = "", signal?: AbortSignal) {
  const response = await fetch(`${base}/actions`, {
    headers: {
      [HOST_RPC_BRIDGE_SESSION_HEADER]: target.session,
      [HOST_RPC_DOCUMENT_HEADER]: target.openId,
    },
    signal,
  });
  if (!response.ok) throw Error(`Action status read failed (${response.status})`);
  return actionStatusSchema.array().parse(await response.json());
}
export async function readAction(id: string, base = "", signal?: AbortSignal) {
  const response = await fetch(`${base}/actions?id=${encodeURIComponent(id)}`, { signal });
  if (!response.ok) throw Error(`Action recovery failed (${response.status})`);
  return actionReceiptSchema.array().parse(await response.json())[0];
}
export async function runSemanticAction(
  key: SemanticActionKey,
  input: Record<string, unknown>,
  target: DocumentRef | undefined,
  bases: ActionBases = {},
  actor: "human" | "agent" = "human",
  base = "",
  id?: string | (() => string),
  waitMs = Infinity,
): Promise<ActionReceipt | DetachedAction> {
  const storageKey = retentionKey(base, key, target, input.path);
  let prior = typeof id === "string" ? undefined : getRetained(storageKey);
  // Reuse the admitted bases as well as ID after lost acceptance/remount, before reading newer Work/file state.
  if (prior && canonicalRouteInput(prior.input) !== canonicalRouteInput(input)) {
    // A retained admission that already settled is history, not a conflict: discard it and admit
    // the new input. Only a STILL RUNNING one refuses, and it names the control that ends it.
    const live = await readAction(prior.id, base).catch(() => undefined);
    if (live?.state === "running")
      throw Error(`Action '${prior.id}' is still running; stop it before changing its input`);
    retain(storageKey);
    prior = undefined;
  }
  let admission = prior;
  if (!admission) {
    const consumed = { ...bases };
    if (key === "takeoffs.sync") {
      if (!consumed.captureId) {
        const observation = await readTakeoffObservation(target!, base);
        if (observation.kind !== "ready") throw Error("Sync needs a current reviewed capture");
        consumed.captureId = observation.capture.id;
      }
      if (!consumed.fileVersion) {
        const response = await fetch(
          `${base}/actions?file=${encodeURIComponent(String(input.path))}`,
        );
        if (!response.ok) throw Error("Could not read the RHVAC file base");
        consumed.fileVersion = ((await response.json()) as { fileVersion: string }).fileVersion;
      }
    }
    admission = {
      id: typeof id === "function" ? id() : (id ?? crypto.randomUUID()),
      kind: "workflow",
      key,
      actor,
      destination:
        key.startsWith("instances.") &&
        input.session &&
        typeof input.session === "object" &&
        "id" in input.session
          ? { kind: "session", session: String(input.session.id) }
          : target
            ? { kind: "document", ref: target }
            : { kind: "host" },
      input,
      bases: consumed,
    };
    if (typeof id !== "string") retain(storageKey, admission);
  }
  const row = await submitAction(admission, base, waitMs);
  if (row.state !== "running" && row.state !== "unknown" && row.state !== "detached")
    retain(storageKey);
  return row;
}
/** Submit an already frozen exact intent; retries never consult a live catalog or replace its ID. */
export async function submitAction(
  admission: ActionAdmission,
  base = "",
  waitMs = Infinity,
): Promise<ActionReceipt | DetachedAction> {
  const deadline = Date.now() + waitMs;
  const signal = () => AbortSignal.timeout(Math.max(1, Math.min(30_000, deadline - Date.now())));
  /*
   * The POST answers once the host has prepared the action, which waits its turn on the Revit
   * queue; aborting it abandoned a plan the host went on to finish (w8-revit trip 10). It waits
   * as long as the caller does; the caller's verb reads running meanwhile.
   */
  const admitted = () =>
    Number.isFinite(deadline) ? AbortSignal.timeout(Math.max(1, deadline - Date.now())) : undefined;
  const detached = (acceptance: DetachedAction["acceptance"]): DetachedAction => ({
    state: "detached",
    kind: admission.kind,
    id: admission.id,
    key: admission.key,
    acceptance,
  });
  let row: ActionReceipt | undefined;
  let response: Response | undefined;
  try {
    response = await fetch(`${base}/actions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(admission),
      signal: admitted(),
    });
  } catch (error) {
    if (Date.now() >= deadline) return detached("unknown");
    row = await readAction(admission.id, base, signal()).catch(() => undefined);
    if (!row) {
      if (Date.now() >= deadline) return detached("unknown");
      throw error;
    }
  }
  if (response) {
    if (!response.ok) throw Error(`Action '${admission.id}' refused: ${await response.text()}`);
    row = actionReceiptSchema.parse(await response.json());
  }
  if (!row) throw Error(`Action '${admission.id}' has no receipt`);
  inFlight.set(admission.id, base);
  try {
    if (
      row.kind !== admission.kind ||
      row.key !== admission.key ||
      row.actor !== admission.actor ||
      canonicalRouteInput(row.request) !== canonicalRouteInput(admission.input) ||
      canonicalRouteInput(row.destination) !== canonicalRouteInput(admission.destination) ||
      canonicalRouteInput(row.bases) !== canonicalRouteInput(admission.bases)
    )
      throw Error(`Action '${admission.id}' receipt conflicts with the requested intent`);
    while (row.state === "running") {
      if (Date.now() >= deadline) return detached("admitted");
      await new Promise((resolve) => setTimeout(resolve, 250));
      const next = await readAction(admission.id, base, signal()).catch((error) => {
        if (Date.now() >= deadline) return undefined;
        throw error;
      });
      if (!next && Date.now() >= deadline) return detached("admitted");
      row = next;
      if (!row) throw Error(`Action '${admission.id}' lost its durable receipt`);
    }
    return row;
  } finally {
    inFlight.delete(admission.id);
  }
}
export function actionResult(row: ActionReceipt | DetachedAction): unknown {
  if (row.state !== "succeeded")
    throw Error(`${row.id}: ${row.state}: ${"error" in row ? row.error : "outcome pending"}`);
  return row.result;
}

export type DetachedAction = {
  state: "detached";
  kind: "operation" | "workflow";
  id: string;
  key: string;
  acceptance: "admitted" | "unknown";
};
export async function controlAction(
  key: ActionControlKey,
  input: unknown,
  base = "",
  actor?: "human" | "agent",
): Promise<ActionReceipt> {
  const { id } = actionControls[key].input.parse(input);
  if (key === "action.read") {
    const row = await readAction(id, base);
    if (!row) throw Error("Original action not found");
    return row;
  }
  const response = await fetch(`${base}/actions/${key.slice("action.".length)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id, ...(actor ? { actor } : {}) }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw Error(await response.text());
  return actionReceiptSchema.parse(await response.json());
}

export const runTakeoffAction = (
  key: TakeoffActionKey,
  ...args: Parameters<typeof runSemanticAction> extends [unknown, ...infer Rest] ? Rest : never
) => runSemanticAction(key, ...args);
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
export async function readFamilyCaptures(scope: WorkKey, base = "") {
  const response = await fetch(
    `${base}/family/readings?${new URLSearchParams({ scope: JSON.stringify(scope) }).toString()}`,
  );
  if (!response.ok) throw Error(await response.text());
  return familyCaptureSchema.array().parse(await response.json());
}

export async function saveSettingsAction(
  scope: WorkKey,
  document: import("@pe/agent-contracts").SettingsRouteDocument,
  revision: number,
  base = "",
  id?: string,
) {
  if (scope.work === undefined || !document.basis) throw Error("An adopted file Work is required");
  const input = semanticActions["settings.write"].input.parse({
    member: document.basis.member,
    write: { kind: "save", sha256: document.basis.sha256 },
  });
  return runSemanticAction(
    "settings.write",
    input,
    undefined,
    { work: { key: scope, revision } },
    "human",
    base,
    id,
  );
}

export async function readScopedActionStatuses(
  scope: ActionListFilter,
  base = "",
  signal?: AbortSignal,
  include?: string,
) {
  const query = new URLSearchParams({ scope: JSON.stringify(actionListFilterSchema.parse(scope)) });
  if (include) query.set("include", include);
  const response = await fetch(`${base}/actions?${query.toString()}`, { signal });
  if (!response.ok)
    throw Error(`Action list failed (${response.status}): ${await response.text()}`);
  return actionStatusSchema.array().parse(await response.json());
}

/** Retained local admission evidence only; no recovery or dispatch. */
export const inspectRetainedActions = () => structuredClone([...retained.values()]);

/** Retire only the explicitly disposed isolated endpoint's retained browser admissions. */
export function releaseDemoAdmissions(base: string) {
  if (!/^\/demo\/instances\/demo-[\w-]+$/.test(base))
    throw Error("Exact isolated demo endpoint required");
  for (const key of retained.keys()) if (key.startsWith(`pe-action:${base}:`)) retain(key);
}
