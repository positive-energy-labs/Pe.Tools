/**
 * THE CONFIRMATION SHEET (dogma law 9): what apply would do, one row per subject, and the one
 * commit that sends exactly the rows still included. It is apply's last page, never a stage.
 * Rows are the one `Table`; inclusion is its selection, and a flagged row refuses it.
 */
import { ActionButton } from "#/components/lang/action-button";
import { FactChip, Tag } from "#/components/lang/chip";
import { EmptyState } from "#/components/lang/empty";
import { OutcomeLine } from "#/components/lang/outcome";
import type { Column } from "#/components/master-table/model";
import { Table } from "#/components/master-table/table";
import { cn } from "#/lib/utils";

import { STALE_PLAN, type PlanEntry, type PlanSheet } from "./manifest";

const CELL = "face-mono block truncate px-(--item-pad-x)";

/** Inclusion is the table's selection: a selected row is sent, a flagged row refuses. */
const PLAN_COLUMNS: Column<PlanEntry>[] = [
  {
    key: "subject",
    label: "subject",
    width: "w-48",
    cell: (entry) => <span className={CELL}>{entry.name}</span>,
  },
  {
    key: "actions",
    label: "actions",
    width: "w-20",
    cell: (entry) => <span className={CELL}>{plural(entry.actions, "action")}</span>,
  },
  {
    key: "source",
    label: "source",
    cell: (entry) => (
      <span className={cn(CELL, "text-ink-2")} title={entry.detail}>
        {entry.detail}
      </span>
    ),
  },
  {
    key: "exception",
    label: "exception",
    width: "w-64",
    cell: (entry) => (
      <span className={cn(CELL, "text-ink-mute")} title={entry.flag ?? ""}>
        {entry.flag ?? ""}
      </span>
    ),
  },
];

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export function PlanSheetView({
  sheet,
  excluded,
  included,
  toggle,
  apply,
  cancel,
  stop,
  replan,
  refusal,
  stale = false,
  busy,
}: {
  /** null = the plan no longer describes the spec (or was never read). */
  sheet: PlanSheet | null;
  excluded: ReadonlySet<string>;
  included: readonly PlanEntry[];
  /** Absent = rows cannot be held back. */
  toggle?: (id: string) => void;
  apply: () => void;
  cancel: () => void;
  /** Stop the apply that is running now. Absent = this sheet has no running verb to stop. */
  stop?: { readonly label: string; readonly run: () => void };
  /** The plan verb, in its words now: the staged draft or the saved spec. */
  replan: { readonly says: string; readonly run: () => void };
  /** Why apply is refused, in the operator's words; null = it can run. */
  refusal: string | null;
  /** The staged cells moved since this plan: said before the press, in the host's words. */
  stale?: boolean;
  busy: boolean;
}) {
  const head = (
    <div className="hairline-b flex flex-wrap items-center gap-1.5 px-2 py-1">
      <Tag>plan</Tag>
      {sheet ? (
        <FactChip
          tone={included.length ? "caution" : "meta"}
          title="Rows apply will send: the selected rows. Held-back and flagged rows are skipped."
        >
          {included.length} / {sheet.entries.length} included
        </FactChip>
      ) : null}
      <span className="ml-auto flex items-center gap-1.5">
        {/* While apply runs, the sheet's escape is the real one: stop the op inside Revit. */}
        {busy && stop ? (
          <ActionButton
            label={stop.label}
            reason="Signal the running operation. It stops at its next checkpoint; what it already wrote stands."
            onClick={stop.run}
          />
        ) : (
          <ActionButton
            label="cancel"
            disabled={busy}
            reason="Close the sheet; nothing has been written."
            onClick={cancel}
          />
        )}
        <ActionButton
          label="re-plan"
          disabled={busy}
          reason={`Read a fresh plan: ${replan.says}.`}
          onClick={replan.run}
        />
        <ActionButton
          tone="commit"
          label={`apply ${plural(included.length, "row")}`}
          busy={busy}
          disabled={busy || refusal !== null}
          reason={
            refusal ??
            `Write the ${plural(included.length, "included row")} to Revit, exactly as planned.`
          }
          onClick={apply}
        />
      </span>
    </div>
  );
  if (!sheet)
    return (
      <section aria-label="Confirmation sheet" className="flex min-h-0 flex-col">
        {head}
        <div className="px-2 py-1.5">
          <EmptyState story="scope" exit="re-plan">
            the plan no longer describes this spec
          </EmptyState>
        </div>
      </section>
    );
  return (
    <section aria-label="Confirmation sheet" className="flex min-h-0 flex-col">
      {head}
      <div className="min-h-0 overflow-auto px-2 py-1">
        {stale ? <OutcomeLine kind="refused" label="stale plan" says={STALE_PLAN} /> : null}
        {sheet.held?.map((row) => (
          <p key={row.name} className="t-small text-ink-2">
            excluded by {row.by === "pea" ? "Pea" : "you"}: {row.name}
          </p>
        ))}
        {sheet.entries.flatMap((entry) =>
          entry.warnings.map((warning) => (
            <OutcomeLine
              key={`${entry.id}:${warning}`}
              kind="advisory"
              label={entry.name}
              says={warning}
            />
          )),
        )}
        <Table
          label="plan rows"
          rows={sheet.entries}
          columns={PLAN_COLUMNS}
          rowKey={(entry) => entry.id}
          selection={
            toggle && {
              selected: new Set(included.map((entry) => entry.id)),
              // The sheet's one verb is the toggle: a changed membership is a toggle of that row.
              onChange: (next) => {
                for (const entry of sheet.entries)
                  if (!entry.flag && next.has(entry.id) === excluded.has(entry.id))
                    toggle(entry.id);
              },
              refusal: (id) => {
                const flag = sheet.entries.find((entry) => entry.id === id)?.flag;
                return flag ? `${flag}. Nothing to include.` : null;
              },
            }
          }
          rowClassName={(entry) =>
            entry.flag || excluded.has(entry.id) ? "text-ink-mute" : undefined
          }
          empty={
            <EmptyState story="scope" exit="widen the scope, or plan another spec">
              the plan compiled cleanly and matched nothing
            </EmptyState>
          }
        />
      </div>
    </section>
  );
}
