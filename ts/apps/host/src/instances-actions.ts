import {
  commands,
  nativeProcessSchema,
  sdkSessionSelectionSchema,
  type Consumed,
  type Footprint,
  instancesLaunchSchema,
  instancesStartSchema,
  type NativeProcess,
  launchUnsynced,
  type SdkSessionSelection,
  type SdkDocumentRef,
  canonicalRouteInput,
  type Basis,
} from "@pe/agent-contracts";
import type { ActionStep } from "@pe/agent-contracts";
import { createHash } from "node:crypto";
import { z } from "zod";
import { command, refused, type CommandContext, type CommandBinding } from "./command-executor.ts";
import { createReadStream, existsSync } from "node:fs";
import { constants, copyFile, lstat, mkdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, extname, isAbsolute, relative, resolve } from "node:path";
import {
  docCloseArgv,
  docListArgv,
  type DocListResult,
  docOpenArgv,
  docSaveArgv,
  sessionDialogsArgv,
  sessionHrArgv,
  sessionListArgv,
  sessionResetArgv,
  sessionStartArgv,
  sessionStopArgv,
  type Resolved,
  type SessionListResult,
  type SessionDialogsResult,
  type SessionObservation,
  type SessionStartResult,
} from "@pe/host-contracts/pe-revit-contract";
import { ActionIncomplete, type ActionExecution } from "./action-journal.ts";
import { hostOwnership } from "./host-ownership.ts";
import type { SdkReceiptReader } from "./native-receipts.ts";
import { worksharingHint } from "./pea-source.ts";
import {
  acquisitionSessionId,
  acquisitionIntentSchema,
  acquisitionSchema,
  acquisitionRoot,
  foldAcquisitions,
  heldProcess,
  planAcquisition,
  unindependent,
  type Acquisition,
  type AcquisitionIntent,
} from "./acquisition.ts";
import { productPeaWorkPath } from "./product-paths.ts";
import { resolveStartProject } from "./session-route.ts";
import { readMachineSession } from "./machine.ts";
import { downloadCloudVersion } from "./cloud-version.ts";
import {
  readSdk,
  sdkEnvelope,
  runSdk,
  namedSdkSession,
  recoverSdkStep,
  cancelSdkStep,
  SDK_REQUEST_ID as REQUEST_ID,
  type SdkStepInput as StepInput,
} from "./sdk-dispatch.ts";

export type InstancesActionDependencies = {
  sdk?: SdkReceiptReader;
  /** Where Pea's copies go; the product's pea-work folder by default. */
  peaWork?: string;
  downloadVersion?: typeof downloadCloudVersion;
};

type Incarnation = {
  selection: SdkSessionSelection;
  process: { pid: number; processStartUtc: string; executable: string };
};
/** The input of every verb on a running session: an exact incarnation, and what each verb adds. */
type Target = z.infer<typeof lifecycleTargetSchema>;
type Prepared = z.infer<typeof preparedInstancesSchema>;

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
async function copyReserved({
  from,
  to,
  expectedSha256,
}: {
  from: string;
  to: string;
  expectedSha256?: string;
}) {
  await mkdir(dirname(to), { recursive: true });
  // A half-written copy never has the name an open would take.
  await copyFile(from, `${to}.part`, constants.COPYFILE_EXCL);
  await rename(`${to}.part`, to);
  const copied = await hashFile(to);
  if (expectedSha256 && copied.sha256 !== expectedSha256)
    throw Error("The copied source differs from its admitted bytes");
  return copied;
}

/**
 * Remove one recorded temporary file of an acquisition: inside its exclusive root, reached through
 * no link or junction, a plain file. Anything else refuses; a missing file is already removed.
 */
async function removeReserved(root: string, path: string) {
  const inside = relative(resolve(root), resolve(path));
  if (!inside || inside.startsWith("..") || isAbsolute(inside))
    throw refused(`${path} is outside its acquisition root`);
  for (let at = resolve(path); ; at = dirname(at)) {
    const stat = await lstat(at).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    if (stat && (stat.isSymbolicLink() || (at === resolve(path) && !stat.isFile())))
      throw refused(`${at} is not the plain file or folder the acquisition recorded`);
    if (!stat && at === resolve(path)) return { removed: false };
    if (at === resolve(root)) break;
  }
  await rm(path);
  return { removed: true };
}

/**
 * Create the one folder a handover saves into, because the SDK saves only into an existing folder
 * (DocCommand.NewOutput): inside its acquisition root, reached through no link or junction.
 */
async function reserveFolder(root: string, folder: string) {
  const inside = relative(resolve(root), resolve(folder));
  if (!inside || inside.startsWith("..") || isAbsolute(inside))
    throw refused(`${folder} is outside its acquisition root`);
  for (let at = resolve(folder); ; at = dirname(at)) {
    const stat = await lstat(at).catch(() => null);
    if (stat?.isSymbolicLink())
      throw refused(`${at} is a link, not the folder the acquisition planned`);
    if (at === resolve(root)) break;
  }
  return { created: (await mkdir(folder, { recursive: true })) ?? null };
}

type RunningRow = Extract<SessionObservation, { case: "controlled-active" | "observed-active" }>;

/**
 * The one running SDK session a selection names. With an expected incarnation, a row of any other
 * pid/start pair is refused: a mutable session name alone never selects a restarted Revit.
 */
async function readTarget(
  selection: SdkSessionSelection,
  expected: Pick<Target["process"], "pid" | "processStartUtc"> | undefined,
  read: SdkReceiptReader,
): Promise<Target>;
async function readTarget(
  selection: null,
  expected: Pick<Target["process"], "pid" | "processStartUtc">,
  read: SdkReceiptReader,
): Promise<Target | null>;
async function readTarget(
  selection: SdkSessionSelection | null,
  expected: Pick<Target["process"], "pid" | "processStartUtc"> | undefined,
  read: SdkReceiptReader,
): Promise<Target | null> {
  const args = sessionListArgv(selection ?? {});
  const envelope = await sdkEnvelope<SessionListResult>(args, read);
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
    throw refused(
      expected
        ? "The supplied session incarnation is not the one the SDK records"
        : "The selection does not name exactly one running session",
    );
  const row = rows[0]!;
  const process = nativeProcessSchema.parse(row.process);
  if (row.case === "observed-active")
    return { process, selection: { pid: row.process.pid }, expectSession: null };
  if (selection && "id" in selection && row.id !== selection.id)
    throw refused("The supplied session name does not match the SDK process receipt");
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
  const envelope = await sdkEnvelope<DocListResult, Resolved | null>(argv, read);
  if (
    envelope.exitCode !== 0 ||
    envelope.result.state !== "ok" ||
    envelope.resolved?.pid !== process.pid ||
    envelope.resolved.processStartUtc !== process.processStartUtc
  )
    throw refused("The SDK cannot list the documents of the original process");
  return envelope.result.documents;
}

const lifecycleTargetSchema = z.strictObject({
  selection: sdkSessionSelectionSchema,
  expectSession: z.string().nullable(),
  process: nativeProcessSchema,
});
const preparedInstancesSchema = z.strictObject({
  target: lifecycleTargetSchema.nullable(),
  project: z.string().nullable().optional(),
  acquisition: acquisitionIntentSchema.nullable(),
  artifactOf: z.string().optional(),
});

const launchClaimsFor = (
  ctx: CommandContext,
  process: Pick<NativeProcess, "pid" | "processStartUtc">,
) =>
  ctx.read
    .receipts()
    .flatMap((row) =>
      row.effects.some(
        (effect) =>
          effect.kind === "session" &&
          effect.session === `${process.pid}:${process.processStartUtc}`,
      )
        ? row.claims.flatMap((claim) =>
            claim.kind === "session-slot" ? [{ action: row.id, claim }] : [],
          )
        : [],
    );

const controlledPreparedSchema = preparedInstancesSchema.extend({
  target: lifecycleTargetSchema,
  acquisition: z.null(),
});

/** One complete census provides both resource aliases. The engine alone checks caller trust. */
async function observeLifecycle(
  ctx: CommandContext,
  read: SdkReceiptReader,
  selection?: SdkSessionSelection,
  expected?: Incarnation["process"],
  document?: SdkDocumentRef,
) {
  const target = selection ? await readTarget(selection, expected, read) : null;
  const effects: Footprint = [];
  const consumes: Consumed[] = [];
  let basis = ctx.basis;
  if (target) {
    const census = await readMachineSession(target.process).catch((error: unknown) => {
      throw refused(
        `Cannot prove which documents the process affects: ${String(error)}`,
        "lifecycle.ungranted-documents",
      );
    });
    if (
      !census.documents ||
      census.documents.some((doc) => !doc.openId) ||
      new Set(census.documents.map((doc) => doc.openId)).size !== census.documents.length
    )
      throw refused(
        "The SDK has an incomplete document identity census",
        "lifecycle.ungranted-documents",
      );
    const attached = census.attachment;
    const affected = census.documents.filter((doc) => !document || doc.openId === document.openId);
    if (
      (document && !affected.length) ||
      (attached &&
        (census.documents.length !== attached.documents?.length ||
          affected.some(
            (doc) =>
              attached.documents?.filter((candidate) => candidate.openId === doc.openId).length !==
              1,
          )))
    )
      throw refused(
        "The SDK has no complete lifecycle footprint census",
        "lifecycle.ungranted-documents",
      );
    const session = attached?.session ?? `${target.process.pid}:${target.process.processStartUtc}`;
    for (const alias of new Set([
      session,
      `${target.process.pid}:${target.process.processStartUtc}`,
    ]))
      effects.push({ kind: "session", session: alias });
    effects.push(
      ...(attached?.documents ?? [])
        .filter((doc) => !document || doc.openId === document.openId)
        .map((doc) => ({
          kind: "document" as const,
          ref: { session: doc.session, openId: doc.openId },
        })),
    );
    consumes.push(
      {
        kind: "incarnation",
        probe: { target: ctx.admission.target, process: target.process },
        expected: true,
      },
      {
        kind: "census",
        probe: { session, process: target.process },
        expected: census.documents.flatMap((doc) => (doc.openId ? [doc.openId] : [])).sort(),
      },
    );
    if (ctx.caller.kind !== "human") {
      const held = heldProcess(foldAcquisitions(ctx.read.receipts()), target.process);
      if (held) basis = { kind: "acquisition", id: held.id, scope: { kind: "process", session } };
      else if (!census.documents.length && (!attached || !attached.documents?.length))
        basis = { kind: "empty-user-session", session };
    }
    if (document) {
      if (canonicalRouteInput(document.session) !== canonicalRouteInput(selection))
        throw refused("SDK document belongs to another session");
      const listed = await listDocuments(document.session, target.process, read);
      if (!listed.some((doc) => doc.openId === document.openId))
        throw refused("The SDK document lifetime is not open in the original process");
    }
  }
  return { target, effects, consumes, basis };
}

async function bindControl(
  ctx: CommandContext,
  read: SdkReceiptReader,
  session: Incarnation,
  document?: SdkDocumentRef,
): Promise<CommandBinding> {
  const { target, ...facts } = await observeLifecycle(
    ctx,
    read,
    session.selection,
    session.process,
    document,
  );
  if (!target) throw refused("The original SDK process is unavailable");
  return { ...facts, prepare: async () => ({ target, acquisition: null }) };
}

/** Adoption is the SDK's operation. Its exact response must keep the originally observed process. */
async function controlledRequest(
  ctx: CommandContext,
  execution: ActionExecution,
  target: Target,
  read: SdkReceiptReader,
) {
  const key = ctx.admission.key;
  const prior = execution.recorded("native", key);
  const adoption = execution.recorded("native", `${key}.adopt`);
  const selection = adoption ? { pid: target.process.pid } : target.selection;
  let expectSession = adoption
    ? null
    : prior
      ? (prior.input as StepInput).expectSession
      : target.expectSession;
  if (adoption || expectSession === null) {
    const input = adoption
      ? (adoption.input as StepInput)
      : { argv: sessionStartArgv({ ...selection, requestId: REQUEST_ID }) };
    const answer = await runSdk<{ result: SessionStartResult; resolved: Resolved | null }>(
      execution,
      `${key}.adopt`,
      input,
      read,
      {
        process: target.process,
        check: (envelope) => {
          const adopted = envelope.result.session;
          if (
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
            throw refused(
              "SDK adoption did not return the original process and a controlled receipt",
            );
        },
      },
      true,
    );
    expectSession = answer.result.session.receipt!.receiptPath;
    if (prior && expectSession !== (prior.input as StepInput).expectSession)
      throw refused("The recorded mutation does not expect the adopted receipt");
  }
  if (!expectSession) throw refused("The recorded mutation has no session expectation");
  return { ...selection, requestId: REQUEST_ID, expectSession };
}

async function physicalEffects(execution: ActionExecution, native: unknown) {
  const session = (native as { session?: { id?: string; process?: NativeProcess } }).session;
  if (session?.id) await execution.effect({ kind: "session", session: session.id });
  if (session?.process)
    await execution.effect({
      kind: "session",
      session: `${session.process.pid}:${session.process.processStartUtc}`,
    });
}

async function controlRun(
  ctx: CommandContext,
  execution: ActionExecution,
  read: SdkReceiptReader,
  argv: (session: Awaited<ReturnType<typeof controlledRequest>>) => readonly string[],
  releases?: () => { action: string; claim: import("@pe/agent-contracts").Claim }[],
) {
  const { target } = execution.prepared as z.infer<typeof controlledPreparedSchema>;
  const session = await controlledRequest(ctx, execution, target, read);
  const result = await runSdk(
    execution,
    ctx.admission.key,
    { expectSession: session.expectSession, argv: argv(session) },
    read,
    { process: target.process, releases },
  );
  await physicalEffects(execution, result);
  return result;
}

async function prepareAcquisition(
  ctx: CommandContext,
  deps: InstancesActionDependencies,
  target: Target | null,
  start: z.infer<typeof instancesStartSchema> | null,
  launch: z.infer<typeof instancesLaunchSchema> | null,
) {
  const project = start
    ? (resolveStartProject(hostOwnership.lane, hostOwnership.sourceRoot) ?? null)
    : null;
  const held = target ? heldProcess(foldAcquisitions(ctx.read.receipts()), target.process) : null;
  const process: AcquisitionIntent["process"] | null = start
    ? start.owner === "pea"
      ? { kind: "create", year: start.year }
      : null
    : held && !launch?.reload
      ? { kind: "existing", process: target!.process, acquisition: held.id }
      : null;
  if (!process) {
    if (launch?.cloudVersion)
      throw refused(
        "An immutable APS version opens only through a Pea acquisition; it cannot open a connected user model.",
      );
    return { target, project, acquisition: null };
  }
  const hint =
    launch &&
    !launch.template &&
    isAbsolute(launch.source) &&
    extname(launch.source).toLowerCase() === ".rvt"
      ? await worksharingHint(launch.source)
      : false;
  if (hint === null)
    throw refused(
      `Could not read the worksharing state of ${launch!.source}; open it with the person's own session instead.`,
    );
  try {
    return {
      target,
      project,
      acquisition: planAcquisition(
        ctx.admission.id,
        deps.peaWork ?? productPeaWorkPath(),
        process,
        launch,
        hint,
      ),
    };
  } catch (error) {
    throw refused(error instanceof Error ? error.message : String(error));
  }
}

async function bindLaunch(
  ctx: CommandContext,
  deps: InstancesActionDependencies,
  read: SdkReceiptReader,
  start: z.infer<typeof instancesStartSchema> | null,
  launch: z.infer<typeof instancesLaunchSchema> | null,
) {
  const selection = launch && "session" in launch.into ? launch.into.session : undefined;
  const { target, ...facts } = await observeLifecycle(ctx, read, selection);
  if (!target && start) facts.effects.push({ kind: "session", session: `new:${ctx.admission.id}` });
  if (launch && isAbsolute(launch.source))
    facts.consumes.push({
      kind: "file",
      probe: { path: launch.source },
      expected: (await hashFile(launch.source)).sha256,
    });
  if (start?.owner === "pea" || launch)
    facts.effects.push({
      kind: "directory",
      path: acquisitionRoot(deps.peaWork ?? productPeaWorkPath(), ctx.admission.id),
    });
  return {
    ...facts,
    claims: start
      ? [
          {
            kind: "session-slot" as const,
            selector: {
              year: start.year,
              selection:
                start.owner === "pea" ? { id: acquisitionSessionId(ctx.admission.id) } : {},
            },
          },
        ]
      : [],
    prepare: () => prepareAcquisition(ctx, deps, target, start, launch),
  };
}

async function allocateDocument(
  ctx: CommandContext,
  execution: ActionExecution,
  deps: InstancesActionDependencies,
  acquisition: AcquisitionIntent | null,
) {
  const origin = acquisition?.document?.origin;
  if (!origin || !("work" in origin)) return;
  if (origin.kind === "version-copy")
    await execution.step(
      "file",
      "acquisition.baseline",
      { to: origin.baseline, source: origin.source, version: origin.version },
      () =>
        (deps.downloadVersion ?? downloadCloudVersion)(
          origin.source,
          origin.version,
          origin.baseline,
        ),
    );
  for (const [key, from, to] of [
    ...(origin.kind === "file-copy"
      ? [["acquisition.baseline", origin.source, origin.baseline] as const]
      : []),
    ["acquisition.work", origin.baseline, origin.work],
  ] as const) {
    const source = ctx.consumed.find((dep) => dep.kind === "file" && dep.probe.path === from);
    const baseline = execution.recorded("file", "acquisition.baseline");
    const expectedSha256 =
      source?.kind === "file"
        ? (source.expected ?? undefined)
        : baseline?.state === "succeeded"
          ? (baseline.result as { sha256?: string }).sha256
          : undefined;
    const input = { from, to, ...(expectedSha256 ? { expectedSha256 } : {}) };
    await execution.step("file", key, input, () => copyReserved(input));
  }
}

async function startSession(
  execution: ActionExecution,
  start: z.infer<typeof instancesStartSchema>,
  read: SdkReceiptReader,
  key: string,
  check?: (result: SessionStartResult) => void,
) {
  const { target, acquisition, project } = execution.prepared as Prepared;
  if (project === undefined)
    throw refused(
      "The original SDK project was not sealed; retain this receipt and submit a new command.",
    );
  const created = acquisition?.process.kind === "create";
  let prior = execution.recorded("native", key);
  if (created && prior?.state === "succeeded") {
    const { process } = (prior.result as { session: { process: NativeProcess } }).session;
    if (!(await readTarget(null, process, read)))
      prior = await execution.retire(
        prior.id,
        `Revit pid ${process.pid} started ${process.processStartUtc} is gone; resume starts a new one`,
      );
  }
  const expectSession =
    created && prior?.state === "failed"
      ? ((await namedSdkSession(acquisitionSessionId(acquisition!.id), read))?.receipt
          .receiptPath ?? "absent")
      : prior
        ? ((prior.input as StepInput).expectSession ?? "absent")
        : (target?.expectSession ?? "absent");
  const input = {
    expectSession,
    argv: sessionStartArgv({
      project: project ?? undefined,
      year: start.year,
      ...target?.selection,
      ...(created ? { id: acquisitionSessionId(acquisition!.id), snapshot: project !== null } : {}),
      quarantine: start.addins === "off",
      background: start.owner === "pea",
      requestId: REQUEST_ID,
      expectSession,
    }),
  };
  const result = await runSdk<SessionStartResult>(execution, key, input, read, {
    process: target?.process,
    check,
  });
  await physicalEffects(execution, result);
  return result;
}

const temporaryFiles = (acquired: Acquisition) => {
  const origin = acquired.intent.document?.origin;
  if (origin?.kind !== "file-copy" && origin?.kind !== "version-copy") return [];
  return (acquired.handover ? [origin.work] : [origin.work, origin.baseline])
    .filter((path) => acquired.files.includes(path))
    .flatMap((path) => [`${path}.part`, path]);
};
const releasePreparedSchema = z.strictObject({
  target: lifecycleTargetSchema.nullable(),
  open: z.boolean(),
  acquired: acquisitionSchema,
  removals: z.array(z.string()),
});

function heldAcquisition(ctx: CommandContext, id: string) {
  const acquired = foldAcquisitions(ctx.read.receipts()).find((each) => each.id === id);
  if (!acquired) throw refused(`No acquisition '${id}' is in the journal.`, "acquisition.unproven");
  if (acquired.state === "reconciling")
    throw refused(
      `Acquisition '${id}' has a step with no proven outcome; recover action '${id}' and any handover or cleanup naming it first.`,
      "acquisition.unproven",
    );
  if (acquired.state !== "held")
    throw refused(`Acquisition '${id}' is ${acquired.state}.`, "acquisition.unproven");
  return acquired;
}
const releaseBasis = (ctx: CommandContext, id: string): Basis =>
  ctx.caller.kind === "human"
    ? { kind: "human" }
    : { kind: "acquisition", id, scope: { kind: "release" } };

async function releaseTarget(acquired: Acquisition, read: SdkReceiptReader) {
  const process = acquired.document?.process ?? acquired.process;
  const target = process ? await readTarget(null, process, read) : null;
  if (target && !target.expectSession)
    throw refused("The acquired Revit is not a controlled SDK session");
  return target;
}

export function instancesExecutors(deps: InstancesActionDependencies = {}) {
  const read = deps.sdk ?? readSdk;
  const entries = {
    "instances.restart": command(commands["instances.restart"], controlledPreparedSchema, {
      bind: (ctx) => bindControl(ctx, read, ctx.admission.input.session),
      run: (ctx, execution) =>
        controlRun(ctx, execution, read, (session) => sessionHrArgv({ ...session, restart: true })),
    }),
    "instances.reset": command(commands["instances.reset"], controlledPreparedSchema, {
      bind: (ctx) => bindControl(ctx, read, ctx.admission.input.session),
      run: (ctx, execution) =>
        controlRun(ctx, execution, read, (session) =>
          sessionResetArgv({
            ...session,
            unsaved: ctx.admission.input.unsaved,
            release: ctx.admission.input.release,
            restart: ctx.admission.input.restart,
          }),
        ),
    }),
    "instances.stop": command(commands["instances.stop"], controlledPreparedSchema, {
      bind: (ctx) => bindControl(ctx, read, ctx.admission.input.session),
      run: (ctx, execution) =>
        controlRun(
          ctx,
          execution,
          read,
          (session) =>
            sessionStopArgv({
              ...session,
              unsaved: ctx.admission.input.unsaved,
              force: ctx.admission.input.force,
            }),
          () => launchClaimsFor(ctx, execution.prepared.target.process),
        ),
    }),
    "instances.close": command(commands["instances.close"], controlledPreparedSchema, {
      bind: (ctx) =>
        bindControl(ctx, read, ctx.admission.input.session, ctx.admission.input.document),
      run: (ctx, execution) =>
        controlRun(ctx, execution, read, (session) =>
          docCloseArgv({
            ...session,
            doc: ctx.admission.input.document.openId,
            unsaved: ctx.admission.input.unsaved,
            expectDoc: ctx.admission.input.document.openId,
          }),
        ),
    }),
    "instances.save": command(commands["instances.save"], controlledPreparedSchema, {
      bind: async (ctx) => {
        const binding = await bindControl(
          ctx,
          read,
          ctx.admission.input.session,
          ctx.admission.input.document,
        );
        const to = ctx.admission.input.to;
        if (to.kind !== "save-as") return binding;
        binding.effects.push({ kind: "file", path: to.out });
        const artifactOf = foldAcquisitions(ctx.read.receipts()).find(
          (each) =>
            each.state === "held" &&
            each.document?.sdkOpenId === ctx.admission.input.document.openId &&
            each.document.process.pid === ctx.admission.input.session.process.pid &&
            each.document.process.processStartUtc ===
              ctx.admission.input.session.process.processStartUtc,
        )?.id;
        return {
          ...binding,
          prepare: async () => ({
            ...((await binding.prepare!()) as object),
            ...(artifactOf ? { artifactOf } : {}),
          }),
        };
      },
      run: async (ctx, execution) => {
        const { document, to, release } = ctx.admission.input;
        const result = await controlRun(ctx, execution, read, (session) =>
          docSaveArgv({
            ...session,
            doc: document.openId,
            expectDoc: document.openId,
            release,
            ...(to.kind === "save-as" ? { out: to.out, worksets: to.worksets } : {}),
            ...(to.kind === "central" ? { central: true, comment: to.comment } : {}),
          }),
        );
        if (execution.prepared.artifactOf && to.kind === "save-as")
          await execution.step(
            "file",
            "acquisition.artifact",
            { acquisition: execution.prepared.artifactOf, to: to.out },
            async () => ({ path: to.out, ...(await hashFile(to.out)) }),
          );
        return result;
      },
    }),
    "instances.dialogs": command(commands["instances.dialogs"], controlledPreparedSchema, {
      bind: (ctx) => bindControl(ctx, read, ctx.admission.input.session),
      run: async (ctx, execution) => {
        const { target } = execution.prepared;
        let input = execution.recorded("native", "instances.dialogs")?.input as
          | StepInput
          | undefined;
        if (!input) {
          const args = sessionDialogsArgv({ pid: target.process.pid });
          const { result } = await sdkEnvelope<SessionDialogsResult>(args, read);
          if (
            result.state !== "ok" ||
            result.pid !== target.process.pid ||
            result.processStartUtc !== target.process.processStartUtc
          )
            throw refused("Dialog read did not return the exact process incarnation");
          input = {
            argv: sessionDialogsArgv({
              pid: target.process.pid,
              hwnd: ctx.admission.input.hwnd,
              dismiss: true,
              expectDialog: result.windows.find(
                (window) => window.handle === ctx.admission.input.hwnd,
              )?.identity?.observationId,
              expectSession: result.expectSession ?? undefined,
              requestId: REQUEST_ID,
            }),
          };
        }
        return runSdk(execution, "instances.dialogs", input, read, { process: target.process });
      },
    }),
    "instances.start": command(commands["instances.start"], preparedInstancesSchema, {
      bind: (ctx) => bindLaunch(ctx, deps, read, ctx.admission.input, null),
      run: (ctx, execution) =>
        startSession(execution, ctx.admission.input, read, "instances.start"),
    }),
    "instances.open": command(commands["instances.open"], preparedInstancesSchema, {
      bind: (ctx) =>
        bindLaunch(
          ctx,
          deps,
          read,
          "start" in ctx.admission.input.into ? ctx.admission.input.into.start : null,
          ctx.admission.input,
        ),
      run: async (ctx, execution) => {
        const spec = ctx.admission.input;
        const { target, acquisition } = execution.prepared;
        await allocateDocument(ctx, execution, deps, acquisition);
        const origin = acquisition?.document?.origin;
        const opened = origin && "work" in origin ? origin.work : spec.source;
        const detached = origin && "detach" in origin ? origin.detach : spec.detach;
        let started: SessionStartResult | undefined;
        let selected: Awaited<ReturnType<typeof controlledRequest>>;
        let process: NativeProcess;
        if ("start" in spec.into) {
          started = await startSession(
            execution,
            spec.into.start,
            read,
            "instances.open.start",
            (result) => {
              if (result.session.case !== "controlled-active")
                throw refused("SDK start did not prove an active controlled process");
            },
          );
          // The step postcondition certifies this exact persisted response, including on resume.
          const active = started.session as Extract<
            SessionStartResult["session"],
            { case: "controlled-active" }
          >;
          selected = {
            id: started.id,
            requestId: REQUEST_ID,
            expectSession: active.receipt.receiptPath,
          };
          process = nativeProcessSchema.parse(active.process);
        } else {
          if (!target) throw refused("Exact open destination process is unavailable");
          selected = await controlledRequest(ctx, execution, target, read);
          process = target.process;
        }
        const input = {
          expectSession: selected.expectSession,
          argv: docOpenArgv({
            ...selected,
            ...(spec.template ? { template: spec.source } : { source: opened }),
            detach: detached,
            upgrade: spec.upgrade,
            links: origin?.kind === "version-copy" ? "refuse" : spec.links,
            reload: spec.reload,
            unsynced: origin?.kind === "version-copy" ? undefined : launchUnsynced(spec),
            expectDoc: spec.reload ? spec.source : spec.template ? "new" : "absent",
          }),
        };
        const document = await runSdk(execution, "instances.open", input, read, { process });
        await physicalEffects(execution, document);
        return {
          acquisition: acquisition?.id ?? null,
          opened,
          copiedFrom: origin && "work" in origin ? origin.source : null,
          detached: detached ?? false,
          ...(started ? { session: started } : {}),
          document,
        };
      },
    }),
    "instances.handover": handoverCommand(read),
    "instances.cleanup": cleanupCommand(read),
  };
  const controls = {
    recover: (step: ActionStep) => recoverSdkStep(step, read),
    cancel: (id: string) => cancelSdkStep(id, read),
  };
  for (const entry of Object.values(entries)) Object.assign(entry, controls);
  return entries;
}

function handoverCommand(read: SdkReceiptReader) {
  return command(commands["instances.handover"], releasePreparedSchema, {
    bind: async (ctx) => {
      const id = ctx.admission.input.acquisition;
      const acquired = heldAcquisition(ctx, id);
      const document = acquired.document;
      if (!document)
        throw refused(
          `Acquisition '${id}' holds no document to hand over.`,
          "acquisition.unproven",
        );
      if (acquired.handover)
        throw refused(
          `Acquisition '${id}' was handed over to ${acquired.handover.result.path}; a result is create-only.`,
          "acquisition.unproven",
        );
      const row = await readMachineSession(document.process).catch((error: unknown) => {
        throw refused(
          `Its exact process has no fresh census: ${String(error)}`,
          "acquisition.unproven",
        );
      });
      const product = row.attachment?.documents?.find(
        (doc) => doc.access.kind === "pea" && doc.access.acquisition === id,
      );
      if (!product) {
        const sdk = row.documents?.filter((doc) => doc.openId === document.sdkOpenId) ?? [];
        throw refused(
          `Acquisition '${id}' ${sdk.length !== 1 ? `has ${sdk.length} SDK documents with its openId in its process now.` : `joins no single independent product document: ${unindependent(sdk[0]!) ?? "no product join"}.`}`,
          "acquisition.unproven",
        );
      }
      const basis: Basis =
        ctx.caller.kind === "human"
          ? { kind: "human" }
          : {
              kind: "acquisition",
              id,
              scope: {
                kind: "document",
                lifetime: { session: product.session, openId: product.openId },
              },
            };
      return {
        basis,
        effects: [
          {
            kind: "session",
            session: `${document.process.pid}:${document.process.processStartUtc}`,
          },
          { kind: "file", path: acquired.intent.document!.result },
          { kind: "file", path: acquired.intent.document!.diffPlan },
        ],
        prepare: async () => {
          const target = await releaseTarget(acquired, read);
          if (!target) throw refused("The acquired Revit is no longer running");
          if (existsSync(acquired.intent.document!.result))
            throw refused(
              `${acquired.intent.document!.result} exists; a handover result is create-only`,
            );
          return { target, open: true, acquired, removals: [] };
        },
      };
    },
    run: async (ctx, execution) => {
      const { target, acquired } = execution.prepared;
      const id = ctx.admission.input.acquisition;
      const sdkOpenId = acquired.document!.sdkOpenId;
      const expectSession = target!.expectSession!;
      const intent = acquired.intent.document!;
      const detached = "detach" in intent.origin && intent.origin.detach;
      const folder = dirname(intent.result);
      await execution.step("file", "acquisition.result-folder", { to: folder }, () =>
        reserveFolder(acquired.intent.root, folder),
      );
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
      await runSdk(execution, "instances.handover.save", save, read, { process: target!.process });
      return execution.step(
        "file",
        "acquisition.handover",
        { to: intent.diffPlan, result: intent.result },
        async () => {
          const result = { path: intent.result, ...(await hashFile(intent.result)) };
          const baseline =
            "baseline" in intent.origin
              ? acquired.baseline
              : { kind: "new", template: intent.origin.template };
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
            "work" in intent.origin
              ? { path: intent.origin.work, ...(await hashFile(intent.origin.work)) }
              : null;
          return { result, diffPlan: intent.diffPlan, work };
        },
      );
    },
  });
}

function cleanupCommand(read: SdkReceiptReader) {
  return command(commands["instances.cleanup"], releasePreparedSchema, {
    bind: async (ctx) => {
      const { acquisition: id, unsaved } = ctx.admission.input;
      const acquired = heldAcquisition(ctx, id);
      return {
        basis: releaseBasis(ctx, id),
        claims: [{ kind: "reconciliation", id }],
        effects: [
          ...(acquired.document
            ? [
                {
                  kind: "session" as const,
                  session: `${acquired.document.process.pid}:${acquired.document.process.processStartUtc}`,
                },
              ]
            : []),
          ...temporaryFiles(acquired).map((path) => ({ kind: "file" as const, path })),
        ],
        prepare: async () => {
          const target = await releaseTarget(acquired, read);
          const listed =
            target && acquired.document
              ? await listDocuments(target.selection, target.process, read)
              : [];
          const held = listed.find((doc) => doc.openId === acquired.document?.sdkOpenId);
          const origin = acquired.intent.document?.origin;
          const saved = acquired.handover ? acquired.handover.work : acquired.baseline;
          const changed =
            held?.isModified ||
            (origin &&
              "work" in origin &&
              saved &&
              existsSync(origin.work) &&
              (await hashFile(origin.work)).sha256 !== saved.sha256);
          if (changed && unsaved === "keep")
            throw refused(
              `Acquisition '${id}' holds changes no handover saved; retain the work copy for recovery, or clean up with unsaved discard.`,
              acquired.handover ? "acquisition.changed-after-handover" : "domain.refused",
            );
          return {
            target,
            open: held !== undefined,
            acquired,
            removals: temporaryFiles(acquired).filter((path) => existsSync(path)),
          };
        },
      };
    },
    run: async (ctx, execution) => {
      const { target, open, acquired, removals } = execution.prepared;
      const { acquisition: id, unsaved } = ctx.admission.input;
      const sdkOpenId = acquired.document?.sdkOpenId;
      const expectSession = target?.expectSession ?? undefined;
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
        await runSdk(execution, "instances.cleanup.close", close, read, {
          process: target!.process,
        });
        outcome.closed = sdkOpenId!;
      }
      for (const path of removals) {
        await execution.step("file", "acquisition.remove", { to: path }, () =>
          removeReserved(acquired.intent.root, path),
        );
        outcome.removed.push(path);
      }
      if (acquired.process && target) {
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
        await runSdk(execution, "instances.cleanup.stop", stop, read, {
          process: target.process,
          releases: () => launchClaimsFor(ctx, target.process),
        });
        outcome.stopped = acquired.process;
      }
      return outcome;
    },
  });
}
