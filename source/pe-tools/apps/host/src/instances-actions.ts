import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
  type AdmissionResult,
  type Diagnostic,
  type MutationKey,
  type MutationRequestFile,
  type MutationSessionExpectation,
  type SessionListResult,
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
  /** Where the caller-owned `--request-file` for each step id is materialized. */
  requestDir?: string;
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

const MUTATION_KEYS: Record<InstancesActionKey, MutationKey> = {
  "instances.start": "session.start",
  "instances.open": "doc.open",
  "instances.restart": "session.hr",
  "instances.stop": "session.stop",
  "instances.close": "doc.close",
};

/** Refusals the SDK issues before admitting anything; every other diagnostic follows a dispatch. */
const NOT_DISPATCHED = new Set([
  "op.request-file-invalid",
  "op.stale-expectation",
  "op.intent-conflict",
  "op.admission-unavailable",
  "op.rejected",
  "session.bad-invocation",
  "doc.bad-invocation",
]);

/** Recorded per step: the expectation and the verb argv, with the request file named symbolically. */
type StepInput = Omit<MutationRequestFile, "requestId"> & { readonly argv: readonly string[] };
const REQUEST_FILE = "<request-file>";
/** The union of every Instances action input; each verb reads only the fields its schema admitted. */
type InstancesInput = {
  workspaceId: string;
  session?: { id: string; process: { pid: number; processStartUtc: string; executable: string } };
  force?: boolean;
  intent?: string;
  document?: { session: string; openId: string };
};
type Prepared = {
  staged: import("@pe/agent-contracts").InstancesLaunch | null;
  session?: { id: string; process: { pid: number; processStartUtc: string; executable: string } };
};

const requestFile = (
  { key, session, document }: StepInput,
  requestId: string,
): MutationRequestFile => ({ requestId, key, session, document });
async function materialize(dir: string, request: MutationRequestFile) {
  await mkdir(dir, { recursive: true });
  const path = join(dir, `${request.requestId}.json`);
  await writeFile(path, JSON.stringify(request), "utf8");
  return path;
}

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
  const row = rows[0] as { receipt: { receiptPath: string } };
  return { receiptPath: row.receipt.receiptPath, process: session.process };
}

/** Capture the exact row a named start will inspect, including a dead launch it may retire. */
async function readStartExpectation(
  id: string,
  read: SdkReceiptReader,
): Promise<MutationSessionExpectation> {
  const args = sessionListArgv({ id });
  const envelope = parsePeRevitEnvelope<SessionListResult>(
    await read(args),
    args,
    peRevitLauncher(),
  );
  const rows = (envelope.result as SessionListResult).sessions;
  if (rows.length === 0) return { case: "absent" };
  if (rows.length !== 1) throw refuse(`The SDK returned more than one session named '${id}'`);
  const row = rows[0]!;
  if (!("receipt" in row))
    throw refuse(`Session '${id}' is observed but not controlled by this checkout`);
  return {
    case: "recorded",
    receiptPath: row.receipt.receiptPath,
    process: "process" in row ? row.process : null,
  };
}

export async function admitInstancesAction(
  raw: unknown,
  owner: ActionJournal,
  deps: InstancesActionDependencies = {},
  resume = false,
) {
  const workspace = deps.workspace ?? actionWorkspace();
  const read = deps.sdk ?? mutate;
  const requestDir = deps.requestDir ?? join(tmpdir(), "pe-instances-requests");
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
      const expectation = prior
        ? (prior.input as StepInput).session
        : incarnation
          ? { case: "recorded" as const, ...(await readRecordedSession(incarnation, read)) }
          : key === "instances.start" && staged?.kind === "start" && staged.name
            ? await readStartExpectation(staged.name, read)
            : { case: "absent" as const };
      const id = incarnation?.id;
      const argv = () => {
        switch (key) {
          case "instances.start":
            if (staged?.kind !== "start") throw refuse("Stage a start first");
            return sessionStartArgv({
              project: resolveStartProject(hostOwnership.lane, hostOwnership.sourceRoot),
              year: staged.year,
              id: staged.name || undefined,
              doc: staged.document,
              conflictPolicy: "keep",
              requestFile: REQUEST_FILE,
            });
          case "instances.open":
            if (staged?.kind !== "open") throw refuse("Stage an open first");
            return docOpenArgv({
              path: staged.document,
              id,
              conflictPolicy: "keep",
              requestFile: REQUEST_FILE,
            });
          case "instances.restart":
            return sessionHrArgv({ id, restart: true, requestFile: REQUEST_FILE });
          case "instances.stop":
            return sessionStopArgv({
              id,
              force: input.force,
              requestFile: REQUEST_FILE,
            });
          case "instances.close":
            return docCloseArgv({
              id,
              intent: input.intent!,
              requestFile: REQUEST_FILE,
            });
        }
      };
      const stepInput: StepInput = {
        key: MUTATION_KEYS[key],
        session: expectation,
        document:
          key === "instances.open"
            ? { case: "absent" }
            : key === "instances.close"
              ? {
                  case: "open",
                  openId: input.document!.openId,
                }
              : null,
        argv: argv(),
      };
      // The step id IS the SDK request id: one caller-owned identity from admission to receipt.
      const result = await execution.step("native", key, stepInput, async (requestId) => {
        const file = await materialize(requestDir, requestFile(stepInput, requestId));
        const args = stepInput.argv.map((arg) => (arg === REQUEST_FILE ? file : arg));
        const envelope = parsePeRevitEnvelope(await read(args), args, peRevitLauncher());
        const blocking = envelope.diagnostics.find((d: Diagnostic) => NOT_DISPATCHED.has(d.code));
        if (blocking) throw refuse(`${blocking.code}: ${blocking.detail}`, envelope.result);
        if (envelope.diagnostics.length)
          throw new BridgeError(
            envelope.diagnostics.map((d: Diagnostic) => `${d.code}: ${d.detail}`).join("; "),
            502,
            { result: envelope.result },
          );
        return envelope.result;
      });
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

/** Settle a lost invocation from the SDK's own admission record under the original request id. */
export const recoverInstancesAction = (
  id: string,
  owner: ActionJournal,
  deps: InstancesActionDependencies = {},
) =>
  owner.recover(id, async (step: ActionStep) => {
    const read = deps.sdk ?? mutate;
    const requestDir = deps.requestDir ?? join(tmpdir(), "pe-instances-requests");
    const file = await materialize(requestDir, requestFile(step.input as StepInput, step.id));
    const args = opResultArgv({ requestId: step.id, requestFile: file });
    const evidence = parsePeRevitEnvelope<AdmissionResult | { state: string; requestId: string }>(
      await read(args),
      args,
      peRevitLauncher(),
    );
    const result = evidence.result;
    if (result.requestId !== step.id) return { step, evidence };
    const intent = { id: step.id, key: step.key, kind: step.kind, input: step.input };
    if (result.state === "completed" && "response" in result && result.response !== null)
      return { step: { ...intent, state: "succeeded", result: result.response ?? null }, evidence };
    // `failed` is an SDK refusal before dispatch; `unknown-request` means it never admitted the id.
    if (result.state === "failed" || result.state === "unknown-request")
      return {
        step: {
          ...intent,
          state: "failed",
          // Keep the refusal detail the dispatch already recorded; the SDK record adds only the verdict.
          error:
            result.state === "failed"
              ? `The SDK refused this admitted action${"error" in step && step.error ? `: ${step.error}` : ""}`
              : "The SDK never admitted this action; nothing was dispatched",
          status: 409,
          notDispatched: true,
        },
        evidence,
      };
    return { step, evidence };
  });
