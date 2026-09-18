/**
 * LIST and LIST POPUP — the containers of the one list grammar (ix-list design).
 *
 * `<List>` is inline: a pane body, a rail, a sidebar (R1). `<ListPopup>` is the same `<List>` in a
 * Base UI `Popover`, which is used for positioning only; every row, key and state is ours.
 * Anchors (R14): `trigger` (a button that opens it), `caret` (a point in text the caller owns, the
 * composer's slash menu), and `cell`, which is `CellListSelect`: a table cell that mounts NO
 * popup machinery at rest and opens from its td (R13).
 */
import { useContext, useState, type ReactNode } from "react";
import { Popover } from "@base-ui/react/popover";

import { CellHost } from "#/components/lang/cell";
import { useCellNavigation } from "#/components/master-table/cell-navigation";

import {
  useCollection,
  type Collection,
  type CollectionOptions,
  type VisibleRow,
} from "./collection";
import { Row, RowGroupHead, type RowState } from "./row";

/** What a caller draws for one item: the Row's slots and its own states. */
export type RowParts = Omit<RowState, "cursor" | "selected"> & {
  lead?: ReactNode;
  label: ReactNode;
  sub?: ReactNode;
  lines?: 1 | 2;
  meta?: ReactNode;
  actions?: ReactNode;
};

export type ListProps<T> = Omit<CollectionOptions<T>, "target"> & {
  row: (item: T) => RowParts;
  "aria-label": string;
  /** Show a search input when the list is filterable and holds more than this many items. */
  searchAbove?: number;
  searchPlaceholder?: string;
  /** Empty and no-match are different stories with different exits (R17). */
  empty: string;
  noMatch?: string;
  failure?: string;
  createLabel?: (text: string) => string;
  /** An input outside the list that owns its keys and query (the composer, R14). */
  owner?: HTMLElement | null;
  /** Rows scroll inside this height; group heads stick. */
  maxHeight?: string;
  /** Verbs under the rows that are not rows (the head picker's "Clear target", R11). */
  footer?: ReactNode;
  /** Hand the collection to the caller (a table reads its selection, the composer its cursor). */
  onCollection?: (collection: Collection<T>) => void;
};

/** The words a list says instead of rows: one per status, never a blank. */
function StatusLine({ children, tone }: { children: ReactNode; tone?: "caution" }) {
  return (
    <div className="dl-row" role="status" data-tone={tone} data-pending={tone ? undefined : ""}>
      <span className="dl-row-label">{children}</span>
    </div>
  );
}

export function List<T>(props: ListProps<T>) {
  const [listEl, setListEl] = useState<HTMLDivElement | null>(null);
  const [inputEl, setInputEl] = useState<HTMLInputElement | null>(null);
  const total = props.items?.length ?? Infinity;
  const searchable =
    (props.filter ?? "none") !== "none" &&
    props.owner === undefined &&
    total > (props.searchAbove ?? 0);
  const collection = useCollection<T>({
    ...props,
    refusalOf: (item) => props.row(item).refusal,
    target: props.owner ?? (searchable ? inputEl : listEl),
  });
  props.onCollection?.(collection);
  const { status, visible, query } = collection;
  const render = (row: VisibleRow<T>) => {
    if (row.kind === "head")
      return <RowGroupHead key={row.key} label={row.label} count={row.count} />;
    if (row.kind === "create") {
      const { onClick, ...rest } = collection.rowProps(row.key);
      return (
        <Row
          key={row.key}
          {...rest}
          onClick={onClick}
          lead="＋"
          label={props.createLabel?.(row.text) ?? `new “${row.text}”`}
        />
      );
    }
    const slots = props.row(row.item);
    return <Row key={row.key} {...collection.rowProps(row.key)} {...slots} />;
  };
  return (
    <div className="flex min-h-0 flex-col" data-list="">
      {props.levels && collection.path.length ? (
        <div className="hairline-b flex flex-wrap items-baseline gap-1 px-2 py-1 t-small">
          <button type="button" className="text-ink-2" onClick={() => collection.backTo(0)}>
            {props.levels[0]!.label}
          </button>
          {collection.path.map((step, depth) => (
            <span key={props.keyOf(step)} className="inline-flex items-baseline gap-1">
              <span className="text-ink-mute">›</span>
              <button type="button" onClick={() => collection.backTo(depth + 1)}>
                {props.labelOf(step)}
              </button>
            </span>
          ))}
        </div>
      ) : null}
      {searchable ? (
        <input
          ref={setInputEl}
          {...collection.inputProps}
          aria-label={`${props["aria-label"]} search`}
          className="hairline-b mx-1 h-(--control-h) bg-transparent px-2 t-small outline-none"
          placeholder={props.searchPlaceholder ?? "search…"}
          value={query}
          onChange={(event) => collection.setQuery(event.target.value)}
        />
      ) : null}
      <div
        ref={setListEl}
        {...collection.listProps}
        aria-label={props["aria-label"]}
        tabIndex={searchable || props.owner !== undefined ? -1 : 0}
        className="min-h-0 overflow-y-auto outline-none"
        style={{ maxHeight: props.maxHeight }}
      >
        {status === "pending" ? (
          <StatusLine>reading…</StatusLine>
        ) : status === "failed" ? (
          <StatusLine tone="caution">{props.failure ?? "read failed"}</StatusLine>
        ) : status === "empty" ? (
          <StatusLine>{props.empty}</StatusLine>
        ) : status === "no-match" && !visible.length ? (
          <StatusLine>{props.noMatch ?? `nothing matches “${query.trim()}”`}</StatusLine>
        ) : null}
        {status === "pending" || status === "failed" ? null : visible.map(render)}
      </div>
      {props.footer != null ? <div className="hairline-t px-1 pt-1">{props.footer}</div> : null}
    </div>
  );
}

type PopupFrameProps = { children: ReactNode; anchor?: Element | null; label: string };

/** The one popup surface: positioned by Base UI, drawn by the kit. */
function PopupFrame({ children, anchor, label }: PopupFrameProps) {
  return (
    <Popover.Portal>
      <Popover.Positioner
        anchor={anchor ?? undefined}
        side="bottom"
        align="start"
        sideOffset={4}
        className="isolate z-popup"
      >
        <Popover.Popup
          aria-label={label}
          data-list-popup=""
          data-surface="artifact"
          className="block min-w-48 max-w-(--available-width) overflow-hidden rounded-lg py-1 text-ink ring-1 ring-line outline-none"
        >
          {children}
        </Popover.Popup>
      </Popover.Positioner>
    </Popover.Portal>
  );
}

/** A popup list opened by a trigger or anchored to a caret the caller owns. */
export function ListPopup<T>({
  anchor,
  trigger,
  open: controlled,
  onOpenChange,
  caret,
  ...list
}: ListProps<T> & {
  anchor: "trigger" | "caret";
  /** anchor=trigger: the button's face. */
  trigger?: ReactNode;
  /** anchor=caret: the caller opens it and points at the caret. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  caret?: Element | null;
}) {
  const [own, setOwn] = useState(false);
  const open = controlled ?? own;
  const setOpen = (next: boolean) => {
    setOwn(next);
    onOpenChange?.(next);
  };
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      {anchor === "trigger" ? (
        <Popover.Trigger className="inline-flex cursor-pointer items-center gap-1 t-small">
          {trigger}
        </Popover.Trigger>
      ) : null}
      {open ? (
        <PopupFrame anchor={anchor === "caret" ? caret : undefined} label={list["aria-label"]}>
          <List
            {...list}
            onPick={(item, path) => {
              list.onPick?.(item, path);
              if (list.select !== "multi") setOpen(false);
            }}
            onEscape={() => setOpen(false)}
          />
        </PopupFrame>
      ) : null}
    </Popover.Root>
  );
}

/**
 * THE IN-CELL SELECT (R13). At rest it is one button in the cell and nothing else: no popover
 * root, no portal, no collection. The table's Enter/F2 edit opens it (it declares itself the
 * cell's editor); the list opens under the td; Tab/Shift-Tab close it and move the cell; Escape or
 * a pick close it and hand focus back to the td.
 */
export function CellListSelect<T>({
  value,
  display,
  ...list
}: Omit<ListProps<T>, "onEscape" | "onTab"> & { value: string; display?: ReactNode }) {
  const [open, setOpen] = useState(false);
  // A printable key on the td opens the list already filtered by it (R13).
  const [initial, setInitial] = useState("");
  const host = useContext(CellHost);
  const move = useCellNavigation();
  const close = () => {
    setOpen(false);
    host?.current?.focus();
  };
  return (
    <>
      <button
        type="button"
        tabIndex={-1}
        data-cell-editor=""
        data-cell-query=""
        className="flex h-(--item-h) w-full min-w-0 items-center justify-between gap-1 px-1 face-mono"
        onClick={(event) => {
          setInitial(event.currentTarget.dataset.query ?? "");
          delete event.currentTarget.dataset.query;
          setOpen(true);
        }}
      >
        {display ?? value}
        <span aria-hidden className="text-ink-2">
          ▾
        </span>
      </button>
      {open ? (
        <Popover.Root open onOpenChange={(next) => (next ? undefined : close())}>
          <PopupFrame anchor={host?.current} label={list["aria-label"]}>
            <List
              {...list}
              initialQuery={initial}
              filter={list.filter ?? "substring"}
              onPick={(item, path) => {
                list.onPick?.(item, path);
                close();
              }}
              onEscape={close}
              onTab={(back) => {
                // The move starts from the td, never from the list's own input in the portal.
                close();
                return move?.(back ? "left" : "right") ?? false;
              }}
            />
          </PopupFrame>
        </Popover.Root>
      ) : null}
    </>
  );
}
