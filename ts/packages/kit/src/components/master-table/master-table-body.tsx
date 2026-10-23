import { VIRTUAL_FROM } from "../lang/collection";
import type { Tone } from "../../lib/token";
import {
  createRef,
  Fragment,
  memo,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import type { ReactTable, RowData } from "@tanstack/react-table";
import { defaultRangeExtractor, useVirtualizer, type Range } from "@tanstack/react-virtual";

import { Minimap, type MinimapMark } from "../lang/gutter-minimap";
import { CellHost } from "../lang/cell";
import { land } from "../lang/land";
import { Row } from "../lang/row";
import { CellNavigationProvider, type CellMove } from "./cell-navigation";
import type { ResolvedColumn } from "./master-table-columns";
import { CELL_EDITOR, editCell, isInteractive, isTypingKey } from "./master-table-state";
import type { MasterTableFeatures } from "./tanstack-adapter";
import { actionScopeKeys, useScopeKeys } from "../../keys";
import { token } from "../../lib/token";
import { cn, focusQuiet } from "../../lib/utils";
import { TooltipHint } from "../lang/tooltip";
import { CellContextMenu } from "./cell-context-menu";
import { cellCopyText, createTableActions } from "./table-actions";

type Table<Row extends RowData> = ReactTable<MasterTableFeatures, Row, unknown>;
type VisibleRow<Row extends RowData> = ReturnType<Table<Row>["getRowModel"]>["rows"][number];
type Gutter<Row> = (row: Row) => {
  count: number;
  title: string;
  tone?: Tone;
} | null;

interface MasterRowProps<Row extends RowData> {
  row: Row;
  revit?: readonly number[];
  /** The row's key, as `data-key`: a `Connectors` anchor and a test handle. */
  rowKey: string;
  /** The row's place in the shown order: the virtualizer's measure handle and the keys' address. */
  index: number;
  measure?: (element: HTMLTableRowElement | null) => void;
  active: boolean;
  selected?: boolean;
  /** Present, the row refuses selection and says why. */
  refusal?: string | null;
  damage?: string | null;
  activeRowRef: React.RefObject<HTMLTableRowElement | null>;
  className: string;
  onRowClick?: (row: Row) => void;
  onSelect?: (key: string, range: boolean) => void;
  onRowHover?: (row: Row | null) => void;
  /** The columns the children were drawn from: a row's cells redraw when the columns do. */
  columns: unknown;
  draft: unknown;
  /** The row's cells, drawn only when the row itself renders: built eagerly as children, every
   *  row's cells were rebuilt on each body render (each virtual scroll frame) and then discarded
   *  by the memo. Like children, it is not compared; `columns`, `draft` and `entry` stand for it. */
  cells: () => ReactNode;
  /** This row holds the grid's Tab stop. */
  entry: boolean;
}

function MasterRowView<Row extends RowData>({
  row,
  rowKey,
  index,
  measure,
  revit,
  active,
  selected,
  refusal,
  damage,
  activeRowRef,
  className,
  onRowClick,
  onSelect,
  onRowHover,
  cells,
  draft: _draft,
}: MasterRowProps<Row>) {
  const ref = useCallback(
    (element: HTMLTableRowElement | null) => {
      if (active) activeRowRef.current = element;
      measure?.(element);
    },
    [active, activeRowRef, measure],
  );
  return (
    <Row
      as="tr"
      ref={ref}
      data-key={rowKey}
      data-index={index}
      revit={revit}
      active={active}
      selected={selected}
      refusal={refusal}
      damage={damage}
      className={className}
      onMouseEnter={onRowHover ? () => onRowHover(row) : undefined}
      onMouseLeave={onRowHover ? () => onRowHover(null) : undefined}
      onClick={(event) => {
        if ((event.target as HTMLElement).closest("button,input,select,textarea,a,[role=button]"))
          return;
        onSelect?.(rowKey, (event as MouseEvent<HTMLTableRowElement>).shiftKey);
        onRowClick?.(row);
      }}
    >
      {cells()}
    </Row>
  );
}

const MasterRow = memo(
  MasterRowView,
  (previous, next) =>
    previous.row === next.row &&
    previous.rowKey === next.rowKey &&
    previous.index === next.index &&
    previous.measure === next.measure &&
    previous.revit?.join(",") === next.revit?.join(",") &&
    previous.active === next.active &&
    previous.selected === next.selected &&
    previous.refusal === next.refusal &&
    previous.damage === next.damage &&
    previous.className === next.className &&
    previous.onRowClick === next.onRowClick &&
    previous.onSelect === next.onSelect &&
    previous.onRowHover === next.onRowHover &&
    // Cell state often lives in the columns (a route's Work), not the row: without this, a
    // stable row skipped every Work change and a staged cell never showed its mark.
    previous.columns === next.columns &&
    previous.entry === next.entry &&
    previous.draft === next.draft,
) as typeof MasterRowView;

export function MasterTableBody<Row extends RowData>({
  table,
  visibleRows,
  columnByKey,
  activeKey,
  rowClassName,
  revit,
  keep,
  onRowClick,
  selectedKeys,
  refusalOf,
  onSelect,
  onRowHover,
  gutter,
  gutterWidth,
  cellEdit,
  scroller,
}: {
  /** The element that scrolls the grid: the virtual rows' viewport. */
  scroller: HTMLElement | null;
  table: Table<Row>;
  visibleRows: VisibleRow<Row>[];
  columnByKey: ReadonlyMap<string, ResolvedColumn<Row>>;
  activeKey?: string | null;
  rowClassName?: (row: Row) => string | undefined;
  revit?: (row: Row) => readonly number[];
  keep?: (row: Row) => boolean;
  onRowClick?: (row: Row) => void;
  selectedKeys?: ReadonlySet<string>;
  refusalOf?: (key: string) => string | null | undefined;
  onSelect?: (key: string, range: boolean) => void;
  onRowHover?: (row: Row | null) => void;
  gutter?: Gutter<Row>;
  gutterWidth: number;
  cellEdit?: {
    read: (row: Row, column: string) => string;
    fill: (cells: readonly { row: Row; column: string }[], text: string) => void;
  };
}) {
  const activeRowRef = useRef<HTMLTableRowElement | null>(null);
  const selectingEditor = useRef(false);
  const [draft, setDraft] = useState<{
    id: string;
    text: string;
    targets: { row: Row; column: string }[];
  } | null>(null);
  const draftFinished = useRef(false);
  const [context, setContext] = useState<{
    row: Row;
    column: ResolvedColumn<Row>;
    cell: HTMLTableCellElement;
  } | null>(null);
  const [focusedCell, setFocusedCell] = useState<HTMLTableCellElement | null>(null);
  const focusedCellRef = useRef<HTMLTableCellElement | null>(null);
  const [tbody, setTbody] = useState<HTMLTableSectionElement | null>(null);
  const [copyFailed, setCopyFailed] = useState<HTMLTableCellElement | null>(null);
  const finishDraft = (commit: boolean) => {
    if (!draft || draftFinished.current) return;
    draftFinished.current = true;
    if (commit) cellEdit?.fill(draft.targets, draft.text);
    setDraft(null);
    hosts.current.get(draft.id)?.current?.focus();
  };
  // The td is each cell's keyboard host: one stable ref per cell id, handed to whatever the column
  // draws (a StateCell registers its verbs on it). ponytail: never pruned; ids are bounded by rows.
  const hosts = useRef(new Map<string, RefObject<HTMLTableCellElement | null>>());
  const hostOf = (id: string) => {
    let ref = hosts.current.get(id);
    if (!ref) hosts.current.set(id, (ref = createRef<HTMLTableCellElement>()));
    return ref;
  };
  // N3/N6: a long grid draws only the rows in view (the same TanStack virtualizer as `ListView`),
  // with spacer rows holding the scroll extent so the native table layout keeps its column widths.
  // The focused and active rows stay drawn when scrolled away, so focus and keys never fall to the
  // page. ponytail: 60 is ListView's cut; a short grid draws every row and measures nothing.
  // Virtual from the first render: drawing every row until the scroller is known laid out the
  // whole grid once (374 ms for 2000 rows, production bundle).
  const virtualized = visibleRows.length >= VIRTUAL_FROM;
  const [margin, setMargin] = useState(0);
  const [headroom, setHeadroom] = useState(0);
  useLayoutEffect(() => {
    if (!virtualized || !tbody || !scroller) return;
    const head = tbody.previousElementSibling as HTMLElement | null;
    const measure = () => {
      setMargin(
        tbody.getBoundingClientRect().top -
          scroller.getBoundingClientRect().top -
          scroller.clientTop +
          scroller.scrollTop,
      );
      setHeadroom(head?.offsetHeight ?? 0);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(scroller);
    if (head) observer.observe(head);
    return () => observer.disconnect();
  }, [virtualized, tbody, scroller]);
  const indexOf = useMemo(
    () => new Map(visibleRows.map((row, index) => [row.id, index])),
    [visibleRows],
  );
  const focusedKey = focusedCell?.isConnected ? focusedCell.parentElement?.dataset.key : undefined;
  const pinned = [focusedKey, activeKey ?? undefined]
    .map((key) => (key === undefined ? undefined : indexOf.get(key)))
    .filter((index): index is number => index !== undefined);
  if (virtualized && keep)
    visibleRows.forEach((row, index) => {
      if (keep(row.original)) pinned.push(index);
    });
  const pinnedKey = pinned.join(",");
  const rangeExtractor = useCallback(
    (range: Range) =>
      [...new Set([...defaultRangeExtractor(range), ...pinned])].sort((a, b) => a - b),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pinnedKey],
  );
  const virtual = useVirtualizer({
    count: virtualized ? visibleRows.length : 0,
    getScrollElement: () => scroller,
    estimateSize: () => ROW_ESTIMATE,
    getItemKey: (index) => visibleRows[index]!.id,
    overscan: 8,
    scrollMargin: margin,
    scrollPaddingStart: headroom,
    rangeExtractor,
  });
  const drawn = virtualized
    ? virtual.getVirtualItems().map((item) => ({
        index: item.index,
        start: item.start - margin,
        end: item.end - margin,
      }))
    : visibleRows.map((_, index) => ({ index, start: 0, end: 0 }));
  const damageOf = (row: Row) => {
    const own = "damage" in row ? row.damage : null;
    if (typeof own === "string" && own) return own;
    for (const column of columnByKey.values()) {
      const state = column.readState?.(row);
      if (state?.damage) return state.damage;
      const verdict = column.readVerdict?.(row);
      if (verdict?.tone === "alarm") return verdict.word;
    }
    return null;
  };
  const damages = visibleRows.map((row) => damageOf(row.original));
  const minimapMarks = damages.flatMap((damage, index): MinimapMark[] =>
    damage ? [{ index, damage }] : [],
  );
  const landing = useRef<number | null>(null);
  useLayoutEffect(() => {
    if (landing.current === null) return;
    const row = tbody?.querySelector<HTMLElement>(`tr[data-index="${landing.current}"]`);
    if (row) {
      landing.current = null;
      land(row);
    }
  });
  const tail = virtualized ? virtual.getTotalSize() - (drawn.at(-1)?.end ?? 0) : 0;

  // N1: the active row is followed into view only when it was named from elsewhere (a link, the
  // address, another pane). A press on the row itself keeps the view where the person put it.
  const pressedKey = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (!activeKey) return;
    const index = indexOf.get(activeKey);
    if (index === undefined) return;
    land(activeRowRef.current, {
      requested: pressedKey.current !== activeKey,
      scroll: virtualized ? () => virtual.scrollToIndex(index, { align: "auto" }) : undefined,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeKey]);

  // Stable handlers for every row: a caller's inline arrow (or a per-row one) broke the row memo,
  // so one click redrew every drawn row, and a virtual body renders on every scroll frame.
  const handlers = useRef({ onSelect, onRowClick, onRowHover });
  handlers.current = { onSelect, onRowClick, onRowHover };
  const select = useCallback(
    (key: string, range: boolean) => handlers.current.onSelect?.(key, range),
    [],
  );
  const rowClick = useCallback((row: Row) => handlers.current.onRowClick?.(row), []);
  const rowHover = useCallback((row: Row | null) => handlers.current.onRowHover?.(row), []);
  // Memoized rows keep the first `moveFrom` they were drawn with, so it reads today's grid here.
  const grid = useRef({ tbody, count: visibleRows.length, virtualized, virtual });
  grid.current = { tbody, count: visibleRows.length, virtualized, virtual };
  const moveFrom = useCallback(
    (origin: HTMLElement, direction: CellMove, wrapHorizontal = false): boolean => {
      const { tbody, count, virtualized, virtual } = grid.current;
      const cell = origin.closest<HTMLTableCellElement>("[data-master-cell]");
      const row = cell?.parentElement;
      if (!cell || !row || !tbody) return false;
      const rowAt = (index: number) =>
        tbody.querySelector<HTMLTableRowElement>(`:scope > tr[data-index="${index}"]`);
      const at = Number(row.dataset.index);
      const left = direction === "left";
      let goal = at;
      let column = cell.cellIndex;
      if (direction === "up" || direction === "down") goal = at + (direction === "up" ? -1 : 1);
      else {
        let sibling = left ? cell.previousElementSibling : cell.nextElementSibling;
        if (sibling?.hasAttribute("data-master-gutter")) sibling = null;
        if (sibling) column = (sibling as HTMLTableCellElement).cellIndex;
        else if (wrapHorizontal) {
          goal = at + (left ? -1 : 1);
          column = left ? row.children.length - 1 : 0;
        } else return false;
      }
      if (goal < 0 || goal >= count) return false;
      const arrive = () => {
        let target = rowAt(goal)?.children[column] as HTMLElement | undefined;
        if (target?.hasAttribute("data-master-gutter"))
          target = target.nextElementSibling as HTMLElement | undefined;
        if (!target) return false;
        // A key the person pressed: focus quietly, then bring exactly that cell into view.
        focusQuiet(target);
        land(target);
        return true;
      };
      if (rowAt(goal)) return arrive();
      if (!virtualized) return false;
      // The row is not drawn yet: scroll it in, then land once the virtualizer has drawn it.
      virtual.scrollToIndex(goal, { align: "auto" });
      requestAnimationFrame(() => requestAnimationFrame(arrive));
      return true;
    },
    [],
  );
  const openContext = useCallback(
    (cell: HTMLTableCellElement) => {
      const row = visibleRows.find((item) => item.id === cell.parentElement?.dataset.key);
      const column = columnByKey.get(cell.dataset.columnKey ?? "");
      if (!row || !column) return false;
      setContext({ row: row.original, column, cell });
      return true;
    },
    [columnByKey, visibleRows],
  );
  const copyCell = useCallback(
    (cell: HTMLTableCellElement) => {
      const row = visibleRows.find((item) => item.id === cell.parentElement?.dataset.key);
      const column = columnByKey.get(cell.dataset.columnKey ?? "");
      const fallback =
        (row && column ? cellEdit?.read(row.original, column.key) : undefined) ??
        cell.innerText ??
        cell.textContent ??
        "";
      const value = cellCopyText(cell, fallback);
      setCopyFailed(null);
      try {
        const clipboard = navigator.clipboard;
        if (!clipboard?.writeText) throw new Error("Clipboard unavailable");
        void clipboard.writeText(value).catch(() => setCopyFailed(cell));
        return true;
      } catch {
        setCopyFailed(cell);
        return true;
      }
    },
    [cellEdit, columnByKey, visibleRows],
  );
  const actions = createTableActions({
    getCell: () => {
      const cell = focusedCell;
      return cell?.isConnected && focusedCellRef.current === cell && document.activeElement === cell
        ? cell
        : null;
    },
    moveFrom,
    edit: (cell) => editCell(cell),
    copy: copyCell,
    openContext,
  });
  useScopeKeys(actionScopeKeys(actions), tbody);
  const handleGridKey = useCallback(
    (event: KeyboardEvent<HTMLTableCellElement>) => {
      if (cellEdit && isTypingKey(event) && table.getSelectedCellCount() > 1) {
        const selected = visibleRows.flatMap((row) =>
          row
            .getVisibleCells()
            .filter((cell) => cell.getIsSelected())
            .map((cell) => ({
              row: row.original,
              column: cell.column.id,
            })),
        );
        draftFinished.current = false;
        setDraft({ id: event.currentTarget.dataset.cellId!, text: event.key, targets: selected });
        event.preventDefault();
        return;
      }
      if (isTypingKey(event) && editCell(event.currentTarget, event.key))
        return event.preventDefault();
    },
    [cellEdit, table, visibleRows],
  );

  return (
    <tbody
      ref={setTbody}
      onClickCapture={(event) => {
        pressedKey.current =
          (event.target as HTMLElement).closest<HTMLElement>("tr[data-key]")?.dataset.key ?? null;
      }}
      onFocusCapture={(event) => {
        const cell = (event.target as HTMLElement).closest<HTMLTableCellElement>(
          "[data-master-cell]",
        );
        if (cell) {
          focusedCellRef.current = cell;
          setFocusedCell(cell);
        }
      }}
      onContextMenu={(event) => {
        const target = event.target as HTMLElement;
        const editor = target.closest("input,textarea,select,[contenteditable=true]");
        if (editor?.contains(document.activeElement)) return;
        const cell = target.closest<HTMLTableCellElement>("[data-master-cell]");
        if (!cell) return;
        event.preventDefault();
        openContext(cell);
      }}
    >
      <Minimap
        count={visibleRows.length}
        range={
          virtual.range
            ? {
                start: virtual.range.startIndex,
                end: virtual.range.endIndex,
              }
            : null
        }
        marks={minimapMarks}
        scroller={scroller}
        height={virtual.scrollRect?.height ?? 0}
        onJump={(index) => {
          landing.current = index;
          virtual.scrollToIndex(index, { align: "start" });
          const row = tbody?.querySelector<HTMLElement>(`tr[data-index="${index}"]`);
          if (row) {
            landing.current = null;
            land(row);
          }
        }}
      />
      {copyFailed?.isConnected &&
        createPortal(<Row role="status" label="Clipboard access failed" />, copyFailed)}
      {createPortal(
        <CellContextMenu target={context} moveFrom={moveFrom} copy={copyCell} />,
        document.body,
      )}
      {drawn.map(({ index: rowIndex, start }, at) => {
        const tableRow = visibleRows[rowIndex]!;
        const key = tableRow.id;
        const gap = virtualized ? start - (at ? drawn[at - 1]!.end : 0) : 0;
        return (
          <Fragment key={key}>
            {gap > 0 && <Spacer height={gap} />}
            <MasterRow
              revit={revit?.(tableRow.original)}
              row={tableRow.original}
              rowKey={key}
              index={rowIndex}
              measure={virtualized ? virtual.measureElement : undefined}
              active={activeKey === key}
              selected={selectedKeys ? selectedKeys.has(key) : undefined}
              refusal={refusalOf?.(key)}
              damage={damages[rowIndex]}
              activeRowRef={activeRowRef}
              className={cn("veil h-(--item-h) scroll-mt-12", rowClassName?.(tableRow.original))}
              onRowClick={onRowClick ? rowClick : undefined}
              onSelect={onSelect ? select : undefined}
              onRowHover={onRowHover ? rowHover : undefined}
              columns={columnByKey}
              draft={draft}
              entry={at === 0}
              cells={() => (
                <>
                  {gutter && (
                    <GutterCell row={tableRow.original} gutter={gutter} width={gutterWidth} />
                  )}
                  {[
                    ...tableRow.getStartVisibleCells(),
                    ...tableRow.getCenterVisibleCells(),
                    ...tableRow.getEndVisibleCells(),
                  ].map((cell, columnIndex) => {
                    const column = columnByKey.get(cell.column.id);
                    if (!column) return null;
                    // The first DRAWN row: a scrolled virtual grid still has a Tab stop.
                    const isEntryCell =
                      table.getFocusedCell() === undefined && at === 0 && columnIndex === 0;
                    return (
                      <table.Subscribe
                        key={cell.id}
                        source={table.atoms.cellSelection}
                        selector={() =>
                          Number(cell.getIsFocused()) | (Number(cell.getIsSelected()) << 1)
                        }
                      >
                        {(selection) => (
                          <td
                            ref={hostOf(cell.id)}
                            data-cell-id={cell.id}
                            data-column-key={column.key}
                            role="gridcell"
                            tabIndex={
                              selection & 1 || (isEntryCell && table.getFocusedCell() === undefined)
                                ? 0
                                : -1
                            }
                            aria-selected={Boolean(selection & 2)}
                            data-master-cell=""
                            onFocus={(event) => {
                              focusedCellRef.current = event.currentTarget;
                              setFocusedCell(event.currentTarget);
                              if (event.target === event.currentTarget && !selectingEditor.current)
                                table.setFocusedCell(tableRow.id, cell.column.id);
                            }}
                            onKeyDown={(event) => {
                              if (event.target === event.currentTarget) handleGridKey(event);
                            }}
                            onCopy={
                              cellEdit
                                ? (event) => {
                                    if (event.target !== event.currentTarget) return;
                                    event.clipboardData.setData(
                                      "text/plain",
                                      cellEdit.read(tableRow.original, cell.column.id),
                                    );
                                    event.preventDefault();
                                  }
                                : undefined
                            }
                            onPaste={
                              cellEdit
                                ? (event) => {
                                    if (event.target !== event.currentTarget) return;
                                    const selected = visibleRows.flatMap((row) =>
                                      row
                                        .getVisibleCells()
                                        .filter((item) => item.getIsSelected())
                                        .map((item) => ({
                                          row: row.original,
                                          column: item.column.id,
                                        })),
                                    );
                                    cellEdit.fill(
                                      selected.length > 1
                                        ? selected
                                        : [{ row: tableRow.original, column: cell.column.id }],
                                      event.clipboardData.getData("text/plain"),
                                    );
                                    event.preventDefault();
                                  }
                                : undefined
                            }
                            onMouseDown={(event) => {
                              // A click SELECTS the cell (F-J3-5a): an idle editor under the pointer
                              // would take the caret and make typing append. The td takes focus; the
                              // first printable key then replaces the value, and a double-click, F2 or
                              // Enter edits in place.
                              const target = event.target as HTMLElement;
                              const interceptEditor =
                                target.matches(CELL_EDITOR) && document.activeElement !== target;
                              if (interceptEditor) {
                                event.preventDefault();
                                selectingEditor.current = true;
                                event.currentTarget.focus();
                                selectingEditor.current = false;
                              }
                              if (!isInteractive(event.target) || interceptEditor)
                                cell.getSelectionStartHandler(document)(event);
                            }}
                            onDoubleClick={(event) => {
                              if (document.activeElement === event.currentTarget)
                                editCell(event.currentTarget);
                            }}
                            onMouseEnter={cell.getSelectionExtendHandler()}
                            data-lock={column.lock ? "" : undefined}
                            style={column.lock ? { left: gutter ? gutterWidth : 0 } : undefined}
                            className={cn(
                              // The row rule is drawn INSIDE the cell: a border on a td adds to the row box and put
                              // every list row at 21px (measured, annotation round 2 2026-08-31).
                              "hairline-b-inset relative scroll-mt-12 border-l border-line p-0 outline-none first:border-l-0 focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-line-2",
                              selection & 2 && "on-select",
                              column.right && "text-right",
                              column.width,
                              column.lock && "sticky z-[5] bg-on",
                            )}
                          >
                            <CellNavigationProvider
                              move={(direction) =>
                                document.activeElement instanceof HTMLElement &&
                                moveFrom(document.activeElement, direction, true)
                              }
                            >
                              <CellHost.Provider value={hostOf(cell.id)}>
                                {/* The column's own renderer, called, never `FlexRender`: TanStack
                            renders a def's `cell` as a component TYPE, and the def is rebuilt
                            whenever the columns are, so every cell remounted on each Work change
                            and a half-typed value (and focus) vanished with its input (O8-c). */}
                                {column.cell(tableRow.original)}
                              </CellHost.Provider>
                            </CellNavigationProvider>
                            {draft?.id === cell.id && (
                              <FillDraft
                                text={draft.text}
                                onText={(text) =>
                                  setDraft((current) => current && { ...current, text })
                                }
                                finish={finishDraft}
                              />
                            )}
                          </td>
                        )}
                      </table.Subscribe>
                    );
                  })}
                </>
              )}
            />
          </Fragment>
        );
      })}
      {tail > 0 && <Spacer height={tail} />}
    </tbody>
  );
}

/** The `--item-h` row; measuring corrects any taller row. */
const ROW_ESTIMATE = 24;

/** Holds the extent of rows not drawn: one empty full-width row, so the table keeps its layout. */
function Spacer({ height }: { height: number }) {
  return (
    <tr aria-hidden data-master-spacer="">
      <td colSpan={1000} style={{ height, padding: 0, border: 0 }} />
    </tr>
  );
}

/** The range fill's one input over the focused cell: Enter fills, Escape drops, blur fills. */
function FillDraft({
  text,
  onText,
  finish,
}: {
  text: string;
  onText: (text: string) => void;
  finish: (commit: boolean) => void;
}) {
  const [input, setInput] = useState<HTMLInputElement | null>(null);
  useScopeKeys(
    [
      {
        hotkey: "Enter",
        callback: () => finish(true),
        label: "fill",
        options: { ignoreInputs: false },
      },
      {
        hotkey: "Escape",
        callback: () => finish(false),
        label: "drop fill",
        options: { ignoreInputs: false },
      },
    ],
    input,
  );
  return (
    <input
      ref={setInput}
      autoFocus
      aria-label="Fill selected cells"
      className="absolute inset-0 z-raised size-full bg-on px-1 text-ink"
      value={text}
      onChange={(event) => onText(event.target.value)}
      onBlur={() => finish(true)}
      // The grid's own keys (arrows, typing) stay out of the draft.
      onKeyDown={(event) => event.stopPropagation()}
    />
  );
}

function GutterCell<Row>({ row, gutter, width }: { row: Row; gutter: Gutter<Row>; width: number }) {
  const owed = gutter(row);
  return (
    <TooltipHint content={owed?.title}>
      <td
        data-master-gutter=""
        style={{ width, minWidth: width }}
        className="hairline-b-inset sticky left-0 z-[5] bg-on p-0 text-center align-middle"
      >
        {owed && (
          <span className="t-small face-mono" style={{ color: token(owed.tone ?? "caution") }}>
            {owed.count}
          </span>
        )}
      </td>
    </TooltipHint>
  );
}
