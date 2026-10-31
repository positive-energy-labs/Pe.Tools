import { showFamilyCell, type FamiliesPatchCell, type PodDraftSource } from "@pe/agent-contracts";

import { FactChip } from "@pe/kit/lang/chip";
import { EmptyState } from "@pe/kit/lang/empty";
import { OutcomeLine } from "@pe/kit/lang/outcome";
import { ReviewRow } from "#/components/work/band";
import { ValueDiff } from "@pe/kit/lang/value-diff";
import type { Column } from "@pe/kit/table/model";
import { Table } from "@pe/kit/table/table";
import { familyCellEntries } from "#/families/staged";
import { useFamiliesWorkspace } from "#/families/workspace-context";
import { cellFromDraft } from "@pe/kit/lang/cell";
import { WorkLines, type WorkCell } from "#/components/work/lines";
import { ARTIFACT } from "#/families/readout-primitives";
import { Inspect } from "#/route/inspect";
import { cn } from "@pe/kit/lib/utils";
import { TooltipHint } from "@pe/kit/lang/tooltip";

/** THE RECEIPTS: one bare `Table` row per family, as the op reported it. */
type Receipt = NonNullable<
  ReturnType<typeof useFamiliesWorkspace>["applyData"]
>["receipts"][number];
const CELL = "face-mono block truncate px-(--item-pad-x)";
const receiptColumns: Column<Receipt>[] = [
  {
    key: "family",
    label: "family",
    width: "w-56",
    cell: (entry) => <span className={CELL}>{entry.familyName}</span>,
  },
  {
    key: "verdict",
    label: "verdict",
    width: "w-20",
    cell: (entry) => (
      <span className="flex px-(--item-pad-x)">
        <FactChip
          tone={entry.converged ? "done" : "alarm"}
          title={
            entry.success
              ? `The op reported this family written: ${entry.residue.length} change(s) remaining. This is the receipt, not the plan's promise.`
              : (entry.error ??
                "The op reported this family as failed and gave no reason. Re-plan and read the decision queue before retrying.")
          }
        >
          {entry.converged ? "converged" : entry.success ? "residue" : "failed"}
        </FactChip>
      </span>
    ),
  },
  {
    key: "residue",
    label: "residue",
    width: "w-40",
    title:
      "Changes still present after apply and recapture. Zero residue plus no errors means converged.",
    cell: (entry) => (
      <span className={cn(CELL, "text-ink-2")}>{entry.residue.length} remaining</span>
    ),
  },
  {
    key: "errors",
    label: "errors",
    cell: (entry) => (
      <TooltipHint
        content={
          entry.errors.length > 0
            ? `Errors reported by this family: ${entry.errors.join(", ")}.`
            : (entry.error ?? "No errors reported.")
        }
      >
        <span className={cn(CELL, "text-ink-2")}>
          {entry.errors.join(" · ") || (entry.error ?? "")}
        </span>
      </TooltipHint>
    ),
  },
  {
    key: "artifacts",
    label: "artifacts",
    width: "w-24",
    right: true,
    // The bundle on disk, opened by the one inspectable policy the log's apply row uses.
    cell: (entry) =>
      entry.artifactDirectory && (
        <Inspect spec={ARTIFACT} id={entry.artifactDirectory}>
          artifacts
        </Inspect>
      ),
  },
];

/** The output pane after an apply: what it actually did, per family, as the op reported it. */
export function FamiliesReceipts() {
  const { applyData } = useFamiliesWorkspace();
  if (!applyData) return null;
  return (
    <div className="flex flex-col gap-1">
      {applyData.diagnostics.map((issue) => (
        <OutcomeLine
          key={`${issue.code}:${issue.path}`}
          kind="error"
          label={issue.code}
          says={issue.message}
        />
      ))}
      <Table
        label="receipts"
        rows={applyData.receipts}
        columns={receiptColumns}
        // A receipt is its family's, by name (ruling); the id it applied under is gone on reload.
        rowKey={(entry) => entry.familyName}
        empty={
          <EmptyState story="scope" exit="re-plan and read the decision queue before retrying">
            no receipts — apply ran and reported nothing
          </EmptyState>
        }
      />
    </div>
  );
}

/**
 * THE FAMILIES WORK SLOT — the native patch as one row, then every pending cell as `WorkLines`, one
 * line per parameter aggregated across families (`PE_G___Model → FXMQ20 ×12 · … · pea · 15 cells ✓
 * ✕`, MAP ruling 60). Its tab is the route's `lines` field. Plan reads edit cells.
 */
export function FamiliesProposalsBand() {
  const { cells, wire, plan, store, locator } = useFamiliesWorkspace();
  const patch = store.work?.doc.patch ?? ({} as FamiliesPatchCell);
  const patchSource = (patch.edit ?? patch.suggestion)?.value;
  // A plan row with no resolved id (no `hashKey`) is a name the host refused, in its own words.
  const orphans = (plan?.entries ?? []).flatMap((entry) =>
    entry.hashKey === undefined && entry.flag ? [[entry.id, entry.flag] as const] : [],
  );
  // Each chip lands on its parameter × type cell in the grid (N4).
  const pending: WorkCell[] = familyCellEntries(cells).flatMap(
    ({ key, cell, parameter, familyName, typeName }) => {
      if (cell.suggestion == null && cell.edit == null) return [];
      const value = showFamilyCell((cell.edit ?? cell.suggestion)?.value ?? { value: "" });
      return [
        {
          key,
          column: parameter,
          row: `${familyName} · ${typeName}`,
          value,
          look: cellFromDraft(cell, { value }, showFamilyCell),
          locate: () => locator.locate(key),
        },
      ];
    },
  );
  if (!pending.length && !patchSource) return null;
  const patchRow = patchSource ? (
    <div aria-label="Native family patch">
      <ReviewRow
        wire={{ ...store.wire, segment: null }}
        address="patch"
        label={<span className="face-mono text-ink-2">native FF patch</span>}
        cell={patch}
        facts={{ value: <ValueDiff from={null} to={patchSource.path} /> }}
        show={(value) =>
          `${(value as PodDraftSource).path} · different patch bytes; inspect proposed source below`
        }
      />
      {(["suggestion", "edit"] as const).map((rung) =>
        patch[rung] ? (
          <details key={rung} className="t-small">
            <summary>
              Review exact {rung} patch · {patch[rung]!.value.path}
            </summary>
            <pre className="whitespace-pre-wrap break-words face-mono">
              {patch[rung]!.value.content}
            </pre>
          </details>
        ) : null,
      )}
      {patch.edit != null && pending.some(({ look }) => look.stage === "edit") ? (
        <OutcomeLine
          kind="refused"
          label="choose one edit edit lane"
          says="Unstage the native patch or the per-type cells before planning."
        />
      ) : null}
    </div>
  ) : null;
  return (
    // In the head's Work slot: that block is fixed and scrolls itself, so the grid never moves (F-R4-1).
    <>
      <WorkLines
        cells={pending}
        store={cells}
        wire={wire}
        tab={store.page.lines}
        onTab={(lines) => store.setPage({ lines })}
        above={patchRow}
      />
      {/* Orphaned: the plan could not resolve these families by name. Clearing stays free. */}
      {orphans.map(([family, flag]) => (
        <OutcomeLine key={family} kind="refused" label={`orphaned ${family}`} says={flag} />
      ))}
    </>
  );
}
