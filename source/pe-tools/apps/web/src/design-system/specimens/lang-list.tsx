/**
 * The list grammar's swatch frames: the one Row (its recipe and every state), and the containers
 * that draw it — List inline, ListPopup on a trigger, and the in-cell list. The full comparison of
 * every list kind on real data is /design-system/list.
 */
import { CellListSelect, List, ListPopup } from "#/components/lang/list-popup";
import { Row, RowGroupHead, rowRecipe } from "#/components/lang/row";
import { Table } from "#/components/master-table/table";

import { RecipeGrid, SpecimenFrame } from "./recipe-grid";

const KINDS = ["String", "Integer", "Double", "ElementId"];
const common = {
  items: KINDS,
  keyOf: (k: string) => k,
  labelOf: (k: string) => k,
  empty: "no storage types",
  row: (k: string) => ({ label: k }),
};

export function LangListSpecimens() {
  return (
    <>
      <RecipeGrid
        name="Row"
        importPath="#/components/lang/row"
        recipe={rowRecipe}
        render={(props) => (
          <div className="flex w-64 flex-col">
            <RowGroupHead label="states" count={6} />
            <Row label="rest" meta="meta" lines={props.lines === "2" ? 2 : 1} sub="second line" />
            <Row label="cursor" cursor />
            <Row label="selected" selected />
            <Row label="active" active />
            <Row label="pending" pending />
            <Row label="failed" failed />
            <Row label="refused" refusal="read-only in Revit" />
          </div>
        )}
      />
      <SpecimenFrame
        name="List · ListPopup · CellListSelect"
        importPath="#/components/lang/list-popup"
      >
        <div className="grid w-full grid-cols-3 gap-4">
          <List {...common} aria-label="inline list" region="swatch list" filter="substring" />
          <ListPopup
            {...common}
            anchor="trigger"
            trigger={<span className="face-mono">String ▾</span>}
            aria-label="popup list"
            region="swatch popup"
          />
          <Table<{ key: string }>
            label="cell list"
            rows={[{ key: "Width" }]}
            rowKey={(r) => r.key}
            columns={[
              {
                key: "storage",
                label: "storage",
                cell: () => (
                  <CellListSelect
                    {...common}
                    value="String"
                    aria-label="storage"
                    region="swatch table"
                  />
                ),
              },
            ]}
          />
        </div>
      </SpecimenFrame>
    </>
  );
}
