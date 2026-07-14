/**
 * /schedule-grid command handlers — the side-effectful work the agent write mask forbids.
 *
 * `refresh` reads one rendered Revit schedule (revit.detail.schedules, Rows +
 * includeBindings) into the snapshot, carrying each cell's binding handle. `push`
 * (human only) redeems every staged cell's binding handle — target element ids +
 * parameter id — through revit.apply.parameter-values in one host-owned transaction,
 * folds successes into the snapshot, and clears those cells; failures stay staged.
 *
 * See route-state-commands.ts for the handler idiom (getDoc/setDoc, hint-rich errors).
 */
import {
  type ScheduleGridCell,
  type ScheduleGridDocument,
  defineCommitCommand,
  resolveTarget,
  scheduleGridSnapshotSchema,
  splitScheduleCellKey,
} from "@pe/agent-contracts";
import type { RouteStateCommandHandlers } from "@pe/agent-contracts";
import type { RevitApplyParameterValues, RevitDetailSchedules } from "@pe/host-contracts/generated";

import { HostRpcCaller } from "../shared/host-rpc-caller.ts";
import { resolveHostBaseUrl } from "../shared/host-config.ts";

export { scheduleGridRouteState } from "@pe/agent-contracts";

interface RefreshInput {
  scheduleName?: string;
  scheduleId?: number;
  maxRows?: number;
}

type ScheduleGridEdit = RevitApplyParameterValues.Req.ParameterValueEdit & { key: string };

/** Build the schedule-grid command handlers, bound to a resolved host base URL. */
export function createScheduleGridCommandHandlers(
  options: { hostBaseUrl?: string } = {},
): RouteStateCommandHandlers<ScheduleGridDocument> {
  const hostBaseUrl = resolveHostBaseUrl(options.hostBaseUrl);
  const caller = (target?: string) => new HostRpcCaller({ hostBaseUrl, bridgeSessionId: target });

  return {
    refresh: async (input, ctx) => {
      const { scheduleName, scheduleId, maxRows } = (input ?? {}) as RefreshInput;
      const target = resolveTarget(input, ctx.getDoc());
      const query = buildScheduleQuery(scheduleName, scheduleId, maxRows ?? 200);

      let response: RevitDetailSchedules.Res.Response;
      try {
        response = await caller(target).call("revit.detail.schedules", { query });
      } catch (error) {
        throw new Error(
          `revit.detail.schedules failed (${message(error)}). The op may not be registered on this host, or no document is open.`,
        );
      }

      const entry = response.entries[0];
      if (!entry) {
        const issues = response.issues.map((issue) => issue.message).filter(Boolean);
        const detail =
          issues.length > 0
            ? ` (${issues.slice(0, 3).join("; ")})`
            : query.kind === "CurrentActiveView"
              ? " — open a schedule view, or pass a scheduleName/scheduleId."
              : ` — no schedule matched ${scheduleName ?? scheduleId}. Check the name/id, or open a schedule view.`;
        throw new Error(`No schedule resolved${detail}`);
      }

      const rowCap = maxRows ?? 200;
      const snapshot = scheduleGridSnapshotSchema.parse({
        scheduleId: entry.scheduleId,
        scheduleUniqueId: entry.scheduleUniqueId,
        scheduleName: entry.scheduleName,
        documentTitle: response.documentTitle,
        columns: entry.columns.map((column) => ({
          columnNumber: column.columnNumber,
          headerText: column.headerText,
          fieldName: column.fieldName,
          isCalculated: column.isCalculated,
          isCombinedParameter: column.isCombinedParameter,
        })),
        rows: entry.rows.map((row) => ({
          rowNumber: row.rowNumber,
          kind: row.kind,
          values: row.values,
          subjectIds: row.subjectIds,
          bindings: (row.bindings ?? []).map((binding) => ({
            columnNumber: binding.columnNumber,
            targetElementIds: binding.targetElementIds,
            parameterName: binding.parameterName,
            parameterId: binding.parameterId,
            storageType: binding.storageType,
            displayValue: binding.displayValue,
            isTypeParameter: binding.isTypeParameter,
            isEditable: binding.isEditable,
            blocker: binding.blocker,
            hasMixedValues: binding.hasMixedValues,
          })),
        })),
        truncated: response.page?.isTruncated ?? entry.rows.length >= rowCap,
        takenAt: new Date().toISOString(),
      });

      // Preserve existing cells: getDoc returns the whole document; we replace only the snapshot.
      const document = ctx.getDoc();
      document.snapshot = snapshot;
      await ctx.setDoc(document);

      return {
        scheduleName: snapshot.scheduleName,
        columnCount: snapshot.columns.length,
        rowCount: snapshot.rows.length,
        truncated: snapshot.truncated,
      };
    },

    // Reference fan-out commit: one staged cell expands to one edit per target element id;
    // binding-handle refusals become kept-staged failures; run applies all edits in one
    // transaction and maps result indices back to cell keys (substrate owns the rest).
    push: defineCommitCommand<ScheduleGridDocument, ScheduleGridCell, ScheduleGridEdit>({
      select: (doc) => doc.cells,
      toEdits: (key, cell, doc) => {
        const { rowNumber, columnNumber } = splitScheduleCellKey(key);
        const row = doc.snapshot?.rows.find((candidate) => candidate.rowNumber === rowNumber);
        const binding = row?.bindings.find((candidate) => candidate.columnNumber === columnNumber);
        if (!binding) return { error: "no binding for this cell (re-run refresh)" };
        if (binding.blocker !== "None") return { error: `not writable: ${binding.blocker}` };
        if (!binding.isEditable) return { error: "cell is not editable" };
        if (binding.targetElementIds.length === 0)
          return { error: "binding has no target elements" };
        const value = cell.staged?.value ?? "";
        return binding.targetElementIds.map((elementId) =>
          binding.parameterId != null
            ? { key, elementId, parameterId: binding.parameterId, value }
            : { key, elementId, parameterName: binding.parameterName ?? undefined, value },
        );
      },
      run: async (edits, _doc, target) => {
        let response: RevitApplyParameterValues.Res.Response;
        try {
          response = await caller(target).call("revit.apply.parameter-values", {
            edits: edits.map(({ key: _key, ...edit }) => edit),
            transactionName: "schedule-grid push",
          });
        } catch (error) {
          throw new Error(`revit.apply.parameter-values failed (${message(error)}).`);
        }
        // Any failed edit fails its whole cell (a type-parameter cell fans out to many elements).
        const failures: { key: string; error: string }[] = [];
        (response.results ?? []).forEach((result, index) => {
          if (result.ok === false) {
            const key = edits[result.index ?? index]?.key;
            if (key) failures.push({ key, error: result.error ?? "apply failed" });
          }
        });
        return failures;
      },
      fold: (doc, key, cell) => {
        const { rowNumber, columnNumber } = splitScheduleCellKey(key);
        const row = doc.snapshot?.rows.find((candidate) => candidate.rowNumber === rowNumber);
        const columnIndex =
          doc.snapshot?.columns.findIndex((column) => column.columnNumber === columnNumber) ?? -1;
        const value = cell.staged?.value;
        if (row && value != null && columnIndex >= 0) {
          row.values[columnIndex] = value;
          const binding = row.bindings.find((candidate) => candidate.columnNumber === columnNumber);
          if (binding) binding.displayValue = value;
        }
      },
      clear: (doc, key) => {
        doc.cells[key] = { review: "none" };
      },
      stamp: (doc, isoNow) => {
        doc.pushedAt = isoNow;
      },
    }),
  };
}

/** Choose the query kind from the caller's reference: id → references, name → names, else active view. */
function buildScheduleQuery(
  scheduleName: string | undefined,
  scheduleId: number | undefined,
  maxRows: number,
): NonNullable<RevitDetailSchedules.Req.Request["query"]> {
  const projection: RevitDetailSchedules.Req.ScheduleQueryProjection = {
    view: "Rows",
    includeColumns: true,
    includeRows: true,
    includeCellValues: true,
    includeBindings: true,
  };
  const budget = { maxRowsPerEntry: maxRows };
  if (scheduleId != null)
    return { kind: "ScheduleReferences", scheduleIds: [scheduleId], projection, budget };
  if (scheduleName != null)
    return { kind: "ScheduleNames", scheduleNames: [scheduleName], projection, budget };
  return { kind: "CurrentActiveView", projection, budget };
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
