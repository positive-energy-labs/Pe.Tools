/**
 * THE SHEET — the product, like /family: one MasterTable row per candidate profile, inputs
 * editable in the row, derived columns live; the active row is what the drawing and chart show.
 * No drawing in the row: per-slot information lives only in the drawing pane.
 * Row density is a MasterTable gap owned by the design-system ledger; this consumer uses it as-is.
 */
import { NumberCell } from "#/components/master-table/cells";
import { Table } from "#/components/master-table/table";
import { TableFrame } from "#/components/master-table/table-frame";
import { useTableState } from "#/components/master-table/view";
import type { Column } from "#/components/master-table/model";
import { Tag } from "#/components/lang/chip";

import type { Grille, GrilleInput } from "./math";
import { SHEET_ROWS, frac, pct, solve } from "./math";
import { Press } from "#/components/lang/press";

export type SheetRow = Grille & { id: string };

const num = (
  key: keyof GrilleInput,
  label: string,
  title: string,
  set: (id: string, p: Partial<GrilleInput>) => void,
  integer = false,
): Column<SheetRow> => ({
  key,
  label,
  title,
  right: true,
  width: "w-16",
  sort: (r) => r[key],
  cell: (r) => (
    <NumberCell
      value={r[key]}
      digits={integer ? 0 : 4}
      integer={integer}
      min={integer ? 1 : 0}
      onCommit={(v) => set(r.id, { [key]: v })}
    />
  ),
});

const read = (
  key: string,
  label: string,
  title: string,
  cell: (r: SheetRow) => string,
  sort: (r: SheetRow) => number,
): Column<SheetRow> => ({
  key,
  label,
  title,
  right: true,
  sort,
  cell: (r) => <Tag>{cell(r)}</Tag>,
});

export function Sheet({
  rows,
  active,
  onActive,
  set,
  add,
  picked,
  onPickedChange,
}: {
  rows: SheetRow[];
  active: string;
  onActive: (id: string) => void;
  set: (id: string, p: Partial<GrilleInput>) => void;
  add: () => void;
  /** rows chosen for the export sheet */
  picked: ReadonlySet<string>;
  onPickedChange: (next: ReadonlySet<string>) => void;
}) {
  const [tableState, setTableState] = useTableState();
  const columns: Column<SheetRow>[] = [
    num("boardLength", "L", "Board length, inches", set),
    num("endBorder", "end", "End border, each end", set),
    num("boardWidth", "W", "Board width, inches", set),
    num("edgeBorder", "edge", "Edge border, each side", set),
    num("opening", "opening", "Opening (slot) width", set),
    num("rib", "rib", "Rib width between openings", set),
    num("openings", "qty", "Number of openings", set, true),
    read(
      "middle",
      "middle",
      "Middle used of middle available",
      (r) => `${frac(r.middleDimension)} / ${frac(r.middleAvailable)}`,
      (r) => r.slack,
    ),
    read(
      "free0",
      "free % pre",
      "Free area before end derate = qty·opening / W",
      (r) => pct(r.freeAreaBeforeDerate),
      (r) => r.freeAreaBeforeDerate,
    ),
    read(
      "derate",
      "derate",
      "Length derate = (L − 2·end) / L",
      (r) => r.lengthDerate.toFixed(3),
      (r) => r.lengthDerate,
    ),
    read(
      "free",
      "free %",
      "Overall free area",
      (r) => pct(r.freeArea),
      (r) => r.freeArea,
    ),
    read(
      "area",
      "in²",
      "Actual free area = opening · qty · (L − 2·end)",
      (r) => r.actualFreeArea.toFixed(2),
      (r) => r.actualFreeArea,
    ),
  ];
  return (
    <TableFrame
      label="grille profiles"
      rows={rows}
      columns={columns}
      rowKey={(r) => r.id}
      state={tableState}
      onStateChange={setTableState}
      summary={
        <Press type="button" tone="quiet" size="label" onClick={add}>
          + profile
        </Press>
      }
      selection={{ selected: picked, onChange: onPickedChange }}
    >
      <Table
        rows={rows}
        columns={columns}
        rowKey={(r) => r.id}
        label="grille profiles"
        state={tableState}
        onStateChange={setTableState}
        selection={{ selected: picked, onChange: onPickedChange }}
        activeKey={active}
        onRowClick={(r) => onActive(r.id)}
        gutter={(r) =>
          r.slack < -1e-9
            ? {
                count: 1,
                title: `middle is over by ${frac(-r.slack)}″ — does not fit`,
                tone: "alarm",
              }
            : null
        }
      />
    </TableFrame>
  );
}

export const seedRows = (): SheetRow[] =>
  SHEET_ROWS.map((r, i) => ({ ...solve(r), id: `row${i + 7}` }));
