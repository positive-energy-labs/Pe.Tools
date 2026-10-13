import {
  actionAdmissionSchema,
  instancesActions,
  instancesLaunchSchema,
  instancesSessionSelection,
  instancesStartSchema,
  launchUnsynced,
  type SdkSessionSelection,
  type SdkDocumentRef,
  canonicalRouteInput,
  type InstancesActionKey,
  type Basis,
  type ActionAdmission,
  type RefusalCode,
} from "@pe/agent-contracts";
import type { ActionStep } from "@pe/agent-contracts";
import { createHash } from "node:crypto";
import { createReadStream, existsSync } from "node:fs";
import { constants, copyFile, lstat, mkdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, extname, isAbsolute, relative, resolve } from "node:path";
import { Effect } from "effect";
import { NodeServices } from "@effect/platform-node";
import {
  docCloseArgv,
  docListArgv,
  type DocListResult,
  docOpenArgv,
  docSaveArgv,
  opCancelArgv,
  opResultArgv,
  sessionDialogsArgv,
  sessionHrArgv,
  sessionListArgv,
  sessionResetArgv,
  sessionStartArgv,
  sessionStopArgv,
  type Diagnostic,
  type OpReceiptResponseResult,
  type OpReceiptResult,
  type OpStateResult,
  type Resolved,
  type SessionListResult,
  type SessionDialogsResult,
  type SessionObservation,
  type SessionStartResult,
} from "@pe/host-contracts/pe-revit-contract";
import { ActionIncomplete, type ActionJournal, type Crossing } from "./action-journal.ts";
import { BridgeError } from "./bridge.ts";
import { hostOwnership } from "./host-ownership.ts";
import type { SdkReceiptReader } from "./native-receipts.ts";
import { parsePeRevitEnvelope, peRevitLauncher } from "./pe-revit-launch.ts";
import { worksharingHint } from "./pea-source.ts";
import {
  acquisitionSessionId,
  foldAcquisitions,
  heldProcess,
  planAcquisition,
  type Acquisition,
  type AcquisitionIntent,
} from "./acquisition.ts";
import { productPeaWorkPath } from "./product-paths.ts";
import { resolveStartProject, runPeRevitCli } from "./session-route.ts";
import { admitCrossing, live, Refused, requireHuman } from "./control.ts";
import { readMachineSession } from "./machine.ts";

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
  "session.dialog-identity-required",
  "session.dialog-identity-stale",
  "session.dialog-receiver-unavailable",
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
/** The input of every verb on a running session: an exact incarnation, and what each verb adds. */
type ControlInput = {
  session: Incarnation;
  force?: boolean;
  unsaved?: "keep" | "discard";
  document?: SdkDocumentRef;
  release?: "none" | "all";
  restart?: boolean;
  hwnd?: string;
  to?:
    | { kind: "self" }
    | { kind: "save-as"; out: string; worksets?: "preserve" | "strip" }
    | { kind: "central"; comment?: string };
};
/** The SDK row an action acts on, resolved once at preparation and frozen with the attempt. */
type Target = {
  selection: SdkSessionSelection;
  /** The row's receipt path; null for an icon-started Revit, which the SDK adopts first. */
  expectSession: string | null;
  process: { pid: number; processStartUtc: string };
};
type Prepared = {
  target: Target | null;
  /** Frozen before any allocation: every path this acquisition may create (acquisition.ts). */
  acquisition: AcquisitionIntent | null;
  /** A Save As of this held acquisition's document: its new file becomes the acquisition's artifact. */
  artifactOf?: string;
};

async function hashFile(path: string) {
  const hash = createHash("sha256");
  let bytes = 0;
  for await (const chunk of createReadStream(path)) {
    hash.update(chunk as Buffer);
    bytes += (chunk as Buffer).length;
  }
  return { sha256: hash.digest("hex"), bytes };
}

/** One recorded file step: saved bytes to a reserved path, never over a file, then its hash. */
async function copyReserved({ from, to }: { from: string; to: string }) {
  await mkdir(dirname(to), { recursive: true });
  // A half-written copy never has the name an open would take.
  await copyFile(from, `${to}.part`, constants.COPYFILE_EXCL);
  await rename(`${to}.part`, to);
  return hashFile(to);
}

/**
 * Remove one recorded temporary file of an acquisition: inside its exclusive root, reached through
 * no link or junction, a plain file. Anything else refuses; a missing file is already removed.
 */
async function removeReserved(root: string, path: string) {
  const inside = relative(resolve(root), resolve(path));
  if (!inside || inside.startsWith("..") || isAbsolute(inside))
    throw refuse(`${path} is outside its acquisition root`);
  for (let at = resolve(path); ; at = dirname(at)) {
    const stat = await lstat(at).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    if (stat && (stat.isSymbolicLink() || (at === resolve(path) && !stat.isFile())))
      throw refuse(`${at} is not the plain file or folder the acquisition recorded`);
    if (!stat && at === resolve(path)) return { removed: false };
    if (at === resolve(root)) break;
  }
  await rm(path);
  return { removed: true };
}

type RunningRow = Extract<SessionObservation, { case: "controlled-active" | "observed-active" }>;

/**
 * The one running SDK session a selection names. With an expected incarnation, a row of any other
 * pid/start pair is refused: a mutable session name alone never selects a restarted Revit.
 */
async function readTarget(
  selection: SdkSessionSelection,
  expected: Target["process"] | undefined,
  read: SdkReceiptReader,
): Promise<Target>;
async function readTarget(
  selection: null,
  expected: Target["process"],
  read: SdkReceiptReader,
): Promise<Target | null>;
async function readTarget(
  selection: SdkSessionSelection | null,
  expected: Target["process"] | undefined,
  read: SdkReceiptReader,
): Promise<Target | null> {
  const args = sessionListArgv(selection ?? {});
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
  // Acquisition cleanup can finish after its exact process stopped; an unread census cannot prove that.
  if (selection === null && rows.length === 0 && !envelope.diagnostics.length) return null;
  if (rows.length !== 1 || envelope.diagnostics.length)
    throw refuse(
      expected
        ? "The supplied session incarnation is not the one the SDK records"
        : "The selection does not name exactly one running session",
      envelope.result,
    );
  const row = rows[0]!;
  const process = { pid: row.process.pid, processStartUtc: row.process.processStartUtc };
  if (row.case === "observed-active")
    return { process, selection: { pid: row.process.pid }, expectSession: null };
  if (selection && "id" in selection && row.id !== selection.id)
    throw refuse(
      "The supplied session name does not match the SDK process receipt",
      envelope.result,
    );
  return {
    process,
    selection: selection ?? { id: row.id },
    expectSession: row.receipt.receiptPath,
  };
}

/** The SDK documents of exactly one process incarnation; any other answer refuses. */
async function listDocuments(
  selection: SdkSessionSelection,
  process: { pid: number; processStartUtc: string },
  read: SdkReceiptReader,
) {
  const argv = docListArgv(selection);
  const envelope = parsePeRevitEnvelope<DocListResult, Resolved | null>(
    await read(argv),
    argv,
    peRevitLauncher(),
  );
  if (
    envelope.exitCode !== 0 ||
    envelope.result.state !== "ok" ||
    envelope.resolved?.pid !== process.pid ||
    envelope.resolved.processStartUtc !== process.processStartUtc
  )
    throw refuse("The SDK cannot list the documents of the original process", envelope);
  return envelope.result.documents;
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
    throw refuse(said, args[1] === "dialogs" ? envelope : envelope.result);
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
  if (key === "instances.handover" || key === "instances.cleanup")
    return admitAcquisitionRelease(admission, key, crossing, owner, read, resume);
  const door = "/actions";
  const lifecycleRefusal = (reason: string) =>
    new Refused({
      code: "lifecycle.ungranted-documents",
      door,
      reason: `Refused at ${door}: '${key}' ${reason}`,
    });
  // Resolve before admission: the receipt must carry the basis that admits its effects.
  const censusBasis = async (target: Target): Promise<Basis> => {
    const held = heldProcess(foldAcquisitions(await owner.list()), target.process);
    const processBasis = (session: string): Basis | null =>
      held ? { kind: "acquisition", id: held.id, scope: { kind: "process", session } } : null;
    if (launch) {
      const basis = launch.reload
        ? null
        : processBasis(`${target.process.pid}:${target.process.processStartUtc}`);
      if (basis) return basis;
      requireHuman(crossing.caller, door, `${key} into your Revit`);
      return { kind: "human" };
    }
    let row;
    try {
      row = await readMachineSession(target.process);
    } catch (error) {
      throw lifecycleRefusal(`cannot prove which documents it would affect. ${String(error)}`);
    }
    const documents = row.documents!;
    const attached = row.attachment;
    const session = attached?.session ?? `${target.process.pid}:${target.process.processStartUtc}`;
    const one = definition.needs === "document";
    if (!one && documents.length === 0 && (!attached || attached.documents?.length === 0))
      return processBasis(session) ?? { kind: "empty-user-session", session };
    const affected = one
      ? documents.filter((doc) => doc.openId === control!.document?.openId)
      : documents;
    if (
      !affected.length ||
      !attached?.documents ||
      (!one && attached.documents.length !== documents.length)
    )
      throw lifecycleRefusal("has no complete SDK-to-bridge document census.");
    const uncovered: string[] = [];
    let basis: Basis | null = null;
    for (const doc of affected) {
      const matches = attached.documents.filter((item) => item.openId === doc.openId);
      if (matches.length !== 1) {
        uncovered.push(doc.title ?? doc.openId ?? "unknown document");
        continue;
      }
      try {
        basis = admitCrossing(
          crossing.caller,
          { kind: "document", ref: { session: matches[0]!.session, openId: matches[0]!.openId } },
          door,
        );
      } catch (error) {
        if (!(error instanceof Refused)) throw error;
        if (one) throw error;
        uncovered.push(doc.title ?? doc.openId ?? "unknown document");
      }
    }
    if (uncovered.length || !basis)
      throw lifecycleRefusal(
        `would affect uncovered documents: ${uncovered.join(", ") || "unknown"}.`,
      );
    return (!one && processBasis(session)) || basis;
  };
  let admittedTarget: Target | undefined;
  if (crossing.caller.kind !== "human") {
    // Also validates anonymous and Page callers before the empty-session case.
    admitCrossing(crossing.caller, admission.destination, door);
    if (selection) {
      admittedTarget = await readTarget(selection, control?.session.process, read);
      crossing = { ...crossing, basis: await censusBasis(admittedTarget) };
    }
  }
  const recheck = async (target: Target | null) => {
    if (!target || crossing.caller.kind === "human") return;
    try {
      const basis = await censusBasis(target);
      const dead = live(crossing.basis);
      if (dead) throw dead;
      if (canonicalRouteInput(basis) !== canonicalRouteInput(crossing.basis))
        throw lifecycleRefusal("no longer has its admitted census basis.");
    } catch (error) {
      throw new BridgeError(String(error), 403, { notDispatched: true });
    }
  };
  return owner.admit(
    { ...admission, ...crossing },
    async (): Promise<Prepared> => {
      if (definition.needs === "document") {
        const { session, document } = control!;
        if (
          !document ||
          canonicalRouteInput(document.session) !== canonicalRouteInput(session.selection)
        )
          throw refuse("SDK document belongs to another session");
        const listed = await listDocuments(document.session, session.process, read);
        if (!listed.some((doc) => doc.openId === document.openId))
          throw refuse("The SDK document lifetime is not open in the original process", listed);
      }
      // Freeze the exact incarnation so replay compares the same bytes.
      const target =
        admittedTarget ??
        (control
          ? await readTarget(control.session.selection, control.session.process, read)
          : launch && "session" in launch.into
            ? await readTarget(launch.into.session, undefined, read)
            : null);
      const acquisitions = target ? foldAcquisitions(await owner.list()) : [];
      const held = target ? heldProcess(acquisitions, target.process) : null;
      const savedAs =
        control?.to?.kind === "save-as"
          ? acquisitions.find(
              (each) =>
                each.state === "held" &&
                each.document?.sdkOpenId === control.document?.openId &&
                each.document?.process.pid === target!.process.pid &&
                each.document.process.processStartUtc === target!.process.processStartUtc,
            )?.id
          : undefined;
      if (savedAs) return { target, acquisition: null, artifactOf: savedAs };
      const process: AcquisitionIntent["process"] | null = start
        ? start.owner === "pea"
          ? { kind: "create", year: start.year }
          : null
        : held && !launch?.reload
          ? { kind: "existing", process: target!.process, acquisition: held.id }
          : null;
      if (!process) return { target, acquisition: null };
      try {
        // The interim hint only picks --detach; native facts certify independence (pea-source.ts).
        const hint =
          launch &&
          !launch.template &&
          isAbsolute(launch.source) &&
          extname(launch.source).toLowerCase() === ".rvt"
            ? await worksharingHint(launch.source)
            : false;
        if (hint === null)
          throw Error(
            `Could not read the worksharing state of ${launch!.source}; open it with the person's own session instead.`,
          );
        const peaWork = deps.peaWork ?? productPeaWorkPath();
        return {
          target,
          acquisition: planAcquisition(admission.id, peaWork, process, launch, hint),
        };
      } catch (error) {
        throw refuse(error instanceof Error ? error.message : String(error));
      }
    },
    async (execution) => {
      const { target, acquisition, artifactOf } = execution.prepared as Prepared;
      const origin = acquisition?.document?.origin ?? null;
      // Allocation is recorded before it happens: baseline, then the work copy Revit opens.
      if (origin?.kind === "file-copy") {
        for (const [key, from, to] of [
          ["acquisition.baseline", origin.source, origin.baseline],
          ["acquisition.work", origin.baseline, origin.work],
        ] as const)
          await execution.step("file", key, { from, to }, () => copyReserved({ from, to }));
      }
      if (key === "instances.dialogs") {
        const prior = execution.recorded("native", key);
        let dismiss = prior?.input as StepInput | undefined;
        if (!dismiss) {
          const args = sessionDialogsArgv({ pid: target!.process.pid });
          const { result } = parsePeRevitEnvelope<SessionDialogsResult>(
            await read(args),
            args,
            peRevitLauncher(),
          );
          if (
            result.state !== "ok" ||
            result.pid !== target!.process.pid ||
            result.processStartUtc !== target!.process.processStartUtc
          )
            throw refuse("Dialog read did not return the exact process incarnation", result);
          dismiss = {
            argv: sessionDialogsArgv({
              pid: target!.process.pid,
              hwnd: control!.hwnd,
              dismiss: true,
              expectDialog: result.windows.find((window) => window.handle === control!.hwnd)
                ?.identity?.observationId,
              expectSession: result.expectSession ?? undefined,
              requestId: REQUEST_ID,
            }),
          };
        }
        const input = dismiss;
        return execution.step("native", key, input, async (id) => {
          await recheck(target);
          return dispatch(input, id, read);
        });
      }
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
        const adoption = await execution.step(
          "native",
          `${key}.adopt`,
          adoptionInput,
          async (id) => {
            await recheck(target);
            return dispatch(adoptionInput, id, read, true);
          },
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
      const spec = launch!;
      const opened = origin?.kind === "file-copy" ? origin.work : launch?.source;
      const detached =
        origin?.kind === "file-copy"
          ? origin.detach
          : origin?.kind === "detached"
            ? true
            : launch?.detach;
      const openArgv = (session: SessionSelection, expectedSession: string) =>
        docOpenArgv({
          ...(spec.template ? { template: spec.source } : { source: opened }),
          ...session,
          detach: detached,
          upgrade: spec.upgrade,
          links: spec.links,
          reload: spec.reload,
          unsynced: launchUnsynced(spec),
          requestId,
          expectSession: expectedSession,
          expectDoc: spec.reload ? spec.source : spec.template ? "new" : "absent",
        });
      const argv = () => {
        switch (key) {
          case "instances.start":
          case "instances.open":
            if (start) {
              const project = resolveStartProject(hostOwnership.lane, hostOwnership.sourceRoot);
              // Pea's process is named by its acquisition; on a checkout it is a snapshot, the only
              // second session the SDK admits beside the person's hot-reload one on that key.
              const created = acquisition?.process.kind === "create";
              return sessionStartArgv({
                project,
                year: start.year,
                ...chosen,
                ...(created
                  ? { id: acquisitionSessionId(acquisition.id), snapshot: project !== undefined }
                  : {}),
                quarantine: start.addins === "off",
                background: start.owner === "pea",
                requestId,
                expectSession,
              });
            }
            return openArgv(chosen, expectSession);
          case "instances.restart":
            return sessionHrArgv({
              ...chosen,
              restart: true,
              requestId,
              expectSession,
            });
          case "instances.reset":
            return sessionResetArgv({
              ...chosen,
              unsaved: control!.unsaved!,
              release: control!.release,
              restart: control!.restart,
              requestId,
              expectSession,
            });
          case "instances.save": {
            const to = control!.to!;
            return docSaveArgv({
              doc: control!.document!.openId,
              ...chosen,
              ...(to.kind === "save-as" ? { out: to.out, worksets: to.worksets } : {}),
              ...(to.kind === "central" ? { central: true, comment: to.comment } : {}),
              release: control!.release,
              requestId,
              expectSession,
              expectDoc: control!.document!.openId,
            });
          }
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
      const native = await execution.step("native", mainKey, stepInput, async (requestId) => {
        await recheck(target);
        return dispatch(stepInput, requestId, read);
      });
      if (artifactOf && control?.to?.kind === "save-as") {
        // Save As keeps the lifetime and moves it to a new file: a receipted artifact, never a guess.
        const out = control.to.out;
        await execution.step(
          "file",
          "acquisition.artifact",
          { acquisition: artifactOf, to: out },
          async () => ({
            path: out,
            ...(await hashFile(out)),
          }),
        );
      }
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
          argv: openArgv({ id: started.id }, receiptPath),
        };
        session = native;
        document = await execution.step("native", key, openInput, (id) =>
          dispatch(openInput, id, read),
        );
      }
      return {
        acquisition: acquisition?.id ?? null,
        opened,
        copiedFrom: origin?.kind === "file-copy" ? origin.source : null,
        detached: detached ?? false,
        ...(session !== undefined ? { session } : {}),
        document,
      };
    },
    resume,
  );
}

/** What a cleanup may remove: the work copy, and the baseline unless a handover depends on it. */
const temporaryFiles = (acquired: Acquisition) => {
  const origin = acquired.intent.document?.origin;
  if (origin?.kind !== "file-copy") return [];
  const roles = acquired.handover ? [origin.work] : [origin.work, origin.baseline];
  return roles
    .filter((path) => acquired.files.includes(path))
    .flatMap((path) => [`${path}.part`, path]);
};

/** Release touches only receipted resources; unknown outcomes require recovery first. */
async function admitAcquisitionRelease(
  admission: ActionAdmission,
  key: "instances.handover" | "instances.cleanup",
  crossing: Crossing,
  owner: ActionJournal,
  read: SdkReceiptReader,
  resume: boolean,
) {
  const door = "/actions";
  const { acquisition: id, unsaved } = admission.input as {
    acquisition: string;
    unsaved?: "keep" | "discard";
  };
  const unproven = (reason: string) =>
    new Refused({ code: "acquisition.unproven", door, reason: `Refused at ${door}: ${reason}` });
  if (crossing.caller.kind !== "human") admitCrossing(crossing.caller, admission.destination, door);
  const prior = (await owner.list(undefined, admission.id))[0];
  const acquired = foldAcquisitions(await owner.list()).find((each) => each.id === id);
  // A replay of this same action id returns its receipt; only a new attempt is checked afresh.
  if (!prior) {
    if (!acquired) throw unproven(`no acquisition '${id}' is in the journal.`);
    if (acquired.state === "reconciling")
      throw unproven(
        `acquisition '${id}' has a step with no proven outcome; recover action '${id}' and any handover or cleanup naming it first.`,
      );
    if (acquired.state !== "held") throw unproven(`acquisition '${id}' is ${acquired.state}.`);
  }
  const document = acquired?.document ?? null;
  let basis: Basis =
    crossing.caller.kind === "human"
      ? { kind: "human" }
      : { kind: "acquisition", id, scope: { kind: "release" } };
  if (key === "instances.handover" && !prior) {
    if (!document) throw unproven(`acquisition '${id}' holds no document to hand over.`);
    if (acquired!.handover)
      throw unproven(
        `acquisition '${id}' was handed over to ${acquired!.handover.result.path}; a result is create-only.`,
      );
    const row = await readMachineSession(document.process).catch((error: unknown) => {
      throw unproven(`its exact process has no fresh census. ${String(error)}`);
    });
    const product = row.attachment?.documents?.find(
      (doc) => doc.access.kind === "pea" && doc.access.acquisition === id,
    );
    if (!product)
      throw unproven(
        `acquisition '${id}' is not open, natively certified independent and joined to one product document now.`,
      );
    if (crossing.caller.kind !== "human")
      basis = {
        kind: "acquisition",
        id,
        scope: { kind: "document", lifetime: { session: product.session, openId: product.openId } },
      };
  }
  type Release = { target: Target; open: boolean } | { target: null; open: false };
  return owner.admit(
    { ...admission, ...crossing, basis },
    async (): Promise<Release> => {
      const process = document?.process ?? acquired!.process;
      const target = process ? await readTarget(null, process, read) : null;
      if (target && !target.expectSession)
        throw refuse("The acquired Revit is not a controlled SDK session");
      if (key === "instances.handover") {
        if (!target) throw refuse("The acquired Revit is no longer running");
        if (existsSync(acquired!.intent.document!.result))
          throw refuse(
            `${acquired!.intent.document!.result} exists; a handover result is create-only`,
          );
        return { target, open: true };
      }
      const listed =
        target && document ? await listDocuments(target.selection, target.process, read) : [];
      const held = listed.find((doc) => doc.openId === document?.sdkOpenId);
      const origin = acquired!.intent.document?.origin;
      const saved = acquired!.handover ? acquired!.handover.work : acquired!.baseline;
      const changed =
        held?.isModified ||
        (origin?.kind === "file-copy" &&
          saved &&
          existsSync(origin.work) &&
          (await hashFile(origin.work)).sha256 !== saved.sha256);
      if (changed && unsaved === "keep") {
        const reason = `Acquisition '${id}' holds changes no handover saved; retain the work copy for recovery, or clean up with unsaved discard.`;
        if (acquired!.handover) {
          throw new BridgeError(reason, 409, {
            notDispatched: true,
            issues: [
              {
                instancePath: "$",
                code: "acquisition.changed-after-handover" satisfies RefusalCode,
                message: reason,
                severity: "error",
              },
            ],
          });
        }
        throw refuse(reason);
      }
      return target ? { target, open: held !== undefined } : { target: null, open: false };
    },
    async (execution) => {
      const { target, open } = execution.prepared as Release;
      const expectSession = target?.expectSession ?? "";
      const sdkOpenId = document?.sdkOpenId ?? "";
      if (key === "instances.handover") {
        const intent = acquired!.intent.document!;
        const detached =
          intent.origin.kind === "detached" ||
          (intent.origin.kind === "file-copy" && intent.origin.detach);
        const save: StepInput = {
          expectSession,
          argv: docSaveArgv({
            doc: sdkOpenId,
            ...target!.selection,
            out: intent.result,
            worksets: detached ? "preserve" : undefined,
            release: "none",
            requestId: REQUEST_ID,
            expectSession,
            expectDoc: sdkOpenId,
          }),
        };
        await execution.step("native", "instances.handover.save", save, (requestId) =>
          dispatch(save, requestId, read),
        );
        return execution.step(
          "file",
          "acquisition.handover",
          { to: intent.diffPlan, result: intent.result },
          async () => {
            const result = { path: intent.result, ...(await hashFile(intent.result)) };
            const baseline =
              intent.origin.kind === "file-copy"
                ? acquired!.baseline
                : intent.origin.kind === "new"
                  ? { kind: "new", template: intent.origin.template }
                  : {
                      kind: "unknown",
                      reason: "A detached cloud open records no provider version.",
                    };
            // ponytail: no domain snapshot extractor is wired to acquisitions yet; hashes are provenance.
            const plan = {
              acquisition: id,
              origin: intent.origin,
              baseline,
              result,
              domain: {
                state: "unknown",
                reason:
                  "No domain snapshot was compared; the hashes prove which bytes, not what changed.",
              },
              review: "Review only: nothing merges, loads back, overwrites or syncs.",
            };
            await writeFile(intent.diffPlan, JSON.stringify(plan, null, 2), { flag: "wx" });
            // Save may update the work copy; retain its post-save bytes as the cleanup expectation.
            const work =
              intent.origin.kind === "file-copy"
                ? { path: intent.origin.work, ...(await hashFile(intent.origin.work)) }
                : null;
            return { result, diffPlan: intent.diffPlan, work };
          },
        );
      }
      const outcome = {
        acquisition: id,
        closed: null as string | null,
        removed: [] as string[],
        stopped: null as { pid: number; processStartUtc: string } | null,
      };
      if (open) {
        const close: StepInput = {
          expectSession,
          argv: docCloseArgv({
            doc: sdkOpenId,
            ...target!.selection,
            unsaved: unsaved!,
            requestId: REQUEST_ID,
            expectSession,
            expectDoc: sdkOpenId,
          }),
        };
        await execution.step("native", "instances.cleanup.close", close, (requestId) =>
          dispatch(close, requestId, read),
        );
        outcome.closed = sdkOpenId;
      }
      for (const path of temporaryFiles(acquired!).filter((each) => existsSync(each))) {
        await execution.step("file", "acquisition.remove", { to: path }, () =>
          removeReserved(acquired!.intent.root, path),
        );
        outcome.removed.push(path);
      }
      if (acquired!.process && target) {
        // Only the Revit this acquisition started, and only once nothing else is open there.
        const left = await listDocuments(target.selection, target.process, read);
        if (left.length)
          throw new ActionIncomplete(
            `Kept the Revit acquisition '${id}' started: ${left.length} other document(s) are open there`,
            outcome,
          );
        const stop: StepInput = {
          expectSession,
          argv: sessionStopArgv({
            ...target.selection,
            unsaved: "discard",
            requestId: REQUEST_ID,
            expectSession,
          }),
        };
        await execution.step("native", "instances.cleanup.stop", stop, (requestId) =>
          dispatch(stop, requestId, read),
        );
        outcome.stopped = acquired!.process;
      }
      return outcome;
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
      notDispatched = !legs?.length && terminal.diagnostics.some((d) => NOT_DISPATCHED.has(d.code));
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

/**
 * Cancel a running Instances action through the SDK: its native step id IS the SDK request id.
 * A supervisor op refuses (`op.supervisor-not-cancellable`) and the refusal is the answer.
 */
export const cancelInstancesAction = (
  id: string,
  owner: ActionJournal,
  deps: InstancesActionDependencies = {},
) =>
  owner.cancel(id, async (requestId) => {
    const args = opCancelArgv({ requestId });
    const envelope = parsePeRevitEnvelope(
      await (deps.sdk ?? mutate)(args),
      args,
      peRevitLauncher(),
    );
    if (envelope.diagnostics.length)
      throw Error(envelope.diagnostics.map((d: Diagnostic) => `${d.code}: ${d.detail}`).join("; "));
  });
