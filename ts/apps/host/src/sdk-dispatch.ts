import { Effect } from "effect";
import { NodeServices } from "@effect/platform-node";
import type { ActionStep } from "@pe/agent-contracts";
import {
  opCancelArgv,
  opResultArgv,
  sessionListArgv,
  type Diagnostic,
  type SessionObservation,
  type SessionListResult,
  type OpReceiptResponseResult,
  type OpReceiptResult,
  type OpStateResult,
} from "@pe/host-contracts/pe-revit-contract";
import { parsePeRevitEnvelope, peRevitLauncher } from "./pe-revit-launch.ts";
import { runPeRevitCli } from "./session-route.ts";
import { refused, StepFailure } from "./command-executor.ts";
import { markDispatched, validateDispatch } from "./action-dispatch.ts";
import type { ActionExecution, StepOptions } from "./action-journal.ts";
import type { SdkReceiptReader } from "./native-receipts.ts";

/** SDK supervisor requests and Revit requests share one UUID, but have different refusal evidence. */
export const SDK_REQUEST_ID = "<request-id>";
export type SdkStepInput = { readonly expectSession?: string; readonly argv: readonly string[] };
export const readSdk = (
  args: readonly string[],
  timeout: "2 minutes" | "15 minutes" = "15 minutes",
) =>
  Effect.runPromise(
    runPeRevitCli(args).pipe(Effect.provide(NodeServices.layer), Effect.timeout(timeout)),
  );
export const sdkEnvelope = async <T, R = unknown>(
  args: readonly string[],
  read: SdkReceiptReader = readSdk,
) => parsePeRevitEnvelope<T, R>(await read(args), args, peRevitLauncher());

const NOT_DISPATCHED = new Set([
  "op.stale-expectation",
  "op.intent-conflict",
  "op.admission-unavailable",
  "op.request-id-unusable",
  "session.dialog-identity-required",
  "session.dialog-identity-stale",
  "session.dialog-receiver-unavailable",
  "session.bad-invocation",
  "session.year-mismatch",
  "session.no-sessions-for-year",
]);

export async function namedSdkSession(id: string, read: SdkReceiptReader) {
  const args = sessionListArgv({ all: true });
  const envelope = await sdkEnvelope<SessionListResult>(args, read);
  const rows = envelope.result.sessions.filter((row) => "id" in row && row.id === id);
  if (envelope.diagnostics.length || rows.length > 1)
    throw refused(`The SDK does not name one session '${id}'`);
  return (rows[0] as Exclude<SessionObservation, { case: "observed-active" }> | undefined) ?? null;
}

/** Only parsed SDK outcomes attest dispatch. CLI entry alone proves no native effect. */
export async function dispatchSdk(
  input: SdkStepInput,
  requestId: string,
  read: SdkReceiptReader = readSdk,
  keepEnvelope = false,
) {
  const args = input.argv.map((arg) => (arg === SDK_REQUEST_ID ? requestId : arg));
  const invalid = await validateDispatch(requestId);
  if (invalid)
    throw new StepFailure(invalid, /cancel|consent.stopped/i.test(invalid) ? 499 : 409, "refused");
  const envelope = await sdkEnvelope<unknown>(args, read);
  const result = envelope.result as {
    state?: string;
    legs?: readonly unknown[];
    ok?: boolean;
  } | null;
  const state = result?.state;
  const said =
    envelope.diagnostics.map((d) => `${d.code}: ${d.detail}`).join("; ") ||
    `pe-revit ${state ?? "answered no state"}`;
  if (args[0] === "bootstrap") {
    if (envelope.exitCode !== 0 || !result?.ok || envelope.diagnostics.length)
      throw new StepFailure(
        "Bootstrap operation failed; inspect the SDK envelope.",
        502,
        "failed",
        envelope,
      );
    await markDispatched(requestId);
    return envelope;
  }
  if (envelope.diagnostics.some((d) => d.code === "doc.missing-links")) {
    await markDispatched(requestId);
    throw new StepFailure(said, 409, "failed", envelope);
  }
  if (!state && (envelope.exitCode === 2 || envelope.exitCode === 3))
    throw new StepFailure(said, 409, "refused", result);
  if (state === "ok") {
    await markDispatched(requestId);
    return keepEnvelope ? envelope : envelope.result;
  }
  if (result?.legs?.length) await markDispatched(requestId);
  const doc = args[0] === "doc";
  if (
    (state === "refused" || state === "bad-invocation") &&
    (doc || (!result?.legs?.length && envelope.diagnostics.some((d) => NOT_DISPATCHED.has(d.code))))
  )
    throw new StepFailure(said, 409, "refused", args[1] === "dialogs" ? envelope : result);
  if (doc && state === "failed") {
    await markDispatched(requestId);
    throw new StepFailure(said, 502, "failed", result);
  }
  if (doc && state === "cancelled") throw new StepFailure(said, 499, "cancelled", result);
  throw new StepFailure(said, 504, "unknown", result);
}

export const runSdk = <A = unknown>(
  execution: ActionExecution,
  key: string,
  input: SdkStepInput,
  read: SdkReceiptReader = readSdk,
  options?: StepOptions<A>,
  keepEnvelope = false,
) =>
  execution.step(
    "native",
    key,
    input,
    (id) => dispatchSdk(input, id, read, keepEnvelope) as Promise<A>,
    options,
  );

type OpRead = OpReceiptResponseResult | OpReceiptResult | OpStateResult;
type SupervisorResponse = {
  verdict?: string;
  code?: string;
  resolved?: unknown;
  result?: { state?: string; legs?: readonly unknown[] } | null;
};

/**
 * Settle lost document and supervisor invocations from their durable SDK op receipts.
 * Reading a receipt never re-dispatches the original request.
 */
export async function recoverSdkStep(step: ActionStep, read: SdkReceiptReader = readSdk) {
  if (step.state === "succeeded" && step.result && typeof step.result === "object")
    return { step, evidence: { recordedNativeOutcome: true } };
  const argv = (step.input as SdkStepInput).argv;
  const supervisor = argv[0] === "session";
  const args = opResultArgv({ requestId: step.id });
  const evidence = await sdkEnvelope<OpRead>(args, read);
  const result = evidence.result;
  if (result.requestId !== step.id) return { step, evidence };
  const intent = { id: step.id, key: step.key, kind: step.kind, input: step.input };
  const answered = "response" in result && result.response != null;
  const unknownRequest = evidence.diagnostics.some((d) => d.code === "op.unknown-request");
  // The process the SDK recorded running it is gone: it never completes (W2 20). A document op
  // ran in that Revit, so its lifetime ended with it; a start is done only if its session lives.
  if (
    result.state === "abandoned" &&
    evidence.diagnostics.some((d) => d.code === "op.process-dead")
  ) {
    const at = argv.indexOf("--id");
    const named = supervisor && argv[1] === "start" && at > 0 ? argv[at + 1]! : null;
    if (supervisor && !named) return { step, evidence };
    const row = named ? await namedSdkSession(named, read) : null;
    if (row?.case === "controlled-active")
      return {
        step: { ...intent, state: "succeeded", result: { state: "ok", id: named, session: row } },
        evidence,
      };
    if (row?.case === "controlled-pending") return { step, evidence };
    return {
      step: {
        ...intent,
        state: "failed",
        error: supervisor
          ? `The pe-revit running it is gone and session '${named}' is ${row?.case ?? "not registered"}`
          : "The Revit running it is gone; what it did in that Revit ended with it",
        status: 410,
        // A dead supervisor plus an absent/ended named session proves this created
        // lifetime cannot finish. A new request may replace it, never replay it.
        ...(supervisor ? { retired: true } : {}),
      },
      evidence,
    };
  }
  let response: unknown = answered ? result.response : undefined;
  let notDispatched = !supervisor || unknownRequest;
  if (supervisor && !unknownRequest) {
    const receipt =
      "receipt" in result
        ? (result.receipt as { requestId?: string; key?: string; verdict?: string } | null)
        : null;
    if (
      !answered ||
      receipt?.requestId !== step.id ||
      receipt.key !== `session.${argv[1]}` ||
      receipt.verdict !== result.state
    )
      return { step, evidence };
    // The supervisor's op response (recorded, beta.208): the verb's result and resolution, not
    // its CLI envelope; a refusal names its one code.
    const answer = response as SupervisorResponse;
    if (answer.verdict !== result.state || (answer.result && answer.result.state !== result.state))
      return { step, evidence };
    notDispatched = !answer.result?.legs?.length && NOT_DISPATCHED.has(answer.code ?? "");
    // Adoption needs resolved process evidence on resume; other supervisors return their payload.
    response = step.key.endsWith(".adopt")
      ? { result: answer.result, resolved: answer.resolved }
      : answer.result;
  }
  if (result.state === "ok" && answered)
    return { step: { ...intent, state: "succeeded", result: response ?? null }, evidence };
  // A document refusal never ran; a supervisor refusal can follow completed effect legs.
  if (result.state === "refused" && (answered || unknownRequest))
    return {
      step: {
        ...intent,
        state: "failed",
        error: unknownRequest
          ? "The SDK never admitted this action; nothing was dispatched"
          : `The SDK refused this admitted action${"error" in step && step.error ? `: ${step.error}` : ""}`,
        status: 409,
        ...(notDispatched ? { notDispatched: true } : {}),
      },
      evidence,
    };
  if (result.state === "failed" && answered)
    return {
      step: {
        ...intent,
        state: "failed",
        error: "The SDK recorded this action failed",
        status: 502,
      },
      evidence,
    };
  if (result.state === "cancelled" && answered)
    return {
      step: {
        ...intent,
        state: "cancelled",
        error: "The SDK cancelled this action",
        status: 499,
      },
      evidence,
    };
  // running, timed-out, abandoned: the work may still land; it stays unknown.
  return { step, evidence };
}

/**
 * Cancel a running Instances action through the SDK: its native step id IS the SDK request id.
 * A supervisor op refuses (`op.supervisor-not-cancellable`) and the refusal is the answer.
 */
export async function cancelSdkStep(requestId: string, read: SdkReceiptReader = readSdk) {
  const args = opCancelArgv({ requestId });
  const envelope = await sdkEnvelope(args, read);
  if (envelope.diagnostics.length)
    throw Error(envelope.diagnostics.map((d: Diagnostic) => `${d.code}: ${d.detail}`).join("; "));
}
