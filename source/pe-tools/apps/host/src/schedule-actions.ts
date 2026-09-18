import { createHash } from "node:crypto";
import { Effect } from "effect";
import {
  actionAdmissionSchema,
  canonicalRouteInput,
  documentRefSchema,
  addressSchema,
  scheduleActions,
  scheduleReads,
  scheduleGridDocumentSchema,
  scheduleGridRouteState,
  scheduleGridSnapshotSchema,
  scheduleCatalogSchema,
  nativeProcessSchema,
  splitScheduleCellKey,
  type DocumentRef,
  type ScheduleReading,
  type ScheduleReadKey,
  type ScheduleGridDocument,
} from "@pe/agent-contracts";
import type {
  RevitDetailSchedules,
  RevitCatalogSchedules,
  RevitApplyParameterValues,
} from "@pe/host-contracts/generated";
import { BridgeError, type RevitBridge } from "./bridge.ts";
import { ActionIncomplete, type ActionJournal } from "./action-journal.ts";
import { actionWorkspace, type TakeoffActionDependencies } from "./takeoff-actions.ts";
import { readOriginalProcess, readNativeReceipt, type NativeProcess } from "./native-receipts.ts";
import type { TakeoffCaptures } from "./takeoff-captures.ts";
import type { PodMemberWritten } from "@pe/host-contracts/operation-types";
import type { ScheduleCapture } from "@pe/host-contracts/generated";
import { composedSpec, podFolder, writeRun } from "./settings.ts";
import {
  capturePath,
  lifetime,
  podContext,
  runPods,
  writeCaptureRun,
  writeMemberOnce,
  type FamilyActionDependencies,
} from "./family-actions.ts";

const refused = (message: string) => new BridgeError(message, 409, { notDispatched: true });
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
async function invoke(
  bridge: RevitBridge["Service"],
  target: DocumentRef,
  key: string,
  input: unknown,
  id?: string,
) {
  const result = await Effect.runPromise(
    Effect.result(bridge.invoke(key, input, target.session, target.openId, id)),
  );
  if (result._tag === "Failure") throw result.failure;
  return result.success.value;
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
  if (key === "schedule.grid.work")
    return captures.scheduleWork(scheduleReads[key].input.parse(raw.input).workspaceId);
  const target = documentRefSchema.parse(raw.target);
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
    return scheduleCatalogSchema.parse({
      takenAt: new Date().toISOString(),
      schedules: catalog.entries
        .filter((e) => !e.isTemplate)
        .map((e) => ({
          scheduleId: e.scheduleId,
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
  const workspaceId = `schedule:${createHash("sha256")
    .update(canonicalRouteInput([document, snapshot.scheduleUniqueId]))
    .digest("hex")}`;
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

type Edit = RevitApplyParameterValues.Req.ParameterValueEdit & { key: string };
function expand(document: ScheduleGridDocument, reading: ScheduleReading) {
  const edits: Edit[] = [];
  const failures: { key: string; error: string }[] = [];
  for (const [key, cell] of Object.entries(document.cells)) {
    if (!cell.staged) continue;
    const { rowNumber, columnNumber } = splitScheduleCellKey(key);
    const binding = reading.snapshot.rows
      .find((r) => r.rowNumber === rowNumber)
      ?.bindings.find((b) => b.columnNumber === columnNumber);
    if (
      !binding ||
      !binding.isEditable ||
      binding.blocker !== "None" ||
      !binding.targetElementIds.length ||
      (binding.parameterId == null && !binding.parameterName)
    ) {
      failures.push({
        key,
        error:
          binding?.blocker !== "None"
            ? (binding?.blocker ?? "Missing binding")
            : "Cell is not editable",
      });
      continue;
    }
    for (const elementId of binding.targetElementIds)
      edits.push({
        key,
        elementId,
        ...(binding.parameterId != null
          ? { parameterId: binding.parameterId }
          : { parameterName: binding.parameterName! }),
        value: cell.staged.value,
      });
  }
  return { edits, failures };
}
/** Native indices are explicit. Out-of-range false entries are transaction diagnostics, never edit acknowledgments. */
function acknowledge(raw: unknown, edits: Edit[]) {
  const value = raw as { applied?: unknown; dryRun?: unknown; results?: unknown } | null;
  const acknowledgments = new Map<number, { ok: boolean; error?: string }>();
  const diagnostics: unknown[] = [];
  let malformed =
    !value ||
    value.dryRun !== false ||
    !Number.isInteger(value.applied) ||
    !Array.isArray(value.results);
  for (const row of Array.isArray(value?.results) ? value.results : []) {
    if (!row || !Number.isInteger(row.index) || row.index < 0 || typeof row.ok !== "boolean") {
      malformed = true;
      continue;
    }
    if (row.index >= edits.length) {
      if (row.ok !== false) malformed = true;
      diagnostics.push(row);
      continue;
    }
    if (acknowledgments.has(row.index)) malformed = true;
    acknowledgments.set(row.index, row);
  }
  const positive = [...acknowledgments.values()].filter((r) => r.ok).length;
  if (value?.applied !== positive) malformed = true;
  const capRefused =
    edits.length > 500 &&
    value?.applied === 0 &&
    value?.dryRun === false &&
    acknowledgments.get(0)?.ok === false;
  const successes: string[] = [],
    failures: { key: string; error: string }[] = [];
  let unresolved = malformed;
  // ponytail: quadratic acknowledgment scan; native calls cap at 500, cap refusals retain all cells.
  for (const key of new Set(edits.map((e) => e.key))) {
    const indices = edits.flatMap((e, i) => (e.key === key ? [i] : []));
    const missing = indices.some((i) => !acknowledgments.has(i));
    if (missing && !capRefused) unresolved = true;
    const failed = indices.map((i) => acknowledgments.get(i)).find((r) => r?.ok === false);
    if (!malformed && !capRefused && !missing && !failed) successes.push(key);
    else
      failures.push({
        key,
        error: capRefused
          ? "Native 500-edit cap refused the whole call"
          : malformed
            ? "Malformed native acknowledgment"
            : (failed?.error ?? "Missing native edit acknowledgment"),
      });
  }
  return { successes, failures, diagnostics, unresolved };
}
export async function admitScheduleAction(
  raw: unknown,
  owner: ActionJournal,
  captures: TakeoffCaptures,
  bridge: RevitBridge["Service"],
  deps: FamilyActionDependencies = {},
  resume = false,
) {
  const admission = actionAdmissionSchema.parse(raw);
  if (admission.kind !== "workflow" || !Object.hasOwn(scheduleActions, admission.key))
    throw refused("Unknown schedule action");
  const key = admission.key as keyof typeof scheduleActions;
  if (scheduleActions[key].actor === "human" && admission.actor !== "human")
    throw refused("This schedule action requires human approval");
  admission.input = scheduleActions[key].input.parse(admission.input);
  if (admission.destination.kind !== "document") throw refused("Exact document target required");
  const target = admission.destination.ref;
  if (key !== "schedule.grid.push") return admitScheduleSpec(key, admission, owner, bridge, deps);
  const { pod } = scheduleActions["schedule.grid.push"].input.parse(admission.input);
  const work = deps.workspace ?? actionWorkspace();
  const base = admission.bases.work;
  if (!work || !base) throw refused("Reviewed Work address and revision required");
  return owner.admit(
    admission,
    async () => {
      const view = await work.read(base.key, scheduleGridRouteState.route);
      if (!view || view.revision !== base.revision) throw refused("Work changed");
      const document = scheduleGridDocumentSchema.parse(view.doc);
      if (!document.basis) throw refused("Select a binding reading before staging edits");
      const reading = await captures.schedule(document.basis.captureId);
      if (base.key.work !== reading.workspaceId || !same(reading.target, target))
        throw refused("Work binding belongs to another schedule/target lifetime");
      await current(bridge, target, reading.process);
      const { edits, failures } = expand(document, reading);
      if (!edits.length && !failures.length) throw refused("No staged cells");
      if (pod) await runPods(deps, podFolder(pod, podContext(deps, bridge)));
      const at = new Date().toISOString();
      return { process: reading.process, document, reading, edits, failures, at };
    },
    async (execution) => {
      const prepared = execution.prepared as {
        process: NativeProcess;
        document: ScheduleGridDocument;
        reading: ScheduleReading;
        edits: Edit[];
        failures: { key: string; error: string }[];
        at: string;
      };
      const { edits, reading, document } = prepared;
      // Revalidate bindings with an actual read before effects. Never substitute newly resolved handles for reviewed ones.
      if (!execution.recorded("native", "revit.apply.parameter-values")) {
        const fresh = (await readSchedule(
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
        if (
          fresh.workspaceId !== reading.workspaceId ||
          !same(expand(document, fresh), { edits, failures: prepared.failures })
        )
          throw refused("Schedule bindings changed; review the new reading before applying");
      }
      const native = edits.length
        ? await execution.step(
            "native",
            "revit.apply.parameter-values",
            {
              edits: edits.map(({ key: _key, ...edit }) => edit),
              transactionName: "Schedule grid push",
            },
            async (id) => {
              await current(bridge, target, prepared.process);
              return invoke(
                bridge,
                target,
                "revit.apply.parameter-values",
                {
                  edits: edits.map(({ key: _key, ...edit }) => edit),
                  transactionName: "Schedule grid push",
                },
                id,
              );
            },
          )
        : { applied: 0, dryRun: false, results: [] };
      const outcome = acknowledge(native, edits);
      const failures = [...prepared.failures, ...outcome.failures];
      let publication: unknown;
      // Compare-and-swap only unchanged consumed cells; a conflict re-reads Work, never re-executes Revit.
      for (let attempt = 0; attempt < 4; attempt++) {
        const view = await work.read(base.key, scheduleGridRouteState.route);
        if (!view)
          throw new ActionIncomplete("Native outcome recorded; Work unavailable", { native });
        const latest = scheduleGridDocumentSchema.parse(view.doc);
        const patches = same(latest.basis, document.basis)
          ? outcome.successes.flatMap((key) => {
              if (!same(latest.cells[key]?.staged, document.cells[key]?.staged)) return [];
              return [
                { path: ["cells", key, "staged"] },
                ...(same(latest.cells[key]?.proposal, document.cells[key]?.proposal)
                  ? [{ path: ["cells", key, "proposal"] }]
                  : []),
              ];
            })
          : [];
        const result = patches.length
          ? await work.apply(
              base.key,
              scheduleGridRouteState.route,
              "human",
              patches,
              view.revision,
            )
          : { ok: true, revision: view.revision };
        if (result.ok) {
          publication = result;
          break;
        }
        if (attempt === 3)
          throw new ActionIncomplete(
            "Native outcome recorded; concurrent Work publication remains pending",
            { native, result },
          );
      }
      await execution.publish(publication);
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
      const result = {
        applied: outcome.successes.length,
        failures,
        diagnostics: outcome.diagnostics,
        native,
        publication,
        readback,
        readbackError,
      };
      if (outcome.unresolved)
        throw new ActionIncomplete(
          "Native acknowledgment incomplete; staging retained. Recover this original receipt.",
          result,
        );
      if (readbackError)
        throw new ActionIncomplete("Native outcome recorded; actual readback unavailable", result);
      // ponytail: a settled push only; an incomplete one files its run when resume settles it.
      const receipt = pushReceipt(pod ?? null, reading, readback!, edits, failures);
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
    resume,
  );
}
/**
 * The push run's receipt (dogma law 10 shape; a push files no member, so the member fields are
 * empty): per cell, the elements and parameter written and the cell text before and after.
 */
function pushReceipt(
  pod: string | null,
  before: ScheduleReading,
  after: ScheduleReading,
  edits: Edit[],
  failures: { key: string; error: string }[],
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
    memberPath: "",
    memberSha256: "",
    operation: "schedule.grid.push",
    planHash: null,
    outcome: failures.length ? "Failed" : "Succeeded",
    outputs: [],
    reason: failures.length ? failures.map((f) => `${f.key}: ${f.error}`).join("; ") : null,
    scheduleId: before.snapshot.scheduleId,
    scheduleUniqueId: before.snapshot.scheduleUniqueId,
    cells: keys.map((key) => {
      const written = edits.filter((e) => e.key === key);
      return {
        cell: key,
        elementIds: written.map((e) => e.elementId),
        parameterId: written[0]?.parameterId ?? null,
        parameterName: written[0]?.parameterName ?? null,
        value: written[0]?.value ?? null,
        before: cell(before, key),
        after: cell(after, key),
        error: failures.find((f) => f.key === key)?.error ?? null,
      };
    }),
  };
}
/** Capture writes a new member into the route's pod; apply composes a saved spec and creates a schedule. */
function admitScheduleSpec(
  key: "schedule.capture" | "schedule.apply",
  admission: ReturnType<typeof actionAdmissionSchema.parse>,
  owner: ActionJournal,
  bridge: RevitBridge["Service"],
  deps: FamilyActionDependencies,
) {
  if (admission.destination.kind !== "document") throw refused("Exact document target required");
  const target = admission.destination.ref;
  const pods = podContext(deps, bridge, target);
  return owner.admit(
    admission,
    async () => {
      const { process } = await lifetime(bridge, target, "project", deps);
      if (key === "schedule.capture") {
        const input = scheduleActions[key].input.parse(admission.input);
        const at = new Date().toISOString();
        await runPods(deps, podFolder(input.pod, pods));
        return {
          process,
          nativeKey: key,
          input: { scheduleId: input.scheduleId },
          pod: input.pod,
          at,
          path:
            input.path ?? capturePath("schedules", `schedule-${input.scheduleId}`, new Date(at)),
        };
      }
      const { source } = scheduleActions[key].input.parse(admission.input);
      const { spec } = await runPods(deps, composedSpec(source, pods));
      return { process, nativeKey: key, input: { specJson: spec, source } };
    },
    async (execution) => {
      const prepared = execution.prepared as {
        process: NativeProcess;
        nativeKey: string;
        input: unknown;
        pod?: string;
        at?: string;
        path?: string;
      };
      const result = await execution.step(
        "native",
        prepared.nativeKey,
        prepared.input,
        async (id) => {
          await current(bridge, target, nativeProcessSchema.parse(prepared.process));
          return invoke(bridge, target, prepared.nativeKey, prepared.input, id);
        },
      );
      if (key === "schedule.apply") return { executionContext: target, native: result };
      const request = {
        pod: prepared.pod!,
        path: prepared.path!,
        content: (result as ScheduleCapture.Res.Response).specJson,
      };
      const member = (await execution.step("file", "pod.member.write", request, () =>
        writeMemberOnce(deps, request, pods),
      )) as PodMemberWritten;
      const run = await writeCaptureRun(deps, pods, prepared.at!, member, key);
      return { executionContext: target, member, run };
    },
    false,
  );
}
export const recoverScheduleAction = (
  id: string,
  owner: ActionJournal,
  deps: TakeoffActionDependencies,
) =>
  owner.recover(id, (step, prepared) =>
    readNativeReceipt(
      step,
      nativeProcessSchema.parse((prepared as { process: unknown }).process),
      deps.sdk,
    ),
  );
