import {
  actionAdmissionSchema,
  instancesActions,
  instancesRouteState,
  sdkSessionTargetOf,
  transitionPatches,
  type InstancesActionKey,
  type InstancesLaunch,
  type WorkKey,
  refusalText,
} from "@pe/agent-contracts";
import type { ActionStep } from "@pe/agent-contracts";
import type { RouteWorkspace } from "@pe/runtime";
import { Effect } from "effect";
import { NodeServices } from "@effect/platform-node";
import {
  docCloseArgv,
  docOpenArgv,
  opResultArgv,
  sessionHrArgv,
  sessionListArgv,
  sessionStartArgv,
  sessionStopArgv,
  type Diagnostic,
  type OpReceiptResponseResult,
  type OpReceiptResult,
  type OpStateResult,
  type SessionListResult,
  type SessionStartResult,
} from "@pe/host-contracts/pe-revit-contract";
import { ActionIncomplete, type ActionJournal } from "./action-journal.ts";
import { BridgeError } from "./bridge.ts";
import { hostOwnership } from "./host-ownership.ts";
import type { SdkReceiptReader } from "./native-receipts.ts";
import { parsePeRevitEnvelope, peRevitLauncher } from "./pe-revit-launch.ts";
import { resolveStartProject, runPeRevitCli } from "./session-route.ts";
import { actionWorkspace } from "./takeoff-actions.ts";

export type InstancesActionDependencies = {
  workspace?: RouteWorkspace;
  sdk?: SdkReceiptReader;
};

const refuse = (message: string, result?: unknown) =>
  new BridgeError(message, 409, {
    notDispatched: true,
    ...(result !== undefined ? { result } : {}),
  });

/** A lifecycle mutation may outlive the 30 s reads use: Revit boots and hot reloads take minutes. */
const mutate: SdkReceiptReader = (args) =>
  Effect.runPromise(
    runPeRevitCli(args).pipe(Effect.provide(NodeServices.layer), Effect.timeout("15 minutes")),
  );

/**
 * Session-verb refusals the CLI raises before it admits or dispatches anything. A session `refused`
 * without one of these may follow an effect (an unconfirmed kill, a blocked stop), so it stays
 * unknown. A doc verb's `refused` never ran (ADR 0009 law 3).
 */
const NOT_DISPATCHED = new Set([
  "op.stale-expectation",
  "op.intent-conflict",
  "op.admission-unavailable",
  "op.request-id-unusable",
  "session.bad-invocation",
  "session.year-mismatch",
  "session.no-sessions-for-year",
]);

/**
 * Recorded per step: the session expectation and the verb argv, with the request id named
 * symbolically. The step id IS the SDK request id, minted only when the step is recorded, so a
 * replay compares the same bytes.
 */
type StepInput = { readonly expectSession: string; readonly argv: readonly string[] };
const REQUEST_ID = "<request-id>";
/** The union of every Instances action input; each verb reads only the fields its schema admitted. */
type InstancesInput = {
  workspaceId: string;
  session?: { id: string; process: { pid: number; processStartUtc: string; executable: string } };
  force?: boolean;
  unsaved?: "keep" | "discard";
  document?: { session: string; openId: string };
};
type Prepared = {
  staged: import("@pe/agent-contracts").InstancesLaunch | null;
  session?: { id: string; process: { pid: number; processStartUtc: string; executable: string } };
};

/** The exact recorded session row for this pid/start pair; a mutable session name never selects. */
async function readRecordedSession(
  session: { id: string; process: { pid: number; processStartUtc: string } },
  read: SdkReceiptReader,
) {
  const args = sessionListArgv({ id: session.id });
  const envelope = parsePeRevitEnvelope<SessionListResult>(
    await read(args),
    args,
    peRevitLauncher(),
  );
  const rows = (envelope.result as SessionListResult).sessions.filter(
    (row: SessionListResult["sessions"][number]) =>
      "process" in row &&
      row.process.pid === session.process.pid &&
      row.process.processStartUtc === session.process.processStartUtc &&
      "receipt" in row,
  );
  if (rows.length !== 1 || envelope.diagnostics.length)
    throw refuse(
      "The supplied session incarnation is not the one the SDK records",
      envelope.result,
    );
  return (rows[0] as { receipt: { receiptPath: string } }).receipt.receiptPath;
}

/** The `--expect-session` a named start passes: `absent`, or the exact row it may retire. */
async function readStartExpectation(id: string, read: SdkReceiptReader): Promise<string> {
  const args = sessionListArgv({ id });
  const envelope = parsePeRevitEnvelope<SessionListResult>(
    await read(args),
    args,
    peRevitLauncher(),
  );
  const rows = (envelope.result as SessionListResult).sessions;
  if (rows.length === 0) return "absent";
  if (rows.length !== 1) throw refuse(`The SDK returned more than one session named '${id}'`);
  const row = rows[0]!;
  if (!("receipt" in row))
    throw refuse(`Session '${id}' is observed but not controlled by this checkout`);
  return row.receipt.receiptPath;
}

/** Run one recorded verb under its step id and settle it from the state the SDK derived (law 10). */
async function dispatch(input: StepInput, requestId: string, read: SdkReceiptReader) {
  const args = input.argv.map((arg) => (arg === REQUEST_ID ? requestId : arg));
  const envelope = parsePeRevitEnvelope(await read(args), args, peRevitLauncher());
  const state = (envelope.result as { state?: string } | null)?.state;
  const said =
    envelope.diagnostics.map((d: Diagnostic) => `${d.code}: ${d.detail}`).join("; ") ||
    `pe-revit ${state ?? "answered no state"}`;
  if (envelope.diagnostics.some((d: Diagnostic) => d.code === "doc.missing-links"))
    throw new BridgeError(said, 409, { dispatched: true, result: envelope });
  if (state === "ok") return envelope.result;
  const doc = args[0] === "doc";
  if (
    (state === "refused" || state === "bad-invocation") &&
    (doc || envelope.diagnostics.some((d: Diagnostic) => NOT_DISPATCHED.has(d.code)))
  )
    throw refuse(said, envelope.result);
  if (doc && state === "failed")
    throw new BridgeError(said, 502, { dispatched: true, result: envelope.result });
  if (doc && state === "cancelled") throw new BridgeError(said, 499, { result: envelope.result });
  // timed-out, abandoned, running, transport-lost, or a session verb that did not finish: the
  // outcome is unknown; a doc verb recovers from its op receipt.
  throw new BridgeError(said, 504, { result: envelope.result });
}

export async function admitInstancesAction(
  raw: unknown,
  owner: ActionJournal,
  deps: InstancesActionDependencies = {},
  resume = false,
) {
  const workspace = deps.workspace ?? actionWorkspace();
  const read = deps.sdk ?? mutate;
  const admission = actionAdmissionSchema.parse(raw);
  const key = admission.key as InstancesActionKey;
  const definition = instancesActions[key];
  if (admission.kind !== "workflow" || !definition) throw refuse("Unknown Instances action");
  if (definition.actor === "human" && admission.actor !== "human")
    throw refuse("This Instances action is human-only");
  admission.input = definition.input.parse(admission.input);
  const input = definition.input.parse(admission.input) as unknown as InstancesInput;
  const session = input.session;
  if (
    session
      ? admission.destination.kind !== "session" || admission.destination.session !== session.id
      : admission.destination.kind !== "host"
  )
    throw refuse("Instances destination must match the explicitly supplied session");
  return owner.admit(
    admission,
    async () => {
      const base = admission.bases.work;
      if (!workspace || !base || base.key.work !== input.workspaceId)
        throw refuse("An explicit Instances Work address and revision are required");
      const view = await workspace.read(base.key, "instances");
      if (!view || view.revision !== base.revision) throw refuse("Instances Work changed");
      // Open/start launch the person's staged value only; a Pea proposal never arms a launch.
      const { launch } = instancesRouteState.schema.parse(view.doc);
      const staged = launch.staged ? launch.staged.value : null;
      const wants = key === "instances.start" ? "start" : key === "instances.open" ? "open" : null;
      if (wants && staged?.kind !== wants && launch.proposal?.value?.kind === wants)
        throw refuse(`Pea proposed this ${wants}; a person stages it first`);
      if (key === "instances.start" && staged?.kind !== "start")
        throw refuse("Stage a start first");
      if (
        key === "instances.open" &&
        (staged?.kind !== "open" || sdkSessionTargetOf(staged.session) !== session?.id)
      )
        throw refuse(
          "The staged open belongs to another session; explicitly stage the requested session",
        );
      return { kind: "instances", staged, session, input: admission.input };
    },
    async (execution) => {
      const { staged, session: incarnation } = execution.prepared as Prepared;
      // The expectation is resolved once, before the step is recorded, so a replay compares the same bytes.
      const prior = execution.recorded("native", key);
      const expectSession = prior
        ? (prior.input as StepInput).expectSession
        : incarnation
          ? await readRecordedSession(incarnation, read)
          : key === "instances.start" && staged?.kind === "start" && staged.name
            ? await readStartExpectation(staged.name, read)
            : "absent";
      const id = incarnation?.id;
      const requestId = REQUEST_ID;
      const argv = () => {
        switch (key) {
          case "instances.start":
            if (staged?.kind !== "start") throw refuse("Stage a start first");
            return sessionStartArgv({
              project: resolveStartProject(hostOwnership.lane, hostOwnership.sourceRoot),
              year: staged.year,
              id: staged.name || undefined,
              quarantine: staged.quarantine,
              requestId,
              expectSession,
            });
          case "instances.open":
            if (staged?.kind !== "open") throw refuse("Stage an open first");
            return docOpenArgv({
              source: staged.document,
              id,
              links: staged.missingLinks,
              conflict: "keep",
              requestId,
              expectSession,
              expectDoc: "absent",
            });
          case "instances.restart":
            return sessionHrArgv({
              id,
              restart: true,
              requestId,
              expectSession,
            });
          case "instances.stop":
            return sessionStopArgv({
              id: id!,
              unsaved: input.unsaved!,
              force: input.force,
              requestId,
              expectSession,
            });
          case "instances.close":
            return docCloseArgv({
              doc: input.document!.openId,
              id,
              unsaved: input.unsaved!,
              requestId,
              expectSession,
              expectDoc: input.document!.openId,
            });
        }
      };
      // The step id IS the SDK request id: one caller-owned identity from admission to receipt.
      const stepInput: StepInput = { expectSession, argv: argv() };
      const native = await execution.step("native", key, stepInput, (requestId) =>
        dispatch(stepInput, requestId, read),
      );
      const openStarted = (started: SessionStartResult, document: string, links: string) => {
        const openInput: StepInput = {
          expectSession: started.session.receipt.receiptPath,
          argv: docOpenArgv({
            source: document,
            id: started.id,
            links,
            conflict: "keep",
            requestId,
            expectSession: started.session.receipt.receiptPath,
            expectDoc: "absent",
          }),
        };
        return execution.step("native", `${key}.open`, openInput, (requestId) =>
          dispatch(openInput, requestId, read),
        );
      };
      // A start that stages a document opens it as its own receipted op in the session it just
      // started: `doc open --start` cannot name the session it would launch.
      const opened =
        key === "instances.start" && staged?.kind === "start" && staged.document
          ? await openStarted(native as SessionStartResult, staged.document, staged.missingLinks)
          : undefined;
      const result = opened === undefined ? native : { session: native, document: opened };
      // Proven success consumed the staged launch: retire it (journaled once) so a second press
      // does not launch again. A failure, refusal or unknown outcome threw above and keeps it.
      if ((key === "instances.start" || key === "instances.open") && staged && workspace) {
        const base = admission.bases.work!;
        const retired = await execution.step("publication", "work.retire", staged, () =>
          retireLaunch(workspace, base.key, staged),
        );
        await execution.publish({ native: result, retired });
      }
      return result;
    },
    resume,
  );
}

/**
 * Retires the consumed launch under the unchanged-cell rule: `staged` clears only if it still
 * equals what launched, and a proposal equal to it clears too; a newer edit survives. Retirement
 * is the host's transition, not Pea's authorship, so it writes with the person's rights (the
 * agent mask would refuse a Pea-admitted launch's retirement).
 */
async function retireLaunch(workspace: RouteWorkspace, key: WorkKey, consumed: InstancesLaunch) {
  // ponytail: three attempts; a Work that moves three times in one retirement is reported, not chased.
  for (let attempt = 0; attempt < 3; attempt++) {
    const view = await workspace.read(key, "instances");
    if (!view) return { retired: false };
    const { launch } = instancesRouteState.schema.parse(view.doc);
    const patches = transitionPatches([], "launch", launch, {
      kind: "retire",
      consumed: { value: consumed },
    });
    if (!patches.length) return { retired: false, revision: view.revision };
    const landed = await workspace.apply(key, "instances", "human", patches, view.revision);
    if (landed.ok) return { retired: true, revision: landed.revision };
    if (landed.code !== "stale_revision")
      throw new ActionIncomplete(
        `Launched; retiring the staged launch was refused: ${refusalText(landed)}`,
        landed,
      );
  }
  throw new ActionIncomplete(
    "Launched; Work kept moving, so the staged launch was not retired",
    {},
  );
}

type OpRead = OpReceiptResponseResult | OpReceiptResult | OpStateResult;

/**
 * Settle a lost doc-verb invocation from the SDK op receipt under the original request id. A
 * session verb has no op receipt, and the SDK's only read-back for it is re-issuing the same
 * request id, which would dispatch a request that was never admitted; it stays unknown.
 */
export const recoverInstancesAction = (
  id: string,
  owner: ActionJournal,
  deps: InstancesActionDependencies = {},
) =>
  owner.recover(id, async (step: ActionStep) => {
    const read = deps.sdk ?? mutate;
    if ((step.input as StepInput).argv[0] !== "doc")
      return {
        step,
        evidence: {
          unreadable:
            "A session verb has no op receipt and the SDK has no read-only admission read; re-issuing its request id would dispatch it",
        },
      };
    const args = opResultArgv({ requestId: step.id });
    const evidence = parsePeRevitEnvelope<OpRead>(await read(args), args, peRevitLauncher());
    const result = evidence.result;
    if (result.requestId !== step.id) return { step, evidence };
    const intent = { id: step.id, key: step.key, kind: step.kind, input: step.input };
    const answered = "response" in result;
    if (result.state === "ok" && answered)
      return { step: { ...intent, state: "succeeded", result: result.response ?? null }, evidence };
    // A refusal never ran (ADR 0009 law 3); `op.unknown-request` means it was never admitted.
    if (result.state === "refused")
      return {
        step: {
          ...intent,
          state: "failed",
          error: evidence.diagnostics.some((d) => d.code === "op.unknown-request")
            ? "The SDK never admitted this action; nothing was dispatched"
            : `The SDK refused this admitted action${"error" in step && step.error ? `: ${step.error}` : ""}`,
          status: 409,
          notDispatched: true,
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
  });
