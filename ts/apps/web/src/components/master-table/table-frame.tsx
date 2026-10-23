import { useSearchKey } from "@pe/kit/lang/list-view";
/**
 * TABLE FRAME — a table's chrome, as a wrapper (the approved reshape): the box and one head line
 * holding the query box (every narrowing is a chip), summary, modes, select-all and actions. The
 * head carries no title: the pane or route names the table. Folded, the chips stay on one line and
 * end "+N more"; focus or an open picker unfolds them into a drawer across the frame. It holds no table state of its own: it reads the route's `state` and the same
 * `visibleRows(...)` the grid draws, so its counts are the grid's rows. A table that wants no
 * chrome is a bare `Table`.
 */
import { useLayoutEffect, useState, type ReactNode } from "react";
import type { RowData } from "@tanstack/react-table";

import { ArtifactFrame } from "@pe/kit/lang/artifact-frame";
import { NarrowChip } from "@pe/kit/lang/chip";
import { Button } from "@pe/kit/lang/button";
import { actionScopeKeys, useScopeKeys } from "@pe/kit/keys";
import type { Column, QueryCommand, QueryVocabulary, TableState } from "@pe/kit/table/model";
import { QueryBox } from "@pe/kit/table/query";
import { ColumnQuery, QueryWorkbench, queryCapabilities } from "@pe/kit/table/query-workbench";
import { selectableKeys, type TableSelection } from "@pe/kit/table/table";
import { visibleRows } from "@pe/kit/table/view";

export interface TableFrameProps<Row extends RowData> {
  /** The frame's accessible name; never drawn (round 12). */
  label: string;
  rows: readonly Row[];
  columns: readonly Column<Row>[];
  rowKey: (row: Row) => string;
  state: TableState;
  onStateChange: (state: TableState) => void;
  summary?: ReactNode;
  /** Offer free-text search even when no column declares a filter capability. */
  search?: true;
  /** The counts the placeholder says, for a route whose `rows` are already narrowed (`query`). Absent,
   * shown is the grid's rows and total is `rows`. */
  rowCount?: { shown: number; total: number };
  /** A route's own vocabulary, for rows it narrows before the frame sees them (families); absent,
   * the box names the columns that declare a `condition`. */
  query?: QueryVocabulary;
  /** A second vocabulary after `→`: the route's command over the rows the query keeps. */
  command?: QueryCommand;
  /** Route-owned filters narrowing the rows before the table sees them: one chip each. Present
   * (even empty), the box reserves its line, so a chip appearing never moves the grid. */
  chips?: { label: string; onClear: () => void }[];
  /** Route-owned controls at the head of the filters band (a source switcher, a year pick) that
   * write the same query the box shows as chips: one state, two inputs. */
  filters?: ReactNode;
  modes?: ReactNode;
  actions?: ReactNode;
  /** Present, the strip offers select-all over the shown rows. */
  selection?: TableSelection;
  children: ReactNode;
}

export function TableFrame<Row extends RowData>({
  label,
  rows,
  columns,
  rowKey,
  state,
  onStateChange,
  summary,
  search,
  rowCount,
  query,
  command,
  chips,
  filters,
  modes,
  actions,
  selection,
  children,
}: TableFrameProps<Row>) {
  const [foldRoot, setFoldRoot] = useState<HTMLDivElement | null>(null);
  useFoldCount(foldRoot);
  const visibleColumns = columns.filter((column) => !state.hiddenColumns?.includes(column.key));
  const [draft, setDraft] = useState("");
  const [queryInput, setQueryInput] = useState<HTMLInputElement | null>(null);
  const region = queryInput?.closest<HTMLElement>('[data-slot="artifact-frame"]') ?? null;
  useSearchKey({
    region: () => region,
    available: () => !!queryInput,
    focus: () => {
      queryInput?.focus();
      queryInput?.select();
    },
  });
  useScopeKeys(
    actionScopeKeys([
      {
        id: "table.filters",
        bindings: ["Shift+F"],
        label: "Open this table's filters",
        invoke: () => {
          const trigger = region?.querySelector<HTMLButtonElement>("[data-table-filter-trigger]");
          trigger?.focus();
          trigger?.click();
        },
      },
    ]),
    region,
  );
  // A route vocabulary narrowed the rows already; the frame only orders them.
  const shown = visibleRows(rows, visibleColumns, query ? { ...state, query: "" } : state).map(
    rowKey,
  );
  const counts = rowCount ?? { shown: shown.length, total: rows.length };
  const vocabulary = query ?? queryCapabilities(rows, visibleColumns, state);
  const capable =
    vocabulary.fields.some((field) => field.kind || field.sort) ||
    vocabulary.rules.length > 0 ||
    Boolean(vocabulary.filters?.length);
  const reach = selection ? selectableKeys(selection, shown) : [];
  const selectedShown = reach.filter((key) => selection!.selected.has(key)).length;
  const boxed =
    search === true ||
    query !== undefined ||
    command !== undefined ||
    chips !== undefined ||
    filters !== undefined ||
    capable ||
    Boolean(state.query);
  const controls = boxed && (
    <div
      ref={setFoldRoot}
      data-table-fold=""
      data-slot="table-query-controls"
      className="flex min-w-0 max-w-full flex-[1_1_20rem] items-center gap-1"
    >
      {filters}
      <QueryBox
        lead={
          capable ? (
            <QueryWorkbench vocabulary={vocabulary} state={state} onStateChange={onStateChange} />
          ) : undefined
        }
        vocabulary={vocabulary}
        state={state}
        onStateChange={onStateChange}
        draft={draft}
        onDraft={setDraft}
        onInput={setQueryInput}
        placeholder={`search ${counts.shown} of ${counts.total} rows`}
        command={command}
      >
        {chips?.map((chip) => (
          <NarrowChip
            key={chip.label}
            label={chip.label}
            onRemove={chip.onClear}
            title="A route-owned filter narrowing this table right now; removing it widens back out."
          />
        ))}
      </QueryBox>
    </div>
  );
  return (
    <ArtifactFrame
      className="relative"
      label={label}
      head={
        <>
          {controls}
          {summary && (
            <span className="min-w-0 truncate face-mono t-small text-ink-2">{summary}</span>
          )}
        </>
      }
      headTrail={
        <>
          {modes}
          {selection && reach.length > 0 && (
            <Button
              type="button"
              label={
                selectedShown === reach.length ? `clear ${reach.length}` : `select ${reach.length}`
              }
              onClick={() => {
                const next = new Set(selection.selected);
                if (selectedShown === reach.length) for (const key of reach) next.delete(key);
                else for (const key of reach) next.add(key);
                selection.onChange(next);
              }}
            >
              {selectedShown === reach.length ? `clear ${reach.length}` : `select ${reach.length}`}
            </Button>
          )}
          {actions}
        </>
      }
    >
      <ColumnQuery.Provider value={capable ? { vocabulary, state, onStateChange } : null}>
        {children}
      </ColumnQuery.Provider>
    </ArtifactFrame>
  );
}

/** Folded, chips past the line's end hide and the field says "+N more"; unfolded, every chip shows. */
function useFoldCount(root: HTMLElement | null) {
  useLayoutEffect(() => {
    const field = root?.querySelector<HTMLElement>("[data-search-field]");
    if (!root || !field) return;
    const fit = () => {
      // Open, the drawer wraps: the last folded count stays for the next close.
      if (root.matches(":focus-within, :has([data-popup-open])")) return;
      const chips = [...field.children].slice(0, -1);
      for (const chip of chips) chip.removeAttribute("data-fold-hidden");
      field.removeAttribute("data-fold-more");
      const right = field.getBoundingClientRect().right;
      // ponytail: fixed px reserves for the input (12ch) and the "+N more" word; measure them if a face changes.
      const past = (reserve: number) =>
        chips.filter((chip) => chip.getBoundingClientRect().right > right - reserve);
      if (past(96).length === 0) return;
      const hidden = past(96 + 64);
      for (const chip of hidden) chip.setAttribute("data-fold-hidden", "");
      field.setAttribute("data-fold-more", `+${hidden.length} more`);
    };
    fit();
    const resize = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(fit);
    resize?.observe(root);
    const mutation = new MutationObserver(fit);
    mutation.observe(field, { childList: true, subtree: true, characterData: true });
    const later = () => requestAnimationFrame(fit);
    root.addEventListener("focusout", later);
    return () => {
      resize?.disconnect();
      mutation.disconnect();
      root.removeEventListener("focusout", later);
    };
  }, [root]);
}
