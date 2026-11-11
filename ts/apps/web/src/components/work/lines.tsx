/** Pending cells grouped by column and author tab. Row verbs fan out as one bound write;
 * cell chips locate their grid cells. The route owns the tab, and apply remains separate. */
import { useState, type ReactNode } from "react";
import type { CellLike } from "@pe/agent-contracts";
import { useList } from "@pe/kit/lang/collection";
import { ListView, type ListRowParts } from "@pe/kit/lang/list-view";
import { Scroll } from "@pe/kit/lang/scroll";
import { Button } from "@pe/kit/lang/button";
import { StateCell, type StateCellProps } from "@pe/kit/lang/cell";
import { TooltipHint } from "@pe/kit/lang/tooltip";
import { Switcher } from "@pe/kit/lang/switcher";
import { clearWord, plural, UnstageAll, type CellWire, type ClearOutcome } from "./band";

/** One pending cell as its route addresses it. */
export interface WorkCell {
  key: string;
  /** The grid column: a schedule header, a family parameter. */
  column: string;
  /** The grid row in the person's words: the schedule's key column value, a family type. */
  row: string;

  value: string;
  /** The grid's read-only drawing of this cell (`cellFromDraft`). */
  look: StateCellProps;
  /** Put the grid's focus on this cell; absent = the grid cannot be told where to look. */
  locate?: () => void;
}

export type WorkTab = "pea" | "human";
const tabOf = (look: StateCellProps): WorkTab => (look.author === "pea" ? "pea" : "human");

interface WorkLine {
  column: string;
  tab: WorkTab;

  by: "pea" | "human" | "unknown" | "mixed";
  cells: WorkCell[];
  /** Distinct values, most frequent first. */
  values: { value: string; count: number; look: StateCellProps }[];
}

/** Group cells into lines: one per column and tab (ruling 60), in first-seen order. */
export function workLines(cells: readonly WorkCell[]): WorkLine[] {
  const lines = new Map<string, WorkLine>();
  for (const cell of cells) {
    const tab = tabOf(cell.look);
    const by = cell.look.author ?? "unknown";
    const id = JSON.stringify([cell.column, tab]);
    const line = lines.get(id) ?? { column: cell.column, tab, by, cells: [], values: [] };
    if (line.by !== by) line.by = "mixed";
    line.cells.push(cell);
    const seen = line.values.find((entry) => entry.value === cell.value);
    if (seen) seen.count++;
    else line.values.push({ value: cell.value, count: 1, look: cell.look });
    lines.set(id, line);
  }
  for (const line of lines.values()) line.values.sort((a, b) => b.count - a.count);
  return [...lines.values()];
}

const LINE = "flex h-(--control-h) min-w-0 items-center gap-2 whitespace-nowrap";
const CHIPS = 6;

export function WorkLines({
  cells,
  store,
  wire,
  tab: picked,
  onTab,
  above,
}: {
  cells: readonly WorkCell[];

  store: Record<string, CellLike>;
  wire: CellWire;
  /** The route's `lines` field; absent = Pea's tab while it has lines, else yours. */
  tab: WorkTab | "all" | undefined;
  onTab: (tab: WorkTab | "all") => void;
  /** What the Work carries beside its cells, drawn under the switch (a native patch row). */
  above?: ReactNode;
}) {
  const lines = workLines(cells);
  const has = (tab: WorkTab) => lines.some((line) => line.tab === tab);
  const tab = picked ?? (has("pea") || !has("human") ? "pea" : "human");
  const [outcome, setOutcome] = useState<ClearOutcome | null>(null);
  const shown = lines.filter((line) => tab === "all" || line.tab === tab);
  const keys = shown.flatMap((line) => line.cells.map((cell) => cell.key));
  const count = (of: WorkTab | "all") =>
    lines
      .filter((line) => of === "all" || line.tab === of)
      .reduce((n, line) => n + line.cells.length, 0);
  const list = useList({
    items: shown,
    keyOf: (line) => JSON.stringify([line.column, line.tab]),
    search: (line) => ({
      text: [line.column, line.by, ...line.cells.flatMap((cell) => [cell.row, cell.value])],
    }),
    stageOf: () => "edit",
    select: "single",
    onPick: (line) => line.cells[0]?.locate?.(),
  });
  if (!cells.length && !above) return null;
  return (
    <section aria-label="pending cells" className="flex min-w-0 flex-col">
      <div className={LINE}>
        <Switcher<WorkTab | "all">
          ariaLabel="pending tab"
          value={tab}
          onChange={(next) => {
            onTab(next);
            setOutcome(null);
          }}
          options={[
            {
              value: "pea",
              label: `Pea ${count("pea")}`,
              title: "Staged by Pea",
            },
            { value: "human", label: `you ${count("human")}`, title: "edit values" },
            { value: "all", label: `all ${count("all")}`, title: "every pending cell" },
          ]}
        />
        {outcome ? (
          <span
            className="min-w-0 truncate t-small text-ink-2"
            data-tone={outcome.refusal ? "caution" : undefined}
            role="status"
          >
            {clearWord(outcome)}
          </span>
        ) : null}
        <span className="ml-auto flex items-center gap-1">
          <UnstageAll wire={wire} cells={store} keys={keys} done={setOutcome} compact />
        </span>
      </div>
      {above}
      {/* Exception to "a list scrolls in its own Scroll": both callers sit in the head's Work slot,
          which still scrolls natively (route/situation.tsx, phase 2). This Scroll grows to its
          content, so the list draws every line; ponytail: fine at per-parameter line counts, and
          it goes when that slot becomes the Scroll. */}
      <Scroll>
        <ListView
          list={list}
          aria-label="pending cells"
          empty={{
            message: "No pending cells in this tab",
            exit: "Choose another tab or edit a cell",
          }}
          row={(line) => lineParts(line, store, wire, setOutcome)}
        />
      </Scroll>
    </section>
  );
}

function lineParts(
  line: WorkLine,
  store: Record<string, CellLike>,
  wire: CellWire,
  done: (outcome: ClearOutcome) => void,
): ListRowParts {
  const keys = line.cells.map((cell) => cell.key);
  const n = line.cells.length;
  const more = line.values.length - 2;
  // Staged over a value Revit has since changed: marked on the line; apply's popover answers it.
  const drift = line.cells.filter((cell) => cell.look.agree === "drift").length;
  return {
    label: line.column,
    lines: 2,
    stage: "edit",
    author: line.by === "mixed" ? undefined : line.by,
    meta: (
      <>
        <span data-tone={line.by === "pea" ? "pea" : undefined}>{line.by}</span>
        {plural(n, "cell")}
      </>
    ),
    sub: (
      <span
        className="flex min-w-0 flex-wrap items-center gap-1"
        onClick={(event) => event.stopPropagation()}
      >
        {line.values.slice(0, 2).map(({ value, count, look }) => (
          <span key={value} className="flex shrink-0 items-center gap-0.5">
            <span className="w-36">
              <StateCell {...look} scale="row" />
            </span>
            {count > 1 ? <span className="t-small face-mono text-ink-2">×{count}</span> : null}
          </span>
        ))}
        {more > 0 ? <span className="t-small text-ink-2">+{more} more</span> : null}
        <span className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden">
          {line.cells.slice(0, CHIPS).map((cell) =>
            cell.locate ? (
              <Button kind="quiet"
                key={cell.key}
                label={`${cell.row} · ${line.column}`}
                reason={`${cell.row} · ${line.column}: ${cell.value} — show this cell in the grid`}
                onClick={cell.locate}
              >
                <span className="face-mono">{cell.row}</span>
              </Button>
            ) : (
              <span key={cell.key} className="t-small face-mono text-ink-2">
                {cell.row}
              </span>
            ),
          )}
          {n > CHIPS ? <span className="t-small text-ink-2">+{n - CHIPS}</span> : null}
        </span>
        {drift ? (
          <TooltipHint content="Revit changed these cells after you edit them; apply's popover overwrites or keeps Revit's">
            <span className="t-small" data-tone="alarm">
              {drift} changed in Revit
            </span>
          </TooltipHint>
        ) : null}
      </span>
    ),
    actions: (
      <span className="flex shrink-0 items-center gap-1">
        <UnstageAll wire={wire} cells={store} keys={keys} done={done} compact />
      </span>
    ),
  };
}
