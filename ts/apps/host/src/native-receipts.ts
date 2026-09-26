import {
  nativeProcessSchema,
  nativeReceiptSchema as receiptSchema,
  nativeReceiptFailureSchema as responseFailure,
  type NativeProcess,
} from "@pe/agent-contracts";
import { Effect } from "effect";
import { NodeServices } from "@effect/platform-node";
import {
  opResultArgv,
  sessionListArgv,
  type OpResult,
  type SessionListResult,
} from "@pe/host-contracts/pe-revit-contract";
import type { ActionStep } from "@pe/agent-contracts";
import { runPeRevitCli } from "./session-route.ts";
import { parsePeRevitEnvelope, peRevitLauncher } from "./pe-revit-launch.ts";

export type { NativeProcess } from "@pe/agent-contracts";
export type SdkReceiptReader = (args: readonly string[]) => Promise<string>;
const run: SdkReceiptReader = (args) =>
  Effect.runPromise(
    runPeRevitCli(args).pipe(Effect.provide(NodeServices.layer), Effect.timeout("30 seconds")),
  );
async function sdkResult<A>(args: readonly string[], read: SdkReceiptReader) {
  return parsePeRevitEnvelope<A>(await read(args), args, peRevitLauncher());
}
/** Exact bridge process pair only; a mutable SDK session name is never a recovery selector. */
export async function readOriginalProcess(
  pid: number,
  startMs: number,
  read: SdkReceiptReader = run,
): Promise<NativeProcess> {
  const envelope = await sdkResult<SessionListResult>(sessionListArgv({ all: true }), read);
  if (envelope.diagnostics.length) throw Error("SDK process identity read reported diagnostics");
  const candidates = (envelope.result as SessionListResult).sessions.flatMap((row) =>
    "process" in row ? [row.process] : [],
  );
  const matches = candidates.filter(
    (process) => process.pid === pid && Date.parse(process.processStartUtc) === startMs,
  );
  const identities = [
    ...new Map(matches.map((process) => [JSON.stringify(process), process])).values(),
  ];
  if (identities.length !== 1)
    throw Error("Cannot prove the original bridge process incarnation before dispatch");
  return nativeProcessSchema.parse(identities[0]);
}
/** The SDK owns exact receipt selection and path resolution. No latest-lookup fallback. */
export const nativeReceiptArgs = (
  requestId: string,
  original: NativeProcess,
  key: string,
): string[] => {
  return opResultArgv({
    requestId,
    pid: original.pid,
    processStartUtc: original.processStartUtc,
    key,
  });
};
/** A bridge registration that now serves the original's SDK session from another process. */
export type Successor = {
  readonly sdkSessionId: string;
  readonly pid: number;
  readonly processStartUtcUnixMs: number | null;
};
export async function readNativeReceipt(
  step: ActionStep,
  original: NativeProcess,
  read: SdkReceiptReader = run,
  successor?: Successor,
): Promise<{ step: ActionStep; evidence: unknown }> {
  const args = nativeReceiptArgs(step.id, original, step.key);
  const evidence = await sdkResult<OpResult>(args, read);
  const result = evidence.result;
  const receipt = receiptSchema.safeParse(result.receipt);
  const unchanged = () => ({ step, evidence });
  const codes = evidence.diagnostics.map((diagnostic) => diagnostic.code);
  const replaced =
    successor !== undefined &&
    (successor.pid !== original.pid ||
      successor.processStartUtcUnixMs !== Date.parse(original.processStartUtc));
  // The original process can never answer: the SDK saw it die, or it cannot read the pid
  // (Win32 error 31 after a crash) while the same SDK session re-registered as another process.
  const gone =
    result.requestId === step.id &&
    ((result.state === "abandoned" &&
      codes.includes("op.process-dead") &&
      !codes.includes("op.superseded-terminal")) ||
      (result.state === "pending" && codes.includes("op.liveness-unknown") && replaced));
  if (gone)
    return {
      step: {
        id: step.id,
        key: step.key,
        kind: step.kind,
        input: step.input,
        state: "failed",
        error: `Revit process ${original.pid} ended before '${step.key}' recorded an outcome`,
        status: 503,
        evidence: {
          result: {
            process: original,
            sdk: { state: result.state, diagnostics: evidence.diagnostics },
            ...(replaced ? { successor } : {}),
          },
        },
      },
      evidence: { sdk: evidence, ...(replaced ? { successor } : {}) },
    };
  if (
    result.state !== "completed" ||
    result.requestId !== step.id ||
    !receipt.success ||
    receipt.data.requestId !== step.id ||
    receipt.data.key !== step.key ||
    receipt.data.pid !== original.pid ||
    receipt.data.processStartUtc !== original.processStartUtc ||
    evidence.diagnostics.length
  )
    return unchanged();
  const intent = { id: step.id, key: step.key, kind: step.kind, input: step.input };
  if (receipt.data.verdict === "ok" && result.response !== undefined)
    return { step: { ...intent, state: "succeeded", result: result.response }, evidence };
  const failed = responseFailure.safeParse(result.response);
  if (!failed.success) return unchanged();
  const { error, statusCode: status, outcome: nativeOutcome } = failed.data;
  if (receipt.data.verdict === "cancelled" && status === 499)
    return { step: { ...intent, state: "cancelled", error, status }, evidence };
  // A coarse failed/rejected verdict cannot establish dispatch. Use the native typed outcome only.
  if (
    nativeOutcome &&
    ["CancelledBeforeDispatch", "RefusedQueueUnresponsive", "RefusedQueueDisposed"].includes(
      nativeOutcome,
    )
  )
    return {
      step: { ...intent, state: "failed", error, status, nativeOutcome, notDispatched: true },
      evidence,
    };
  if (receipt.data.verdict === "failed")
    return {
      step: {
        ...intent,
        state: "failed",
        error,
        status,
        ...(nativeOutcome ? { nativeOutcome } : {}),
      },
      evidence,
    };
  return unchanged();
}
