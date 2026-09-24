import {
  memo,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";

import { ReadCell } from "#/components/master-table/cells";
import { CellNavigationProvider, type CellMove } from "#/components/master-table/cell-navigation";
import {
  ParamCell,
  type LiveCells,
  type ParamColumn,
  type TypeRow,
} from "#/families/matrix-columns";
import type { PivotFamily, PivotRow } from "#/families/pivot";
import type { FamiliesStore } from "#/families/store";
import type { MeasuredAnswer } from "#/host/measured-parse";
import { familyCellKey, type MeasuredDisplayUnit } from "@pe/agent-contracts";
import { cellFromTrichotomy, StateCell } from "#/components/lang/cell";

export const GRID = { identity: 336, type: 112, row: 24, header: 52 } as const;
export const identityWidth = GRID.identity;
const OVERSCAN = 3;

import { ParameterMetadata, type ParameterMetadataRecord } from "./parameter-metadata";
import type { OverlayCell, PatchOverlay } from "./patch-overlay";

const HOW = {
  type: "an explicit type cell",
  uniform: "the parameter's uniform value",
  alias: "a direct formula alias, read from its source in this type",
  formula: "a formula, not evaluated here",
} as const;

/** A cell the native patch writes: drawn in place, read-only; accept and deny sit on the patch's review row. */
function ProjectedCell({ cell, current }: { cell: OverlayCell; current: string }) {
  const shown = (cell.staged ?? cell.proposal)!;
  const rung = cell.staged ? "staged" : "proposed";
  return (
    <StateCell
      {...cellFromTrichotomy(cell, {
        value: shown.value,
        note: `The native patch (${rung}) writes ${current || "(blank)"} → ${shown.value} by ${HOW[shown.how]}. Review it on the patch row; nothing has reached Revit.`,
        scale: "row",
      })}
      placeholder={current}
    />
  );
}

export interface TypeGridEdit {
  metadata?: ReadonlyMap<string, readonly ParameterMetadataRecord[]>;
  params: ReadonlyMap<string, ParamColumn>;
  live: LiveCells;
  propose: FamiliesStore["actions"]["propose"];
  parse?: (unit: MeasuredDisplayUnit | null | undefined, text: string) => Promise<MeasuredAnswer>;
  readOnly: boolean;
  /** The native patch projected on this reading; absent on an archived reading. */
  overlay?: PatchOverlay;
}

export const TypeGrid = memo(function TypeGrid({
  rows,
  types,
  families,
  edit,
  scroller,
  empty,
}: {
  rows: readonly PivotRow[];
  types: readonly TypeRow[];
  families: readonly PivotFamily[];
  edit: TypeGridEdit;
  scroller: RefObject<HTMLDivElement | null>;
  empty?: ReactNode;
}) {
  const [viewport, setViewport] = useState({ top: 0, left: 0, width: 900, height: 500 });
  const frame = useRef(0);
  const pendingFocus = useRef<{ row: number; col: number } | null>(null);
  const totalWidth = identityWidth + types.length * GRID.type;
  const totalHeight = GRID.header + rows.length * GRID.row;
  const measure = useCallback(() => {
    const el = scroller.current;
    if (!el) return;
    setViewport((current) => {
      const next = {
        top: el.scrollTop,
        left: el.scrollLeft,
        width: el.clientWidth,
        height: el.clientHeight,
      };
      return Object.keys(next).every(
        (key) => current[key as keyof typeof current] === next[key as keyof typeof next],
      )
        ? current
        : next;
    });
  }, [scroller]);
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(el);
    const onScroll = () => {
      if (!frame.current)
        frame.current = requestAnimationFrame(() => {
          frame.current = 0;
          measure();
        });
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      observer?.disconnect();
      if (frame.current) cancelAnimationFrame(frame.current);
    };
  }, [scroller, measure]);
  useLayoutEffect(() => {
    measure();
  }, [rows.length, types.length, measure]);

  const rowStart = Math.max(
    0,
    Math.floor(Math.max(0, viewport.top - GRID.header) / GRID.row) - OVERSCAN,
  );
  const rowEnd = Math.min(
    rows.length,
    Math.max(
      rowStart + 1,
      Math.ceil((viewport.top + viewport.height - GRID.header) / GRID.row) + OVERSCAN,
    ),
  );
  const colStart = Math.max(
    0,
    Math.floor(Math.max(0, viewport.left - identityWidth) / GRID.type) - OVERSCAN,
  );
  const colEnd = Math.min(
    types.length,
    Math.max(
      colStart + 1,
      Math.ceil((viewport.left + viewport.width - identityWidth) / GRID.type) + OVERSCAN,
    ),
  );
  const visibleRows = rows.slice(rowStart, rowEnd);
  const visibleTypes = types.slice(colStart, colEnd);
  const groups = useMemo(() => {
    let start = 0;
    return families
      .map((family) => {
        const count = types.filter((type) => type.familyName === family.name).length;
        const group = { name: family.name, start, count };
        start += count;
        return group;
      })
      .filter((group) => group.count > 0);
  }, [families, types]);
  const focusPending = useCallback(() => {
    const target = pendingFocus.current;
    if (!target) return;
    const cell = scroller.current?.querySelector<HTMLElement>(
      `[data-grid-row="${target.row}"][data-grid-col="${target.col}"]`,
    );
    if (!cell) return;
    (cell.querySelector<HTMLElement>("input,button,[tabindex]") ?? cell).focus();
    pendingFocus.current = null;
  }, [scroller]);
  useLayoutEffect(focusPending, [viewport, focusPending]);
  const move = useCallback(
    (direction: CellMove) => {
      const current = document.activeElement?.closest<HTMLElement>(
        "[data-grid-row][data-grid-col]",
      );
      if (!current) return false;
      const row =
        Number(current.dataset.gridRow) + (direction === "down" ? 1 : direction === "up" ? -1 : 0);
      const col =
        Number(current.dataset.gridCol) +
        (direction === "right" ? 1 : direction === "left" ? -1 : 0);
      if (row < 0 || row >= rows.length || col < 0 || col >= types.length) return false;
      pendingFocus.current = { row, col };
      const el = scroller.current;
      if (!el) return false;
      const x = identityWidth + col * GRID.type;
      const y = GRID.header + row * GRID.row;
      const left =
        x < el.scrollLeft + identityWidth
          ? Math.max(0, x - identityWidth)
          : x + GRID.type > el.scrollLeft + el.clientWidth
            ? x + GRID.type - el.clientWidth
            : el.scrollLeft;
      const top =
        y < el.scrollTop + GRID.header
          ? Math.max(0, y - GRID.header)
          : y + GRID.row > el.scrollTop + el.clientHeight
            ? y + GRID.row - el.clientHeight
            : el.scrollTop;
      if (left !== el.scrollLeft || top !== el.scrollTop) el.scrollTo({ left, top });
      requestAnimationFrame(focusPending);
      return true;
    },
    [rows.length, types.length, scroller, focusPending],
  );

  return (
    <CellNavigationProvider move={move}>
      <div
        ref={scroller}
        className="min-h-0 flex-1 overflow-auto"
        role="grid"
        aria-label="parameters × family types"
        aria-rowcount={rows.length + 1}
        aria-colcount={types.length + 1}
      >
        <div
          style={{
            position: "relative",
            width: totalWidth,
            height: Math.max(totalHeight, viewport.height),
          }}
        >
          <div
            role="row"
            className="z-sticky"
            data-surface="recess"
            style={{
              position: "sticky",
              top: 0,
              width: totalWidth,
              height: GRID.header,
            }}
          >
            <div
              role="columnheader"
              className="z-popup t-small t-upper border-b px-2"
              data-surface="recess"
              style={{
                position: "sticky",
                left: 0,
                top: 0,
                display: "inline-flex",
                alignItems: "end",
                width: identityWidth,
                height: GRID.header,
              }}
            >
              parameter
            </div>
            {groups
              .filter((group) => group.start < colEnd && group.start + group.count > colStart)
              .map((group) => (
                <div
                  key={group.name}
                  role="presentation"
                  className="t-small t-upper truncate border-b border-l px-1"
                  data-surface="recess"
                  style={{
                    position: "absolute",
                    left: Math.max(
                      identityWidth + group.start * GRID.type,
                      viewport.left + identityWidth,
                    ),
                    top: 0,
                    width: Math.max(
                      0,
                      identityWidth +
                        Math.min(group.start + group.count, colEnd) * GRID.type -
                        Math.max(
                          identityWidth + group.start * GRID.type,
                          viewport.left + identityWidth,
                        ),
                    ),
                    height: 26,
                  }}
                  title={group.name}
                >
                  {group.name}
                </div>
              ))}
            {visibleTypes.map((type, offset) => (
              <div
                key={type.key}
                role="columnheader"
                aria-colindex={colStart + offset + 2}
                aria-label={`${type.familyName} · ${type.typeName}`}
                className="t-small truncate border-b border-l px-1"
                data-surface="recess"
                style={{
                  position: "absolute",
                  left: identityWidth + (colStart + offset) * GRID.type,
                  top: 26,
                  width: GRID.type,
                  height: 26,
                }}
                title={`${type.familyName} · ${type.typeName}`}
              >
                {type.typeName}
              </div>
            ))}
          </div>
          {visibleRows.map((row, rowOffset) => {
            const rowIndex = rowStart + rowOffset;
            return (
              <div
                key={row.key}
                role="row"
                aria-rowindex={rowIndex + 2}
                className="t-small"
                style={{
                  position: "absolute",
                  left: 0,
                  top: GRID.header + rowIndex * GRID.row,
                  width: totalWidth,
                  height: GRID.row,
                }}
              >
                <div
                  role="rowheader"
                  className="z-raised flex items-center border-b"
                  data-surface="recess"
                  style={{ position: "sticky", left: 0, width: identityWidth, height: GRID.row }}
                >
                  <div className="min-w-0 flex-1">
                    <ReadCell value={row.name} reason={row.key} />
                  </div>
                  {row.kind === "new" && (
                    <span
                      className="t-small shrink-0 px-1"
                      data-tone="pea"
                      title="The native patch creates this parameter; the reading has none by this name."
                    >
                      new
                    </span>
                  )}
                  <div className="shrink-0 pr-1">
                    <ParameterMetadata
                      row={row}
                      records={edit.metadata?.get(row.key) ?? []}
                      patch={edit.overlay?.parameters[row.name]}
                    />
                  </div>
                </div>
                {visibleTypes.map((type, offset) => {
                  const colIndex = colStart + offset;
                  const scope = type.scopes[row.key];
                  const present = scope && scope !== "Unresolved";
                  const projected =
                    edit.overlay?.cells[
                      familyCellKey({
                        familyName: type.familyName,
                        typeName: type.typeName,
                        parameter: row.name,
                      })
                    ];
                  return (
                    <div
                      key={type.key}
                      role="gridcell"
                      aria-colindex={colIndex + 2}
                      aria-label={`${row.name} · ${type.familyName} · ${type.typeName}`}
                      data-grid-row={rowIndex}
                      data-grid-col={colIndex}
                      tabIndex={-1}
                      className="border-b border-l"
                      style={{
                        position: "absolute",
                        left: identityWidth + colIndex * GRID.type,
                        top: 0,
                        width: GRID.type,
                        height: GRID.row,
                      }}
                    >
                      {projected && !edit.readOnly ? (
                        <ProjectedCell
                          cell={projected}
                          current={present ? (type.values[row.key] ?? "") : ""}
                        />
                      ) : !present ? (
                        <ReadCell
                          value="∅"
                          reason="parameter absent from this type"
                          className="text-ink-mute"
                        />
                      ) : edit.readOnly ? (
                        <ReadCell
                          value={type.values[row.key]?.trim() ? type.values[row.key] : "blank"}
                          reason="saved type value"
                        />
                      ) : (
                        <ParamCell
                          row={type}
                          col={edit.params.get(row.key)!}
                          live={edit.live}
                          propose={edit.propose}
                          parse={edit.parse}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}
          {rows.length === 0 && (
            <div
              className="p-6"
              style={{
                position: "sticky",
                left: 0,
                top: GRID.header,
                width: Math.min(viewport.width, 600),
              }}
            >
              {empty}
            </div>
          )}
        </div>
      </div>
    </CellNavigationProvider>
  );
});
