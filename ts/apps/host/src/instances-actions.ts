import {
  actionAdmissionSchema,
  instancesActions,
  instancesLaunchSchema,
  instancesSessionSelection,
  instancesStartSchema,
  type SdkSessionSelection,
  type SdkDocumentRef,
  canonicalRouteInput,
  type InstancesActionKey,
  type InstancesLaunch,
} from "@pe/agent-contracts";
import type { ActionStep } from "@pe/agent-contracts";
import { Effect } from "effect";
import { NodeServices } from "@effect/platform-node";
import {
  docCloseArgv,
  docListArgv,
  type DocListResult,
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
  type Resolved,
  type SessionListResult,
  type SessionObservation,
  type SessionStartResult,
} from "@pe/host-contracts/pe-revit-contract";
import type { ActionJournal, Crossing } from "./action-journal.ts";
import { BridgeError } from "./bridge.ts";
import { hostOwnership } from "./host-ownership.ts";
import type { SdkReceiptReader } from "./native-receipts.ts";
import { parsePeRevitEnvelope, peRevitLauncher } from "./pe-revit-launch.ts";
import { peaSourceOf, type PeaSource } from "./pea-source.ts";
import { productPeaWorkPath } from "./product-paths.ts";
import { resolveStartProject, runPeRevitCli } from "./session-route.ts";
import { whoseOf } from "./whose.ts";

export type InstancesActionDependencies = {
  sdk?: SdkReceiptReader;
  /** Where Pea's copies go; the product's pea-work folder by default. */
  peaWork?: string;
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
type SessionSelection = SdkSessionSelection | { id?: undefined };
type StepInput = {
  readonly expectSession?: string;
  readonly argv: readonly string[];
};
const REQUEST_ID = "<request-id>";
type Incarnation = {
  selection: SdkSessionSelection;
  process: { pid: number; processStartUtc: string; executable: string };
};
/** The input of restart, stop and close: an exact session incarnation, and what each verb adds. */
type ControlInput = {
  session: Incarnation;
  force?: boolean;
  unsaved?: "keep" | "discard";
  document?: SdkDocumentRef;
};
/** The SDK row an action acts on, resolved once at preparation and frozen with the attempt. */
type Target = {
  selection: SdkSessionSelection;
  /** The row's receipt path; null for an icon-started Revit, which the SDK adopts first. */
  expectSession: string | null;
  process: { pid: number; processStartUtc: string };
  posture: "foreground" | "background";
};
type Prepared = {
  target: Target | null;
  /** A launch that is Pea's: the path it opens and whether it opens detached. */
  pea: PeaSource | null;
};

type RunningRow = Extract<SessionObservation, { case: "controlled-active" | "observed-active" }>;

/**
 * The one running SDK session a selection names. With an expected incarnation, a row of any other
 * pid/start pair is refused: a mutable session name alone never selects a restarted Revit.
 */
async function readTarget(
  selection: SdkSessionSelection,
  expected: { pid: number; processStartUtc: string } | undefined,
  read: SdkReceiptReader,
): Promise<Target> {
  const args = sessionListArgv(selection);
  const envelope = parsePeRevitEnvelope<SessionListResult>(
    await read(args),
    args,
    peRevitLauncher(),
  );
  const rows = (envelope.result as SessionListResult).sessions.filter(
    (row): row is RunningRow =>
      (row.case === "controlled-active" || row.case === "observed-active") &&
      (!expected ||
        (row.process.pid === expected.pid &&
          row.process.processStartUtc === expected.processStartUtc)),
  );
  if (rows.length !== 1 || envelope.diagnostics.length)
    throw refuse(
      expected
        ? "The supplied session incarnation is not the one the SDK records"
        : "The selection does not name exactly one running session",
      envelope.result,
    );
  const row = rows[0]!;
  const target = {
    process: { pid: row.process.pid, processStartUtc: row.process.processStartUtc },
    posture: row.shape.posture,
  };
  if (row.case === "observed-active")
    return { ...target, selection: { pid: row.process.pid }, expectSession: null };
  if ("id" in selection && row.id !== selection.id)
    throw refuse(
      "The supplied session name does not match the SDK process receipt",
      envelope.result,
    );
  return { ...target, selection, expectSession: row.receipt.receiptPath };
}

/** Run one recorded verb under its step id and settle it from the state the SDK derived (law 10). */
async function dispatch(
  input: StepInput,
  requestId: string,
  read: SdkReceiptReader,
  keepEnvelope = false,
) {
  const args = input.argv.map((arg) => (arg === REQUEST_ID ? requestId : arg));
  const envelope = parsePeRevitEnvelope(await read(args), args, peRevitLauncher());
  const state = (envelope.result as { state?: string } | null)?.state;
  const said =
    envelope.diagnostics.map((d: Diagnostic) => `${d.code}: ${d.detail}`).join("; ") ||
    `pe-revit ${state ?? "answered no state"}`;
  if (envelope.diagnostics.some((d: Diagnostic) => d.code === "doc.missing-links"))
    throw new BridgeError(said, 409, { dispatched: true, result: envelope });
  if (!state && (envelope.exitCode === 2 || envelope.exitCode === 3))
    throw refuse(said, envelope.result);
  if (state === "ok") return keepEnvelope ? envelope : envelope.result;
  const doc = args[0] === "doc";
  if (
    (state === "refused" || state === "bad-invocation") &&
    (doc ||
      (!(envelope.result as { legs?: readonly unknown[] }).legs?.length &&
        envelope.diagnostics.some((d: Diagnostic) => NOT_DISPATCHED.has(d.code))))
  )
    throw refuse(said, envelope.result);
  if (doc && state === "failed")
    throw new BridgeError(said, 502, { dispatched: true, result: envelope.result });
  if (doc && state === "cancelled") throw new BridgeError(said, 499, { result: envelope.result });
  // timed-out, abandoned, running, transport-lost, or a session verb that did not finish: the
  // outcome is unknown; recovery reads the durable op receipt.
  throw new BridgeError(said, 504, { result: envelope.result });
}

export async function admitInstancesAction(
  raw: unknown,
  crossing: Crossing,
  owner: ActionJournal,
  deps: InstancesActionDependencies = {},
  resume = false,
) {
  const read = deps.sdk ?? mutate;
  const admission = actionAdmissionSchema.parse(raw);
  const key = admission.key as InstancesActionKey;
  const definition = instancesActions[key];
  if (admission.kind !== "workflow" || !definition) throw refuse("Unknown Instances action");
  admission.input = definition.input.parse(admission.input);
  const input = admission.input;
  const launch = key === "instances.open" ? instancesLaunchSchema.parse(input) : null;
  const start =
    key === "instances.start"
      ? instancesStartSchema.parse(input)
      : launch && "start" in launch.into
        ? launch.into.start
        : null;
  const control = launch || start ? null : (input as unknown as ControlInput);
  const selection = instancesSessionSelection(input);
  if (
    selection
      ? admission.destination.kind !== "sdk-session" ||
        canonicalRouteInput(admission.destination.selection) !== canonicalRouteInput(selection)
      : admission.destination.kind !== "host"
  )
    throw refuse("Instances destination must match the explicitly supplied session");
  return owner.admit(
    { ...admission, ...crossing },
    async (): Promise<Prepared> => {
      if (key === "instances.close") {
        const { session, document } = control!;
        if (
          !document ||
          canonicalRouteInput(document.session) !== canonicalRouteInput(session.selection)
        )
          throw refuse("SDK document belongs to another session");
        const argv = docListArgv(document.session);
        const envelope = parsePeRevitEnvelope<DocListResult, Resolved | null>(
          await read(argv),
          argv,
          peRevitLauncher(),
        );
        if (
          envelope.exitCode !== 0 ||
          envelope.result.state !== "ok" ||
          envelope.resolved?.pid !== session.process.pid ||
          envelope.resolved.processStartUtc !== session.process.processStartUtc ||
          !envelope.result.documents.some((doc) => doc.openId === document.openId)
        )
          throw refuse("The SDK document lifetime is not open in the original process", envelope);
      }
      // The session row is read once, here, and frozen with the attempt so a replay compares the
      // same bytes. A launch's posture is derived from it, never passed (ADR 0016).
      const target = control
        ? await readTarget(control.session.selection, control.session.process, read)
        : launch && "session" in launch.into
          ? await readTarget(launch.into.session, undefined, read)
          : null;
      const whose = target ? whoseOf(target, await owner.list()) : null;
      if (control && crossing.caller.kind !== "human" && whose === "you")
        throw refuse(`human.only: '${key}' on your Revit is yours to press.`);
      const peaLaunch =
        launch !== null &&
        ("start" in launch.into ? launch.into.start.owner === "pea" : whose === "pea");
      let pea: PeaSource | null = null;
      try {
        pea = peaLaunch ? await peaSourceOf(launch!, deps.peaWork ?? productPeaWorkPath()) : null;
      } catch (error) {
        throw refuse(error instanceof Error ? error.message : String(error));
      }
      return { target, pea };
    },
    async (execution) => {
      const { target, pea } = execution.prepared as Prepared;
      // The step that starts a new Revit, when the action does: `instances.start`, or the first
      // leg of an open into a new Revit. Every other action's main step carries its own key.
      const mainKey = launch && start ? `${key}.start` : key;
      const prior = execution.recorded("native", mainKey);
      const priorAdoption = execution.recorded("native", `${key}.adopt`);
      const chosen: SessionSelection = priorAdoption
        ? { pid: target!.process.pid }
        : (target?.selection ?? {});
      // The expectation was resolved at preparation; a recorded step keeps the bytes it ran with.
      let expectSession: string | null = priorAdoption
        ? null
        : prior
          ? ((prior.input as StepInput).expectSession ?? null)
          : target
            ? target.expectSession
            : "absent";
      const requestId = REQUEST_ID;
      if (priorAdoption || expectSession === null) {
        const adoptionInput: StepInput = priorAdoption
          ? (priorAdoption.input as StepInput)
          : {
              argv: sessionStartArgv({ ...chosen, requestId }),
            };
        const adoption = await execution.step("native", `${key}.adopt`, adoptionInput, (id) =>
          dispatch(adoptionInput, id, read, true),
        );
        const envelope = parsePeRevitEnvelope<SessionStartResult, Resolved | null>(
          JSON.stringify(adoption),
          adoptionInput.argv,
          peRevitLauncher(),
        );
        const adopted = envelope.result.session;
        if (
          !target ||
          envelope.resolved?.pid !== target.process.pid ||
          envelope.resolved.processStartUtc !== target.process.processStartUtc ||
          adopted?.case !== "controlled-active" ||
          adopted.process.pid !== target.process.pid ||
          adopted.process.processStartUtc !== target.process.processStartUtc ||
          adopted.id !== envelope.resolved.id ||
          envelope.result.id !== adopted.id ||
          !adopted.receipt?.receiptPath ||
          adopted.receipt.receiptPath === "absent"
        )
          throw new BridgeError(
            "SDK adoption did not return the original process and a controlled receipt",
            409,
            { dispatched: true, result: envelope },
          );
        expectSession = adopted.receipt.receiptPath;
        if (prior && expectSession !== (prior.input as StepInput).expectSession)
          throw refuse("The recorded mutation does not expect the adopted receipt");
      }
      if (!expectSession) throw refuse("The recorded mutation has no session expectation");
      const openArgv = (
        session: SessionSelection,
        expectedSession: string,
        spec: InstancesLaunch,
      ) =>
        docOpenArgv({
          ...(spec.template ? { template: spec.source } : { source: pea?.opened ?? spec.source }),
          ...session,
          detach: pea?.detach ?? spec.detach,
          upgrade: spec.upgrade,
          links: spec.links,
          reload: spec.reload,
          unsynced: "keep",
          requestId,
          expectSession: expectedSession,
          expectDoc: spec.reload ? spec.source : spec.template ? "new" : "absent",
        });
      const argv = () => {
        switch (key) {
          case "instances.start":
          case "instances.open":
            if (start)
              return sessionStartArgv({
                project: resolveStartProject(hostOwnership.lane, hostOwnership.sourceRoot),
                year: start.year,
                ...chosen,
                quarantine: start.addins === "off",
                background: start.owner === "pea",
                requestId,
                expectSession,
              });
            return openArgv(chosen, expectSession, launch!);
          case "instances.restart":
            return sessionHrArgv({
              ...chosen,
              restart: true,
              requestId,
              expectSession,
            });
          case "instances.stop":
            return sessionStopArgv({
              ...chosen,
              unsaved: control!.unsaved!,
              force: control!.force,
              requestId,
              expectSession,
            });
          case "instances.close":
            return docCloseArgv({
              doc: control!.document!.openId,
              ...chosen,
              unsaved: control!.unsaved!,
              requestId,
              expectSession,
              expectDoc: control!.document!.openId,
            });
        }
      };
      // The step id IS the SDK request id: one caller-owned identity from admission to receipt.
      const stepInput: StepInput = { expectSession, argv: argv() };
      const native = await execution.step("native", mainKey, stepInput, (requestId) =>
        dispatch(stepInput, requestId, read),
      );
      if (!launch) return native;
      // A launch into a new Revit opens its source as its own receipted op in the session it just
      // started: `doc open --start` cannot name the session it would launch.
      let session: unknown;
      let document = native;
      if (start) {
        const started = native as SessionStartResult;
        const receiptPath = started.session.receipt.receiptPath;
        const openInput: StepInput = {
          expectSession: receiptPath,
          argv: openArgv({ id: started.id }, receiptPath, launch),
        };
        session = native;
        document = await execution.step("native", key, openInput, (id) =>
          dispatch(openInput, id, read),
        );
      }
      return {
        opened: pea?.opened ?? launch.source,
        copiedFrom: pea?.copiedFrom ?? null,
        detached: pea?.detach ?? launch.detach ?? false,
        ...(session !== undefined ? { session } : {}),
        document,
      };
    },
    resume,
  );
}

type OpRead = OpReceiptResponseResult | OpReceiptResult | OpStateResult;

/**
 * Settle lost document and supervisor invocations from their durable SDK op receipts.
 * Reading a receipt never re-dispatches the original request.
 */
export const recoverInstancesAction = (
  id: string,
  owner: ActionJournal,
  deps: InstancesActionDependencies = {},
) =>
  owner.recover(id, async (step: ActionStep) => {
    const read = deps.sdk ?? mutate;
    const argv = (step.input as StepInput).argv;
    const supervisor = argv[0] === "session";
    const args = opResultArgv({ requestId: step.id });
    const evidence = parsePeRevitEnvelope<OpRead>(await read(args), args, peRevitLauncher());
    const result = evidence.result;
    if (result.requestId !== step.id) return { step, evidence };
    const intent = { id: step.id, key: step.key, kind: step.kind, input: step.input };
    const answered = "response" in result && result.response != null;
    const unknownRequest = evidence.diagnostics.some((d) => d.code === "op.unknown-request");
    let response = answered ? result.response : undefined;
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
      const terminal = parsePeRevitEnvelope<{ state: string; legs?: readonly unknown[] }>(
        JSON.stringify(response),
        argv,
        peRevitLauncher(),
      );
      if (terminal.result?.state !== result.state) return { step, evidence };
      const legs = terminal.result.legs;
      notDispatched =
        Array.isArray(legs) &&
        legs.length === 0 &&
        terminal.diagnostics.some((d) => NOT_DISPATCHED.has(d.code));
      // Adoption needs resolved process evidence on resume; other supervisors return their payload.
      response = step.key.endsWith(".adopt") ? terminal : terminal.result;
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
  });
