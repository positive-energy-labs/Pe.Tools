/**
 * `<List>` is the inline list (pane body, rail, sidebar); `<ListPopup>` is the same list in a Base UI
 * Popover used for positioning only. Anchors: `trigger`, `caret` (a point in caller-owned text), and
 * `cell` (CellListSelect: mounts no popup machinery at rest, opens from its td).
 */
import { useContext, useEffect, useState, type ComponentProps, type ReactNode } from "react";
import { Popover } from "@base-ui/react/popover";
import { ChevronDown, Ellipsis } from "lucide-react";

import { CellHost } from "./cell";
import { Input } from "./input";
import { useCellNavigation } from "../master-table/cell-navigation";

import {
  useCollection,
  type Collection,
  type CollectionOptions,
  type VisibleRow,
} from "./collection";
import { Row, RowGroupHead, type RowState } from "./row";

/** What a caller draws for one item: the Row's slots and its own states. */
type RowParts = Omit<RowState, "cursor" | "selected"> & {
  lead?: ReactNode;
  label: ReactNode;
  aside?: ReactNode;
  sub?: ReactNode;
  lines?: 1 | 2;
  meta?: ReactNode;
  actions?: ReactNode;
  /** A native tooltip: a measured fact too long for the meta slot. */
  title?: string;
  /** Hover lights what the row stands for elsewhere (the one-focus law: anatomy parts). */
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
};

type ListProps<T> = Omit<CollectionOptions<T>, "target"> & {
  row: (item: T) => RowParts;
  "aria-label": string;
  /** Show a search input when the list is filterable and holds more than this many items. */
  searchAbove?: number;
  searchPlaceholder?: string;
  /** Empty and no-match are different stories with different exits. */
  empty: ReactNode;
  noMatch?: string;
  failure?: string;
  createLabel?: (text: string) => string;
  /** An input outside the list that owns its keys and query (the composer). */
  owner?: HTMLElement | null;
  /** Rows scroll inside this height; group heads stick. */
  maxHeight?: string;
  /** Verbs under the rows that are not rows (the head picker's "Clear target"); a ladder's
   * footer may differ per rung. */
  footer?: ReactNode | ((level: number) => ReactNode);
  /** What the cursor row is, said once under the rows (two lines), so each row stays one line. */
  detail?: (item: T) => ReactNode;
  /** Hand the collection to the caller (a table reads its selection, the composer its cursor). */
  onCollection?: (collection: Collection<T>) => void;
  /** False: group heads carry no member count (a list whose rows already carry a count). */
  groupCounts?: false;
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
  // A list that creates always takes typing: the typed text is the new value.
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
  const cursorRow = visible.find((row) => row.key === collection.cursor);
  const footer = typeof props.footer === "function" ? props.footer(collection.level) : props.footer;
  // An owner (the composer's textarea, a free-text input) points at the list and its cursor.
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
      return (
        <RowGroupHead
          key={row.key}
          label={row.label}
          count={props.groupCounts === false ? undefined : row.count}
        />
      );
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
    if (row.kind === "more")
      return (
        <Row
          key={row.key}
          {...collection.rowProps(row.key)}
          lead={<Ellipsis aria-hidden />}
          label={
            <span className="text-ink-2">{`${row.count} more ${row.group.toLowerCase()}`}</span>
          }
        />
      );
    const slots = props.row(row.item);
    return <Row key={row.key} {...collection.rowProps(row.key)} {...slots} />;
  };
  return (
    <div
      // An inline list fills a flex rail; in a popup the frame is a block and this is inert.
      className="flex min-h-0 flex-1 flex-col"
      data-list=""
      // An input-owned list never takes focus from its owner: a click picks, the caret stays.
      onMouseDown={props.owner !== undefined ? (event) => event.preventDefault() : undefined}
    >
      {props.levels &&
      props.levels.length > 1 &&
      // A ladder whose first rung has no word (a menu) shows crumbs only once it has walked in.
      (collection.level > 0 || props.levels[0]!.label) ? (
        <div className="hairline-b flex flex-wrap items-baseline gap-1 px-2 py-1 t-small">
          {props.levels.map((rung, depth) => {
            const step = collection.path[depth];
            const word = rung.crumb ?? (step !== undefined ? props.labelOf(step) : rung.label);
            // A rung with no word (a menu's drill-in) draws no crumb: its parent's word says it.
            if (!word) return null;
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
                  {word}
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
          // The one control frame: a list's search is the same field as any other in the kit.
          className="dl-control m-1 px-2 t-small outline-none"
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
        className="min-h-0 flex-1 overflow-y-auto outline-none"
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
      {props.detail ? (
        <div className="dl-list-detail hairline-t" data-list-detail="">
          {cursorRow?.kind === "item" ? props.detail(cursorRow.item) : null}
        </div>
      ) : null}
      {footer != null ? <div className="hairline-t px-1 pt-1">{footer}</div> : null}
    </div>
  );
}

type PopupFrameProps = {
  children: ReactNode;
  anchor?: Element | null;
  label: string;
  /** An input-owned popup never takes focus: the owner keeps the caret and the keys. */
  owned?: boolean;
  /** Anchored at a text caret (the composer's `/` and `@`), not at a field or trigger. */
  atCaret?: boolean;
  side?: "top" | "bottom";
  align?: "start" | "end";
  /** A working surface over the page (the composer's patch bay), not a list: wider than rows. */
  wide?: boolean;
};

/** The one popup surface: positioned by Base UI, drawn by the kit. */
export function PopupFrame({
  children,
  anchor,
  label,
  owned,
  atCaret,
  side = "bottom",
  align = "start",
  wide,
}: PopupFrameProps) {
  return (
    <Popover.Portal>
      <Popover.Positioner
        anchor={anchor ?? undefined}
        side={side}
        align={align}
        sideOffset={6}
        className="isolate z-popup"
      >
        <Popover.Popup
          aria-label={label}
          initialFocus={owned ? false : undefined}
          finalFocus={owned ? false : undefined}
          data-list-popup=""
          data-surface="artifact"
          // A caret menu holds one width while its query narrows it; a field's suggestions match
          // the field; a triggered list is as wide as its rows.
          className={`block overflow-hidden p-1 text-ink float-surface ${wide ? "w-[min(52rem,var(--available-width))]" : atCaret ? "w-[min(28rem,var(--available-width))]" : owned ? "w-(--anchor-width) min-w-48" : "min-w-48 max-w-[min(36rem,var(--available-width))]"}`}
        >
          {children}
        </Popover.Popup>
      </Popover.Positioner>
    </Popover.Portal>
  );
}

/**
 * The trigger's shapes, one recipe (face by role, not by call site). `inline` is a quiet word
 * in running chrome (a chip, a head), `control` wears the control frame beside buttons, `fill` stretches to its cell or column head (mono, item
 * height, chevron on the right edge), `field` is a form field at control height.
 */
const TRIGGER_FACE = {
  /** A word in a sentence (the Situation ladder): dotted when held, dashed when derived or open. */
  word: "cursor-pointer border-b border-current border-dotted whitespace-nowrap data-derived:border-dashed disabled:cursor-not-allowed disabled:text-ink-2",
  inline: "inline-flex min-w-0 cursor-pointer items-center gap-1 t-small",
  /** A picker beside buttons: the one control frame at control height, as wide as its words. */
  control:
    "dl-control inline-flex h-(--control-h) min-w-0 cursor-pointer items-center gap-1 px-(--control-pad-x) t-small not-data-tone:text-ink",
  fill: "flex h-(--item-h) w-full min-w-0 cursor-pointer items-center justify-between gap-1 px-1 t-small face-mono",
  field:
    "dl-control flex w-full min-w-0 cursor-pointer items-center justify-between gap-1 px-(--control-pad-x) t-small",
  /** The left edge of a `ListSegmentInput`: no frame of its own, a rule between it and the input. */
  segment:
    "flex shrink-0 cursor-pointer items-center gap-1 border-r border-line px-2 t-small transition-colors outline-none hover:bg-line/30 focus-visible:bg-line/30 data-popup-open:bg-line/40 disabled:cursor-not-allowed",
  /** A glyph alone (a row's "…" menu): item-high square, no frame, no chevron — the glyph is the
   *  verb. Its ink rises on hover and while open; the row's own ground shows through. */
  icon: "inline-flex size-(--item-h) shrink-0 cursor-pointer items-center justify-center text-ink-2 outline-none hover:text-ink focus-visible:outline focus-visible:outline-line-2 data-popup-open:text-ink [&>svg]:size-[1.2em]",
} as const;

type TriggerFace = keyof typeof TRIGGER_FACE;

/** A popup's trigger in one of the kit's faces; the chevron is the face's own. Any Base UI
 *  `Popover.Root` takes it, so a non-list popup opens from the same face. */
function PopupTrigger({
  face = "inline",
  children,
  ...props
}: Omit<ComponentProps<typeof Popover.Trigger>, "className" | "children"> & {
  face?: TriggerFace;
  children: ReactNode;
  "data-derived"?: string;
  "data-tone"?: string;
}) {
  return (
    <Popover.Trigger className={TRIGGER_FACE[face]} data-list-trigger={face} {...props}>
      {face === "word" || face === "icon" ? (
        children
      ) : (
        <>
          <span className="flex min-w-0 flex-1 items-center gap-1 truncate">{children}</span>
          <ChevronDown aria-hidden className="size-3 shrink-0 text-ink-2" />
        </>
      )}
    </Popover.Trigger>
  );
}

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
  side,
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
  /** anchor=caret: which side of it the list opens on (the composer's opens above the box). */
  side?: "top" | "bottom";
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
        <PopupTrigger
          face={face}
          aria-haspopup="listbox"
          aria-label={triggerLabel}
          title={title}
          disabled={disabled}
          data-derived={derived ? "" : undefined}
          data-tone={caution ? "caution" : undefined}
        >
          {trigger}
        </PopupTrigger>
      ) : null}
      {open ? (
        <PopupFrame
          anchor={anchor === "caret" ? caret : undefined}
          side={side}
          label={list["aria-label"]}
          owned={list.owner !== undefined}
          atCaret={anchor === "caret"}
        >
          <List
            {...list}
            onPick={(item, path) => {
              list.onPick?.(item, path);
              if (list.select !== "multi") setOpen(false);
            }}
            onEscape={() => {
              list.onEscape?.();
              setOpen(false);
            }}
          />
        </PopupFrame>
      ) : null}
    </Popover.Root>
  );
}

/** A multi trigger's face: the picked values as chips at item density, or what none means. */
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
 * A FIELD WHOSE KIND IS PICKED ON ITS LEFT EDGE: one perimeter, a segment trigger, an embedded
 * input. The pick decides what the input takes; a pick that fixes the value disables the input and
 * shows the fixed value as its placeholder.
 */
export function ListSegmentInput<T>({
  popup,
  ...input
}: {
  popup: Omit<ListProps<T>, "select"> & {
    selected: readonly string[];
    trigger: ReactNode;
    triggerLabel: string;
    title?: string;
  };
} & Omit<ComponentProps<typeof Input>, "surface">) {
  return (
    <span className="dl-control flex w-full min-w-0 items-stretch overflow-hidden">
      <ListPopup<T> {...popup} select="single" anchor="trigger" face="segment" />
      <Input {...input} surface="embedded" />
    </span>
  );
}

/**
 * Free text with suggestions (replaces `<datalist>`). The input owns the value, the query and
 * the keys; the list only suggests, so Enter keeps what was typed unless a row is cursored.
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
        className={`dl-control w-full min-w-0 px-(--control-pad-x) t-small outline-none placeholder:text-ink-2${mono ? " face-mono" : ""}`}
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
 * The in-cell select. At rest it is one button in the cell and nothing else: no popover
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
  // A printable key on the td opens the list already filtered by it.
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
