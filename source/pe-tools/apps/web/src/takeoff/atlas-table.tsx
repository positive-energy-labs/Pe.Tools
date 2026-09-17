import { Suspense } from "react";
import { FactChip } from "#/components/lang/chip";
import { EmptyState } from "#/components/lang/empty";
import { Press } from "#/components/lang/press";
import { MasterTable } from "#/components/master-table/master-table";
import { fmtNum } from "#/components/master-table/model";
import { Pane, PaneSplit } from "#/components/lang/pane";
import { RoomPanelFromStore } from "#/takeoff/room-panel";
import type { AtlasRow as Row } from "#/takeoff/controller";
import { useAtlasWorkspace } from "#/takeoff/atlas-context";

export function AtlasTable() {
  const {
    store,
    world,
    live,
    actions,
    cursor,
    fieldsMode,
    setFieldsMode,
    tableState,
    rows,
    visibleKeys,
    setTableState,
    selectTableRow,
    hoverTableRow,
    visibleRows,
    cursorRow,
    decide,
    columns,
    chips,
    scopeCalls,
    scopeSqft,
    proposedUrl,
    reviewShortcuts,
  } = useAtlasWorkspace();
  const rowKey = (row: Row) => row.room.guid;
  const gutter = (row: Row) =>
    row.open.length > 0
      ? {
          count: row.open.length,
          tone: "alarm" as const,
          title: `${row.open.length} open detector call${row.open.length === 1 ? "" : "s"} owe a verdict — ${row.open.join(", ")} (a/d accepts or dismisses the first)`,
        }
      : null;
  return (
    <Suspense fallback={<div className="t-small t-upper p-2 text-ink-2">reading rooms…</div>}>
      <Pane
        id="rooms"
        kind="content"
        flush
        title="rooms"
        help="Rooms in the current scope. Filter, select, or review the visible rows. Focus this pane for j/k movement and a/d decisions."
        headerless
        scroll="clip"
        shortcuts={reviewShortcuts}
      >
        <PaneSplit
          axis="horizontal"
          resize={{
            target: "end",
            defaultSize: 288,
            minSize: 240,
            maxSize: 520,
            minOtherSize: 360,
            persist: "pe.takeoffs.room-panel-width",
            collapse: { collapsed: cursorRow == null, collapsedSize: 0 },
          }}
          start={
            <MasterTable
              rows={rows}
              columns={columns}
              rowKey={rowKey}
              gutter={gutter}
              scopeLabel="rooms in scope"
              searchPlaceholder="room / type / zone…"
              chips={chips}
              summary={
                <>
                  <span className="text-ink">
                    {visibleRows.length} rooms · {fmtNum(scopeSqft, 0)} sf
                  </span>
                  {scopeCalls > 0 && (
                    <FactChip
                      tone="alarm"
                      title={`${scopeCalls} room${scopeCalls === 1 ? "" : "s"} in the visible table need a human verdict`}
                    >
                      {scopeCalls} open call{scopeCalls === 1 ? "" : "s"}
                    </FactChip>
                  )}
                </>
              }
              modes={
                <Press
                  type="button"
                  onClick={() => setFieldsMode(fieldsMode === "panel" ? "columns" : "panel")}
                  title={
                    fieldsMode === "panel"
                      ? "Manual J fields are edited in the room panel for the cursor row; the table stays narrow. Click to move them back into the table as columns."
                      : "Manual J fields are table columns. Click to edit them in the room panel instead and narrow the table."
                  }
                  tone="neutral"
                  size="caption"
                  frame="line"
                >
                  fields · {fieldsMode}
                </Press>
              }
              empty={
                rows.length > 0 ? (
                  <EmptyState story="filter" exit="clear a column filter or the search">
                    the narrowing hid all {rows.length} rooms in scope
                  </EmptyState>
                ) : world.zones.some((z) => z.rooms.length > 0) ? (
                  <EmptyState story="filter" exit="widen the rail filter or press Esc">
                    no rooms in this scope — the rail filter or the plan selection narrowed past
                    every partitioned zone
                  </EmptyState>
                ) : (
                  <EmptyState
                    story="scope"
                    exit="adopt a zoning region, then partition it — rooms are materialized by partition"
                  >
                    no rooms anywhere yet — zones before partitioned have no rooms
                  </EmptyState>
                )
              }
              activeKey={cursor}
              tableState={tableState}
              onTableStateChange={setTableState}
              visibleKeys={visibleKeys}
              onRowClick={selectTableRow}
              onRowHover={hoverTableRow}
            />
          }
          end={
            cursorRow && (
              <RoomPanelFromStore
                store={store}
                row={cursorRow}
                live={live}
                fieldsMode={fieldsMode}
                shortcuts={reviewShortcuts}
                onDecide={decide}
                onPatch={(patch) => actions.patch(cursorRow.room.guid, patch)}
                url={proposedUrl}
              />
            )
          }
        />
      </Pane>
    </Suspense>
  );
}
