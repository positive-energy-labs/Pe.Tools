import { resolveSdkSession } from "./sdk-session.ts";
import { createHash } from "node:crypto";
import { Effect } from "effect";
import {
  commands,
  tools,
  scheduleReadingSchema,
  scheduleCellBindingSchema,
  canonicalRouteInput,
  refusalText,
  documentRefSchema,
  addressSchema,
  scheduleReads,
  scheduleGridDocumentSchema,
  scheduleGridRouteState,
  scheduleGridSnapshotSchema,
  scheduleCatalogSchema,
  nativeProcessSchema,
  splitScheduleCellKey,
  rebindScheduleWork,
  type Address,
  type DocumentRef,
  type ScheduleReading,
  type ScheduleReadKey,
  type ScheduleGridDocument,
} from "@pe/agent-contracts";
import {
  parameterValueApplyBounds,
  type RevitDetailSchedules,
  type RevitCatalogSchedules,
  type ScheduleCellsApply,
} from "@pe/host-contracts/generated";
import { invokeBridge as invoke, type RevitBridge } from "./bridge.ts";
import { ActionIncomplete } from "./action-journal.ts";
import { z } from "zod";
import { command, refused, type CommandContext } from "./command-executor.ts";
import type { TakeoffActionDependencies } from "./takeoff-actions.ts";
import { readOriginalProcess, type NativeProcess } from "./native-receipts.ts";
import { StaleScheduleReading, type TakeoffCaptures } from "./takeoff-captures.ts";
import type { PodMemberWritten } from "@pe/host-contracts/operation-types";
import type { ScheduleCapture } from "@pe/host-contracts/generated";
import { composedSpec, podFolder, writeRun } from "./settings.ts";
import {
  lifetime,
  podContext,
  runPods,
  writeCaptureRun,
  writeMemberOnce,
  sourceRunOutput,
  type FamilyActionDependencies,
} from "./family-actions.ts";

const storageType = z.enum(["None", "String", "Integer", "Double", "ElementId"]);
const preparedSchedulePushSchema = z.strictObject({
  process: nativeProcessSchema,
  document: scheduleGridDocumentSchema,
  reading: scheduleReadingSchema,
  edits: z.array(
    z.object({
      key: z.string(),
      rowNumber: z.number().int(),
      columnNumber: z.number().int(),
      expectedBinding: scheduleCellBindingSchema.extend({
        storageType,
        targets: z.array(scheduleCellBindingSchema.shape.targets.element.extend({ storageType })),
        blocker: z.enum([
          "None",
          "CalculatedField",
          "CombinedParameterField",
          "NonStandardDisplay",
          "ParameterNotFound",
          "ReadOnlyParameter",
        ]),
      }),
      value: z.string().nullish(),
      unit: z.string().nullish(),
      rawInternal: z.boolean().optional(),
    }),
  ),
  failures: z.array(
    z.object({
      key: z.string(),
      error: z.string(),
      code: z.string().optional(),
      causeCode: z.string().optional(),
    }),
  ),
  at: z.string(),
});
const preparedScheduleApplySchema = z.strictObject({
  process: nativeProcessSchema,
  input: z.record(z.string(), z.unknown()),
});
const preparedScheduleCaptureSchema = z.strictObject({
  process: nativeProcessSchema,
  scheduleId: z.number(),
  pod: z.string(),
  at: z.string(),
  path: z.string(),
});

/** A schedule's Work key: its document's address and its Revit UniqueId, never a capture. */
export const scheduleWorkId = (document: Address, scheduleUniqueId: string) =>
  `schedule:${createHash("sha256")
    .update(canonicalRouteInput([document, scheduleUniqueId]))
    .digest("hex")}`;

const same = (a: unknown, b: unknown) => canonicalRouteInput(a) === canonicalRouteInput(b);
async function current(
  bridge: RevitBridge["Service"],
  target: DocumentRef,
  process?: NativeProcess,
) {
  const session = (await Effect.runPromise(bridge.list)).find(
    (s) => s.sessionId === target.session,
  );
  const doc = session?.state?.openDocuments.find((d) => d.openId === target.openId);
  if (
    !session ||
    !doc ||
    doc.isFamilyDocument ||
    (process &&
      (session.processId !== process.pid ||
        session.processStartUtcUnixMs !== Date.parse(process.processStartUtc)))
  )
    throw refused("The exact schedule document lifetime/process is unavailable");
  return { session, doc };
}
export async function readSchedule(
  raw: { key: string; input?: unknown; target?: unknown },
  captures: TakeoffCaptures,
  bridge: RevitBridge["Service"],
  deps: TakeoffActionDependencies = {},
) {
  if (!Object.hasOwn(scheduleReads, raw.key)) throw refused("Unknown schedule read");
  const key = raw.key as ScheduleReadKey;
  if (key === "schedule.grid.saved")
    return captures.schedule(scheduleReads[key].input.parse(raw.input).id);
  if (key === "schedule.grid.history")
    return captures.scheduleHistory(scheduleReads[key].input.parse(raw.input).workspaceId);
  if (key === "schedule.grid.work")
    return captures.scheduleWork(scheduleReads[key].input.parse(raw.input).workspaceId);
  if (key === "schedule.grid.bind") {
    const input = scheduleReads[key].input.parse(raw.input);
    const reading = await captures.schedule(input.readingId);
    const work = deps.workspace;
    if (!work) throw refused("Schedule Work is unavailable");
    const scope = {
      binding: "workspace" as const,
      route: "schedules",
      target: null,
      work: reading.workspaceId,
    };
    const view = await work.view(scope, "schedules");
    if (!view || view.revision !== input.expectedRevision)
      throw refused("Schedule Work changed; read it and bind again");
    const document = scheduleGridDocumentSchema.parse(view.doc);
    const previous = document.basis
      ? await captures.schedule(document.basis.captureId).catch(() => null)
      : null;
    const patches = document.basis
      ? rebindScheduleWork(document, previous, reading)
      : [
          { path: ["basis"], value: { captureId: reading.id } },
          { path: ["takenAt"], value: reading.capturedAt },
        ];
    if (patches.length) {
      const result = await work.publish(scope, "schedules", patches, input.expectedRevision);
      if (!result.ok) throw refused(refusalText(result));
    }
    return { envelope: await work.read(scope, "schedules") };
  }
  const target = documentRefSchema.parse(raw.target);
  await resolveSdkSession(
    bridge,
    { bridgeSessionId: target.session, openDocumentId: target.openId },
    deps.sdk,
  );
  const { session, doc } = await current(bridge, target);
  if (!session.processId || session.processStartUtcUnixMs == null)
    throw refused("Original process identity unavailable");
  const process = await readOriginalProcess(
    session.processId,
    session.processStartUtcUnixMs,
    deps.sdk,
  );
  await current(bridge, target, process);
  if (key === "schedule.grid.catalog") {
    scheduleReads[key].input.parse(raw.input ?? {});
    const catalog = (await invoke(bridge, target, "revit.catalog.schedules", {
      projection: { view: "Summary" },
      budget: { maxEntries: 500 },
    })) as RevitCatalogSchedules.Res.Response;
    await current(bridge, target, process);
    // An unsaved document has no address, so its schedules have no Work yet (a read refuses too).
    const address = doc.address ? addressSchema.parse(doc.address) : null;
    return scheduleCatalogSchema.parse({
      takenAt: new Date().toISOString(),
      schedules: catalog.entries
        .filter((e) => !e.isTemplate)
        .map((e) => ({
          scheduleId: e.scheduleId,
          workspaceId:
            address && e.scheduleUniqueId ? scheduleWorkId(address, e.scheduleUniqueId) : null,
          name: e.name,
          categoryName: e.categoryName,
          rowCount: e.visibleBodyRowCount,
          isPlacedOnSheet: e.isPlacedOnSheet,
        })),
    });
  }
  const input = scheduleReads["schedule.grid.snapshot"].input.parse(raw.input ?? {});
  // A reading is filed under its document's address; an unsaved or detached document has none.
  if (!doc.address)
    throw refused(`Save '${doc.title}' to a file before reading its schedules; it has no path.`);
  const document = addressSchema.parse(doc.address);
  const query = {
    ...(input.scheduleId != null
      ? { kind: "ScheduleReferences", scheduleIds: [input.scheduleId] }
      : input.scheduleName
        ? { kind: "ScheduleNames", scheduleNames: [input.scheduleName] }
        : { kind: "CurrentActiveView" }),
    projection: {
      view: "Rows",
      includeColumns: true,
      includeRows: true,
      includeCellValues: true,
      includeBindings: true,
    },
    budget: { maxRowsPerEntry: input.maxRows },
  };
  const response = (await invoke(bridge, target, "revit.detail.schedules", {
    query,
  })) as RevitDetailSchedules.Res.Response;
  if (response.entries.length !== 1) throw refused("Read requires exactly one resolved schedule");
  const entry = response.entries[0]!;
  if (input.scheduleId != null && entry.scheduleId !== input.scheduleId)
    throw refused("Schedule read returned another subject");
  const capturedAt = new Date().toISOString();
  const snapshot = scheduleGridSnapshotSchema.parse({
    ...entry,
    documentTitle: response.documentTitle,
    takenAt: capturedAt,
    truncated: response.page?.isTruncated ?? entry.rows.length >= input.maxRows,
  });
  if (!snapshot.scheduleUniqueId) throw refused("Schedule unique identity is missing");
  const workspaceId = scheduleWorkId(document, snapshot.scheduleUniqueId);
  await current(bridge, target, process);
  const reading = await captures.saveSchedule({
    target,
    process,
    document,
    workspaceId,
    snapshot,
    capturedAt,
  });
  await current(bridge, target, process);
  return reading;
}

/**
 * A cell refused before or by Revit; `code` names a refusal the web keys on: the host's own
 * (`stale-staged-cell`) or the domain's `EditRefusalCode`, with `causeCode` for a group refusal.
 */
type CellFailure = { key: string; error: string; code?: string; causeCode?: string };
type Edit = ScheduleCellsApply.Req.ScheduleCellEdit & { key: string };
type CellResult = ScheduleCellsApply.Res.ScheduleCellEditResult;
/**
 * Each staged cell with its reviewed binding, handed back unchanged: the domain compares every
 * target inside its transaction and refuses stale, blocked, or incomplete evidence per cell.
 */
function expand(document: ScheduleGridDocument, reading: ScheduleReading) {
  const edits: Edit[] = [];
  const failures: CellFailure[] = [];
  const stale = new Set((document.basis?.stale ?? []).map((cell) => cell.key));
  for (const [key, cell] of Object.entries(document.cells)) {
    if (!cell.edit) continue;
    // Staged over a value a re-read moved: refused here, never sent, until the person restages it.
    if (stale.has(key)) {
      failures.push({
        key,
        code: "stale-staged-cell",
        error:
          "This staged value is stale: Revit changed under it since it was staged; accept to stage it again",
      });
      continue;
    }
    const { rowNumber, columnNumber } = splitScheduleCellKey(key);
    const binding = reading.snapshot.rows
      .find((r) => r.rowNumber === rowNumber)
      ?.bindings.find((b) => b.columnNumber === columnNumber);
    if (!binding) failures.push({ key, error: "Missing binding" });
    else
      edits.push({
        key,
        rowNumber,
        columnNumber,
        expectedBinding: binding as ScheduleCellsApply.Req.ScheduleCellBinding,
        // A measured cell staged its unit with its value; the domain still refuses a bare number,
        // and nothing here ever fills a unit the person did not review.
        ...(typeof cell.edit.value === "string"
          ? { value: cell.edit.value }
          : { value: cell.edit.value.value, unit: cell.edit.value.unit }),
      });
  }
  return { edits, failures };
}
/**
 * One result per request cell, at that cell's index, for that cell's row and column. Anything else
 * is malformed; a missing result is unresolved. Nested target results stay per cell (their index is
 * the cell's own `currentBinding.targets` position) and are never re-mapped here.
 */
function acknowledge(raw: unknown, edits: Edit[]) {
  const value = raw as Partial<ScheduleCellsApply.Res.Response> | null;
  const results = new Map<number, CellResult>();
  let malformed =
    !value ||
    value.dryRun !== false ||
    !Number.isInteger(value.appliedCells) ||
    !Array.isArray(value.results);
  for (const row of Array.isArray(value?.results) ? value.results : []) {
    const edit = row && Number.isInteger(row.index) ? edits[row.index] : undefined;
    if (
      !edit ||
      typeof row.ok !== "boolean" ||
      row.rowNumber !== edit.rowNumber ||
      row.columnNumber !== edit.columnNumber ||
      results.has(row.index)
    ) {
      malformed = true;
      continue;
    }
    results.set(row.index, row);
  }
  if (value?.appliedCells !== [...results.values()].filter((r) => r.ok).length) malformed = true;
  const successes: string[] = [],
    failures: CellFailure[] = [];
  let unresolved = malformed;
  edits.forEach((edit, index) => {
    const result = results.get(index);
    if (!result) unresolved = true;
    if (!malformed && result?.ok) successes.push(edit.key);
    else
      failures.push({
        key: edit.key,
        // The domain's code, never a parse of its sentence.
        ...(!malformed && result?.code ? { code: result.code } : {}),
        ...(!malformed && result?.causeCode ? { causeCode: result.causeCode } : {}),
        error: malformed
          ? "Malformed native acknowledgment"
          : (result?.error ?? (result ? "Native refused the cell" : "Missing native cell result")),
      });
  });
  return { successes, failures, results, diagnostics: value?.diagnostics ?? [], unresolved };
}
const scheduleTarget = (ctx: CommandContext) => {
  if (ctx.admission.target.kind !== "document") throw refused("Exact document target required");
  return ctx.admission.target.ref;
};

export function scheduleExecutors(
  captures: TakeoffCaptures,
  bridge: RevitBridge["Service"],
  deps: FamilyActionDependencies = {},
) {
  const gridPush = command(commands["schedule.grid.push"], preparedSchedulePushSchema, {
    bind: async (ctx) => {
      const target = scheduleTarget(ctx);
      const { input } = ctx.admission;
      if (!input.work) throw refused("Reviewed Work is required");
      const document = await ctx.selectWork(tools.schedules.work, input.work, () => ({
        facts: [["basis"], ["takenAt"]],
      }));
      if (!document.basis || !document.takenAt)
        throw refused("Select a binding reading before staging edits");
      const reading = await captures.schedule(document.basis.captureId).catch((error) => {
        throw error instanceof StaleScheduleReading ? refused(error.message) : error;
      });
      return {
        effects: [
          { kind: "document", ref: target },
          ...(input.pod
            ? [{ kind: "directory" as const, path: await sourceRunOutput(input.pod, deps) }]
            : []),
        ],
        consumes: [
          {
            kind: "incarnation",
            probe: { target: ctx.admission.target, process: reading.process },
            expected: true,
          },
          {
            kind: "document-mark",
            probe: { ref: target, takenAt: document.takenAt },
            expected: true,
          },
        ],
        prepare: async () => {
          if (input.work!.key.work !== reading.workspaceId)
            throw refused("Work binding belongs to another schedule");
          if (!same(reading.target, target))
            throw refused(
              "Work binding belongs to another document lifetime: the schedule was re-opened in Revit; read it again (staged cells are kept)",
              "binding-lifetime-closed",
            );
          const { edits, failures } = expand(document, reading);
          if (!edits.length && !failures.length) throw refused("No staged cells");
          if (edits.length > parameterValueApplyBounds.maxEditsPerCall)
            throw refused(
              `${edits.length} staged cells exceed the ${parameterValueApplyBounds.maxEditsPerCall}-cell cap per push`,
            );
          if (!reading.snapshot.scheduleUniqueId)
            throw refused("Schedule unique identity is missing");
          if (input.pod) await runPods(deps, podFolder(input.pod, podContext(deps, bridge)));
          return {
            process: reading.process,
            document,
            reading,
            edits,
            failures,
            at: new Date().toISOString(),
          };
        },
      };
    },
    run: async (ctx, execution) => {
      const { admission, work } = ctx;
      const target = scheduleTarget(ctx);
      const base = admission.input.work!;
      const pod = admission.input.pod;
      const prepared = execution.prepared;
      const { edits, reading, document } = prepared;
      // The journal seals this exact request as the step input before dispatch. The domain compares
      // every reviewed target against a fresh read inside its own transaction.
      const request: ScheduleCellsApply.Req.Request = {
        scheduleId: reading.snapshot.scheduleId,
        scheduleUniqueId: reading.snapshot.scheduleUniqueId!,
        edits: edits.map(({ key: _key, ...edit }) => edit),
        transactionName: "Schedule grid push",
      };
      const native = edits.length
        ? await execution.step(
            "native",
            "schedule.cells.apply",
            request,
            async (id) => {
              return invoke(bridge, target, "schedule.cells.apply", request, id);
            },
            { process: prepared.process },
          )
        : {
            appliedCells: 0,
            appliedParameterWrites: 0,
            dryRun: false,
            results: [],
            diagnostics: [],
          };
      const outcome = acknowledge(native, edits);
      const failures = [...prepared.failures, ...outcome.failures];
      const publication = outcome.successes.length
        ? await execution.retireWork(
            base.key,
            scheduleGridRouteState.route,
            outcome.successes.map((key) => ["cells", key]),
          )
        : null;
      let readback: ScheduleReading | undefined, readbackError: string | undefined;
      try {
        readback = (await readSchedule(
          {
            key: "schedule.grid.snapshot",
            target,
            input: {
              scheduleId: reading.snapshot.scheduleId,
              maxRows: Math.min(2000, Math.max(200, reading.snapshot.rows.length + 1)),
            },
          },
          captures,
          bridge,
          deps,
        )) as ScheduleReading;
      } catch (error) {
        readbackError = String(error);
      }
      // The readback rebinds the Work, as the person's re-read does: a cell refused on moved evidence
      // comes back stale with what was reviewed (`was`) beside what Revit holds now. No readback, no
      // rebind, nor does an unresolved push (its resume publishes against the original basis); a
      // person's re-read that moved the basis meanwhile is the newer rebind and stands. A
      // post-publication convenience: nothing it throws changes the push's outcome (`rebindError`).
      let rebind: "rebound" | `skipped:${string}` = !readback
          ? "skipped:no-readback"
          : outcome.unresolved
            ? "skipped:unresolved"
            : "skipped:unchanged",
        rebindError: string | undefined;
      try {
        if (readback && !outcome.unresolved) {
          const view = await work.read(base.key, scheduleGridRouteState.route);
          const latest = view && scheduleGridDocumentSchema.parse(view.doc);
          if (!latest || latest.basis?.captureId !== document.basis!.captureId)
            rebind = "skipped:basis-moved";
          else {
            const patches = rebindScheduleWork(latest, reading, readback);
            if (patches.length) {
              await execution.publishWork(base.key, scheduleGridRouteState.route, patches);
              rebind = "rebound";
            }
          }
        }
      } catch (error) {
        rebind = "skipped:error";
        rebindError = String(error);
      }
      const result = {
        applied: outcome.successes.length,
        failures,
        diagnostics: outcome.diagnostics,
        native,
        publication,
        readback,
        readbackError,
        rebind,
        rebindError,
      };
      if (outcome.unresolved)
        throw new ActionIncomplete(
          "Native acknowledgment incomplete; staging retained. Recover this original receipt.",
          result,
        );
      if (readbackError)
        throw new ActionIncomplete("Native outcome recorded; actual readback unavailable", result);
      // ponytail: a settled push only; an incomplete one files its run when resume settles it.
      const receipt = pushReceipt(
        pod ?? null,
        reading,
        readback!,
        edits,
        failures,
        outcome.results,
      );
      // One run per admission: a resume overwrites the same folder (`writeRun`).
      const run = pod
        ? await runPods(
            deps,
            writeRun(
              pod,
              `${prepared.at.replace(/[:.]/g, "-")}-${admission.id.slice(0, 8)}`,
              {
                "receipt.json": `${JSON.stringify(receipt, null, 2)}
`,
              },
              podContext(deps, bridge),
            ),
          )
        : null;
      return { ...result, run, receipt };
    },
  });
  const capture = command(commands["schedule.capture"], preparedScheduleCaptureSchema, {
    bind: async (ctx) => {
      const target = scheduleTarget(ctx);
      const { input, id } = ctx.admission;
      const process = (await lifetime(bridge, target, "project", deps)).process;
      const path =
        input.path ??
        `captures/schedule-${input.scheduleId}-${createHash("sha256").update(id).digest("hex").slice(0, 24)}.json`;
      return {
        consumes: [
          { kind: "incarnation", probe: { target: ctx.admission.target, process }, expected: true },
        ],
        effects: [
          { kind: "document", ref: target },
          { kind: "directory", path: await sourceRunOutput(input.pod, deps) },
          { kind: "member", pod: input.pod, path },
        ],
        prepare: async () => {
          await runPods(deps, podFolder(input.pod, podContext(deps, bridge, target)));
          return {
            process,
            scheduleId: input.scheduleId,
            pod: input.pod,
            path,
            at: new Date().toISOString(),
          };
        },
      };
    },
    run: async (ctx, execution) => {
      const target = scheduleTarget(ctx);
      const prepared = execution.prepared;
      const input = { scheduleId: prepared.scheduleId };
      const result = await execution.step(
        "native",
        "schedule.capture",
        input,
        (id) => invoke<ScheduleCapture.Res.Response>(bridge, target, "schedule.capture", input, id),
        { process: prepared.process },
      );
      const pods = podContext(deps, bridge, target);
      const request = { pod: prepared.pod, path: prepared.path, content: result.specJson };
      const member = (await execution.step("file", "pod.member.write", request, () =>
        writeMemberOnce(deps, request, pods),
      )) as PodMemberWritten;
      const run = await writeCaptureRun(deps, pods, prepared.at, member, "schedule.capture");
      return { executionContext: target, member, run };
    },
  });
  const apply = command(commands["schedule.apply"], preparedScheduleApplySchema, {
    bind: async (ctx) => {
      const target = scheduleTarget(ctx);
      const process = (await lifetime(bridge, target, "project", deps)).process;
      const frozen = await runPods(
        deps,
        composedSpec(ctx.admission.input.source, podContext(deps, bridge, target)),
      );
      const { spec, source, dependencies } = frozen;
      return {
        consumes: [
          { kind: "incarnation", probe: { target: ctx.admission.target, process }, expected: true },
          ...[source, ...dependencies].flatMap((source) =>
            source.id && (!("origin" in source) || source.origin === "SavedMember")
              ? [
                  {
                    kind: "member" as const,
                    probe: { pod: source.id, path: source.path },
                    expected: source.sha256,
                    bytesBase64: source.bytesBase64,
                  },
                ]
              : [],
          ),
        ],
        effects: [
          { kind: "document", ref: target },
          { kind: "directory", path: await sourceRunOutput(source.id, deps) },
        ],
        prepare: async () => ({
          process,
          input: { specJson: spec, source: { root: source, dependencies } },
        }),
      };
    },
    run: async (ctx, execution) => {
      const target = scheduleTarget(ctx);
      const { process, input } = execution.prepared;
      const native = await execution.step(
        "native",
        "schedule.apply",
        input,
        (id) => invoke(bridge, target, "schedule.apply", input, id),
        { process },
      );
      return { executionContext: target, native };
    },
  });
  return { "schedule.grid.push": gridPush, "schedule.capture": capture, "schedule.apply": apply };
}

/**
 * The push run's receipt (dogma law 10 shape; a push is operation input, so it names no member):
 * per cell, the elements and parameter written and the cell text before and after.
 */
function pushReceipt(
  pod: string | null,
  before: ScheduleReading,
  after: ScheduleReading,
  edits: Edit[],
  failures: CellFailure[],
  results: Map<number, CellResult>,
) {
  // The text the grid shows for a cell (`route/schedules/workspace.tsx`): binding value, else the column's value.
  const cell = ({ snapshot }: ScheduleReading, key: string) => {
    const { rowNumber, columnNumber } = splitScheduleCellKey(key);
    const row = snapshot.rows.find((r) => r.rowNumber === rowNumber);
    const column = snapshot.columns.findIndex((c) => c.columnNumber === columnNumber);
    return (
      row?.bindings.find((b) => b.columnNumber === columnNumber)?.displayValue ??
      row?.values[column] ??
      null
    );
  };
  const keys = [...new Set([...edits.map((e) => e.key), ...failures.map((f) => f.key)])];
  return {
    podId: pod,
    // Reviewed cells are operation input; the push names no member.
    memberPath: null,
    memberSha256: null,
    origin: "Operation",
    operation: "schedule.grid.push",
    planHash: null,
    // F-S-1: any cell written is Succeeded, each refused cell listed; Failed only when none was.
    outcome: failures.length < keys.length ? "Succeeded" : "Failed",
    outputs: [],
    reason: failures.length
      ? `${failures.length} of ${keys.length} cells refused: ${failures.map((f) => `${f.key}: ${f.error}`).join("; ")}`
      : null,
    scheduleId: before.snapshot.scheduleId,
    scheduleUniqueId: before.snapshot.scheduleUniqueId,
    cells: keys.map((key) => {
      const index = edits.findIndex((e) => e.key === key);
      const binding = edits[index]?.expectedBinding;
      return {
        cell: key,
        elementIds: binding?.targets.map((t) => t.elementId) ?? [],
        parameterId: binding?.parameterId ?? null,
        parameterName: binding?.parameterName ?? null,
        value: edits[index]?.value ?? null,
        before: cell(before, key),
        after: cell(after, key),
        error: failures.find((f) => f.key === key)?.error ?? null,
        // Per target of this cell, in its own target order: the native write result.
        writes: results.get(index)?.parameterResults ?? [],
      };
    }),
  };
}
/** Capture writes a new member into the route's pod; apply composes a saved spec and creates a schedule. */
