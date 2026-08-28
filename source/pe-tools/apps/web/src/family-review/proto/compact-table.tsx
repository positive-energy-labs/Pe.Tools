/**
 * PROTOTYPE (round 2) — COMPACT TABLE MODE.
 *
 * The table language has one full mode already: `MasterTable`, which owns scope, search, facets,
 * sorting and the gutter, and costs a header strip plus a toolbar. The A/C boards both grew a
 * hand-rolled pseudo-table underneath a drawing instead, because a 6-row claim list under a
 * triptych cannot pay for that chrome. Round 1 shipped that list twice as anonymous markup. This
 * is the same list, named — the COMPACT mode of the table, not a second table.
 *
 * What compact keeps: hairline rows, mono values, one clipped line per cell, right-aligned
 * numerics, a labelled empty.
 * What compact drops: every narrowing affordance. A compact table shows exactly the rows it was
 * handed — if the caller wants filtering, it wants `MasterTable`.
 *
 * WHAT IT DOES NOT DROP IS EDITABILITY. This is the round-2 finding to prove: a dense list is not
 * a read-only list. Cells ride the same `StateCell` (through `/family`'s `NavStateCell`) that the
 * `/family` route edits through, so the caret behaviour, the refusal note, the unsaved square, the
 * bold and the Enter/Tab/arrow walk are the SAME code — not a lookalike. A second editable cell
 * built here would be a second grammar, and the whole point of the cell primitive is that there
 * is one.
 */
import type { ReactNode } from "react";

import { EmptyState } from "#/components/lang/empty";
import { CellNavigationProvider, type CellMove } from "#/components/master-table/cell-navigation";
import { NavStateCell } from "#/family/marks";
import { cn } from "#/lib/utils";

/** The editable slot of a compact cell. Omit `onCommit` and the cell renders LOCKED, with a
 *  reason — a refusal a reader can see beats a caret that silently does nothing. */
export interface CompactEdit {
  value: string;
  onCommit?: (text: string) => string | void;
  /** Required when `onCommit` is absent: why this cell refuses the caret. */
  capReason?: string;
  /** An unsaved edit is sitting on this cell — the bold plus the caution square. */
  staged?: boolean;
}

export interface CompactColumn<Row> {
  key: string;
  label: string;
  /** Tailwind width class on the `col`, e.g. `w-24`. Omit for the flexible remainder. */
  width?: string;
  right?: boolean;
  /** The read rendering. */
  cell: (row: Row) => ReactNode;
  /** Present ⇒ this column carries the cell grammar. Return null to fall back to `cell`. */
  edit?: (row: Row) => CompactEdit | null;
}

export function CompactTable<Row>({
  rows,
  columns,
  rowKey,
  rowTitle,
  empty,
}: {
  rows: readonly Row[];
  columns: readonly CompactColumn<Row>[];
  rowKey: (row: Row) => string;
  rowTitle?: (row: Row) => string | undefined;
  /** REQUIRED shape, same law as `EmptyState`: whose emptiness, and the way out of it. */
  empty: { story: "scope" | "filter"; exit: string; children: ReactNode };
}) {
  if (!rows.length)
    return (
      <EmptyState story={empty.story} exit={empty.exit}>
        {empty.children}
      </EmptyState>
    );

  return (
    <CellNavigationProvider
      move={(direction) =>
        document.activeElement instanceof HTMLElement && moveFrom(document.activeElement, direction)
      }
    >
      <table className="w-full table-fixed face-mono t-label">
        <colgroup>
          {columns.map((column) => (
            <col key={column.key} className={column.width} />
          ))}
        </colgroup>
        <thead>
          <tr className="t-caption text-ink-mute">
            {columns.map((column) => (
              <th
                key={column.key}
                className={cn("font-normal", column.right ? "text-right" : "text-left")}
              >
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={rowKey(row)}
              className="border-t border-line align-top"
              title={rowTitle?.(row)}
            >
              {columns.map((column) => {
                const edit = column.edit?.(row) ?? null;
                return (
                  <td
                    key={column.key}
                    className={cn("truncate pr-2", column.right && "pr-0 text-right")}
                  >
                    {edit ? (
                      <NavStateCell
                        value={edit.value}
                        cap={edit.onCommit ? "editable" : "readonly"}
                        capReason={edit.capReason}
                        stage={edit.staged ? "staged" : "clean"}
                        stagedBy="you"
                        onCommit={edit.onCommit}
                      />
                    ) : (
                      column.cell(row)
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </CellNavigationProvider>
  );
}

/**
 * Enter / Tab / arrows walk the inputs. `MasterTable` moves cell FOCUS (its cells are focusable
 * grid stops); compact has no grid focus model, so it moves the caret itself — up and down keep
 * the column and skip rows whose cell is locked, left and right walk document order.
 */
function moveFrom(origin: HTMLElement, direction: CellMove): boolean {
  const cell = origin.closest("td");
  const row = cell?.parentElement;
  const table = row?.closest("table");
  if (!cell || !row || !table) return false;

  if (direction === "left" || direction === "right") {
    const inputs = [...table.querySelectorAll<HTMLInputElement>("input")];
    const next =
      inputs[inputs.indexOf(origin as HTMLInputElement) + (direction === "left" ? -1 : 1)];
    if (!next) return false;
    next.focus();
    return true;
  }

  let sibling = direction === "up" ? row.previousElementSibling : row.nextElementSibling;
  while (sibling) {
    const input = sibling.children[cell.cellIndex]?.querySelector("input");
    if (input instanceof HTMLInputElement) {
      input.focus();
      return true;
    }
    sibling = direction === "up" ? sibling.previousElementSibling : sibling.nextElementSibling;
  }
  return false;
}
