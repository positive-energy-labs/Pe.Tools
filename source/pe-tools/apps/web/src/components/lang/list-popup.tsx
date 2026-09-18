/**
 * LIST and LIST POPUP — the containers of the one list grammar (ix-list design).
 *
 * `<List>` is inline: a pane body, a rail, a sidebar (R1). `<ListPopup>` is the same `<List>` in a
 * Base UI `Popover`, which is used for positioning only; every row, key and state is ours.
 * Anchors (R14): `trigger` (a button that opens it), `caret` (a point in text the caller owns, the
 * composer's slash menu), and `cell`, which is `CellListSelect`: a table cell that mounts NO
 * popup machinery at rest and opens from its td (R13).
 */
import { useContext, useEffect, useState, type ReactNode } from "react";
import { Popover } from "@base-ui/react/popover";
import { ChevronDown } from "lucide-react";

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
  /** Verbs under the rows that are not rows (the head picker's "Clear target", R11); a ladder's
   * footer may differ per rung. */
  footer?: ReactNode | ((level: number) => ReactNode);
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
  // A list that creates always takes typing: the typed text is the new value (R9).
  const searchable =
    props.owner === undefined &&
    (props.onCreate !== undefined ||
      ((props.filter ?? "none") !== "none" && total > (props.searchAbove ?? 0)));
  const collection = useCollection<T>({
    ...props,
    refusalOf: (item) => props.row(item).refusal,
    target: props.owner ?? (searchable ? inputEl : listEl),
  });
  props.onCollection?.(collection);
  const { status, visible, query } = collection;
  const footer = typeof props.footer === "function" ? props.footer(collection.level) : props.footer;
  // An owner (the composer's textarea, a free-text input) points at the list and its cursor (R14).
  const owner = props.owner;
  const active = collection.inputProps["aria-activedescendant"];
  useEffect(() => {
    if (!owner) return;
    owner.setAttribute("aria-controls", collection.listProps.id);
    owner.setAttribute("aria-expanded", "true");
    if (active) owner.setAttribute("aria-activedescendant", active);
    else owner.removeAttribute("aria-activedescendant");
    return () => {
      owner.removeAttribute("aria-activedescendant");
      owner.removeAttribute("aria-controls");
      owner.setAttribute("aria-expanded", "false");
    };
  }, [owner, active, collection.listProps.id]);
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
    <div
      className="flex min-h-0 flex-col"
      data-list=""
      // An input-owned list never takes focus from its owner: a click picks, the caret stays (R14).
      onMouseDown={props.owner !== undefined ? (event) => event.preventDefault() : undefined}
    >
      {props.levels && props.levels.length > 1 ? (
        <div className="hairline-b flex flex-wrap items-baseline gap-1 px-2 py-1 t-small">
          {props.levels.map((rung, depth) => {
            const step = collection.path[depth];
            return (
              <span key={depth} className="inline-flex items-baseline gap-1">
                {depth > 0 ? <span className="text-ink-mute">›</span> : null}
                <button
                  type="button"
                  // Off the tab order: focus opens in the search, where the list's keys live;
                  // Escape walks up a rung.
                  tabIndex={-1}
                  aria-current={depth === collection.level ? "step" : undefined}
                  className={depth === collection.level ? "text-ink underline" : "text-ink-2"}
                  onClick={() => collection.backTo(depth)}
                >
                  {rung.crumb ?? (step !== undefined ? props.labelOf(step) : rung.label)}
                </button>
              </span>
            );
          })}
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
        {status === "refused" ? (
          <StatusLine tone="caution">{props.levels?.[collection.level]?.refusal}</StatusLine>
        ) : status === "pending" ? (
          <StatusLine>reading…</StatusLine>
        ) : status === "failed" ? (
          <StatusLine tone="caution">{props.failure ?? "read failed"}</StatusLine>
        ) : status === "empty" ? (
          <StatusLine>{props.levels?.[collection.level]?.note ?? props.empty}</StatusLine>
        ) : status === "no-match" && !visible.length ? (
          <StatusLine>{props.noMatch ?? `nothing matches “${query.trim()}”`}</StatusLine>
        ) : null}
        {status === "pending" || status === "failed" || status === "refused"
          ? null
          : visible.map(render)}
      </div>
      {footer != null ? <div className="hairline-t px-1 pt-1">{footer}</div> : null}
    </div>
  );
}

type PopupFrameProps = {
  children: ReactNode;
  anchor?: Element | null;
  label: string;
  /** An input-owned popup (R14) never takes focus: the owner keeps the caret and the keys. */
  owned?: boolean;
};

/** The one popup surface: positioned by Base UI, drawn by the kit. */
function PopupFrame({ children, anchor, label, owned }: PopupFrameProps) {
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
          initialFocus={owned ? false : undefined}
          finalFocus={owned ? false : undefined}
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

/**
 * The trigger's shapes, one recipe (R19: face by role, not by call site). `inline` is a quiet word
 * in running chrome (a chip, a head), `fill` stretches to its cell or column head (mono, item
 * height, chevron on the right edge), `field` is a form field at control height.
 */
const TRIGGER_FACE = {
  /** A word in a sentence (the Situation ladder): dotted when held, dashed when derived or open. */
  word: "cursor-pointer border-b border-current border-dotted whitespace-nowrap data-derived:border-dashed disabled:cursor-not-allowed disabled:text-ink-2",
  inline: "inline-flex min-w-0 cursor-pointer items-center gap-1 t-small",
  fill: "flex h-(--item-h) w-full min-w-0 cursor-pointer items-center justify-between gap-1 px-1 t-small face-mono",
  field:
    "flex min-h-(--control-h) w-full min-w-0 cursor-pointer items-center justify-between gap-1 rounded-md border border-line bg-line/20 px-2 t-small dark:bg-line/30",
} as const;

export type TriggerFace = keyof typeof TRIGGER_FACE;

/** A popup list opened by a trigger or anchored to a caret the caller owns. */
export function ListPopup<T>({
  anchor,
  trigger,
  face = "inline",
  triggerLabel,
  title,
  disabled,
  derived,
  caution,
  open: controlled,
  onOpenChange,
  caret,
  ...list
}: ListProps<T> & {
  anchor: "trigger" | "caret";
  /** anchor=trigger: the button's face (the chevron is the trigger's own). */
  trigger?: ReactNode;
  face?: TriggerFace;
  /** The trigger's accessible name, when its face is a value. */
  triggerLabel?: string;
  title?: string;
  disabled?: boolean;
  /** face=word: the value was reported by the world, not chosen (house law 8): dashed. */
  derived?: boolean;
  /** The trigger's feed disagrees or its ladder is incomplete: the caution tone. */
  caution?: boolean;
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
        <Popover.Trigger
          className={TRIGGER_FACE[face]}
          aria-haspopup="listbox"
          aria-label={triggerLabel}
          title={title}
          disabled={disabled}
          data-list-trigger={face}
          data-derived={derived ? "" : undefined}
          data-tone={caution ? "caution" : undefined}
        >
          {face === "word" ? (
            trigger
          ) : (
            <>
              <span className="flex min-w-0 flex-1 items-center gap-1 truncate">{trigger}</span>
              <ChevronDown aria-hidden className="size-3 shrink-0 text-ink-2" />
            </>
          )}
        </Popover.Trigger>
      ) : null}
      {open ? (
        <PopupFrame
          anchor={anchor === "caret" ? caret : undefined}
          label={list["aria-label"]}
          owned={list.owner !== undefined}
        >
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

/** A multi trigger's face: the picked values as chips at item density, or what none means (R6). */
export function ListChips({ labels, none }: { labels: readonly ReactNode[]; none: ReactNode }) {
  if (!labels.length) return <span className="truncate text-ink-2">{none}</span>;
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-1 py-0.5">
      {labels.map((label, index) => (
        <span key={index} className="rounded-sm bg-ink-2/10 px-1 whitespace-nowrap">
          {label}
        </span>
      ))}
    </span>
  );
}

/**
 * FREE TEXT WITH SUGGESTIONS (R9, replaces `<datalist>`). The input owns the value, the query and
 * the keys (R14); the list only suggests, so Enter keeps what was typed unless a row is cursored.
 */
export function ListInput({
  id,
  value,
  onChange,
  suggestions,
  "aria-label": label,
  placeholder,
  disabled,
  mono,
}: {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  /** A suggestion's value is what a pick writes; its label, when it differs, reads beside it. */
  suggestions: readonly { value: string; label?: string }[];
  "aria-label": string;
  placeholder?: string;
  disabled?: boolean;
  mono?: boolean;
}) {
  const [input, setInput] = useState<HTMLInputElement | null>(null);
  const [open, setOpen] = useState(false);
  return (
    <>
      <input
        ref={setInput}
        id={id}
        aria-label={label}
        placeholder={placeholder}
        disabled={disabled}
        value={value}
        autoComplete="off"
        className={`h-(--control-h) w-full min-w-0 rounded-md border border-line bg-line/20 px-2 t-small outline-none placeholder:text-ink-2 focus-visible:border-line-2 dark:bg-line/30${mono ? " face-mono" : ""}`}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onChange={(event) => {
          onChange(event.target.value);
          setOpen(true);
        }}
      />
      <ListPopup<{ value: string; label?: string }>
        anchor="caret"
        caret={input}
        owner={input}
        open={open && suggestions.length > 0}
        onOpenChange={setOpen}
        query={value}
        autoCursor={false}
        aria-label={`${label} suggestions`}
        region={label}
        items={suggestions}
        keyOf={(s) => s.value}
        labelOf={(s) => s.value}
        filter="substring"
        empty="no suggestions"
        maxHeight="12rem"
        onPick={(s) => onChange(s.value)}
        row={(s) => ({
          label: mono ? <span className="face-mono">{s.value}</span> : s.value,
          meta: s.label && s.label !== s.value ? s.label : undefined,
        })}
      />
    </>
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
  invalid,
  title,
  ...list
}: Omit<ListProps<T>, "onEscape" | "onTab"> & {
  value: string;
  display?: ReactNode;
  /** The cell's refusal: the one alarm, spent as an ink + wash mix on the resting face. */
  invalid?: boolean;
  title?: string;
}) {
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
        title={title}
        data-tone={invalid ? "alarm" : undefined}
        data-wash={invalid ? "" : undefined}
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
