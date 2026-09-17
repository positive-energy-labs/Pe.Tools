/**
 * THE CONFIRMATION SHEET (dogma law 9): what apply would do, one row per subject, and the one
 * commit that sends exactly the rows still included. It is apply's last page, never a stage.
 * Rows use the ruled table idiom: separate borders, cell-drawn rules, rows at `--item-h`.
 */
import { ActionButton } from "#/components/lang/action-button";
import { FactChip, Tag } from "#/components/lang/chip";
import { EmptyState } from "#/components/lang/empty";
import { OutcomeLine } from "#/components/lang/outcome";
import { Press } from "#/components/lang/press";
import { cn } from "#/lib/utils";

import type { PlanEntry, PlanSheet } from "./manifest";

const ROW = "h-(--item-h)";
const CELL = "hairline-b px-(--item-pad-x) align-middle";

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
  replan: () => void;
  /** Why apply is refused, in the operator's words; null = it can run. */
  refusal: string | null;
  busy: boolean;
}) {
  const head = (
    <div className="hairline-b flex flex-wrap items-center gap-1.5 px-2 py-1">
      <Tag>plan</Tag>
      {sheet ? (
        <FactChip
          tone={included.length ? "caution" : "meta"}
          title="Rows apply will send. Unticked and flagged rows are skipped."
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
          reason="Read a fresh plan for the saved spec."
          onClick={replan}
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
          <EmptyState story="scope" exit="re-plan the saved spec">
            the plan no longer describes this spec
          </EmptyState>
        </div>
      </section>
    );
  return (
    <section aria-label="Confirmation sheet" className="flex min-h-0 flex-col">
      {head}
      <div className="min-h-0 overflow-auto px-2 py-1">
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
        {/* A fixed layout gives `source` only what the fixed columns leave; the floor keeps it a
            column (the pane scrolls) instead of letting `exception` draw over it. */}
        <table className="w-full min-w-160 table-fixed border-separate border-spacing-0 t-small">
          <thead className="t-small face-mono t-upper text-ink-mute">
            <tr className={ROW}>
              <th className={cn(CELL, "w-8 font-normal")}>
                <span className="sr-only">include</span>
              </th>
              <th className={cn(CELL, "w-48 text-left font-normal")}>subject</th>
              <th className={cn(CELL, "w-20 text-left font-normal")}>actions</th>
              <th className={cn(CELL, "text-left font-normal")}>source</th>
              <th className={cn(CELL, "w-64 text-left font-normal")}>exception</th>
            </tr>
          </thead>
          <tbody>
            {sheet.entries.map((entry) => {
              const held = excluded.has(entry.id);
              return (
                <tr key={entry.id} className={cn(ROW, (entry.flag || held) && "text-ink-mute")}>
                  <td className={cn(CELL, "w-8 text-center")}>
                    <Press
                      type="button"
                      disabled={entry.flag !== null || !toggle}
                      title={
                        entry.flag
                          ? `${entry.flag}. Nothing to include.`
                          : held
                            ? `${entry.name} is held back; click to include its ${plural(entry.actions, "action")}.`
                            : `${entry.name} is in: apply runs its ${plural(entry.actions, "action")}.${toggle ? " Click to hold it back without re-planning." : ""}`
                      }
                      onClick={() => toggle?.(entry.id)}
                      tone="quiet"
                      size="value"
                      state={entry.flag ? "disabled" : held ? "rest" : "selected"}
                    >
                      {entry.flag ? "✕" : held ? "□" : "▪"}
                    </Press>
                  </td>
                  <td className={cn(CELL, "face-mono w-48 truncate")}>{entry.name}</td>
                  <td className={cn(CELL, "face-mono w-20 truncate")}>
                    {plural(entry.actions, "action")}
                  </td>
                  <td className={cn(CELL, "face-mono truncate text-ink-2")} title={entry.detail}>
                    {entry.detail}
                  </td>
                  <td
                    className={cn(CELL, "face-mono w-64 truncate text-ink-mute")}
                    title={entry.flag ?? ""}
                  >
                    {entry.flag ?? ""}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {sheet.entries.length === 0 ? (
          <EmptyState story="scope" exit="widen the scope, or plan another spec">
            the plan compiled cleanly and matched nothing
          </EmptyState>
        ) : null}
      </div>
    </section>
  );
}
