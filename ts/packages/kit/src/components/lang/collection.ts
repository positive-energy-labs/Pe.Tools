/**
 * useCollection: the one headless list behaviour and the one key owner for every list. It knows
 * no pixels: it turns items into visible rows, holds cursor, selection and query, and binds keys
 * on the scope node (`useScopeKeys`). Identity is by key, never by object.
 */
import { startTransition, useEffect, useId, useMemo, useRef, useState } from "react";

import { useScopeKeys, type ScopeKey } from "../../keys";
import {
  conditionValues,
  passes,
  readQuery,
  wordMatches,
  type QueryRead,
} from "../master-table/view";
import {
  emptyListSearch,
  listSearchRefusal,
  pickListPill,
  type ListSearch,
} from "@pe/agent-contracts";
import type { RowState } from "./row";

type FilterMode = "none" | "substring" | "fuzzy" | "words";
type SelectMode = "none" | "single" | "multi";
/** Empty (nothing in scope) is not no-match (the query hid everything): two exits. */
type CollectionStatus = "ready" | "empty" | "no-match" | "pending" | "failed" | "refused";

/** One ladder rung: its label, and its items given the path picked above it. */
export interface Level<T> {
  label: string;
  items: (path: readonly T[]) => readonly T[];
  /** The breadcrumb's word for this rung (its bound value); default: the path's pick, else `label`. */
  crumb?: string;
  /** A pick on this rung has its own effect (the Situation ladder binds each rung as it goes). */
  onPick?: (item: T) => void;
  /** Many picks stay on this rung: the ladder does not advance. */
  multi?: boolean;
  /** The items do not depend on the path: a query shows this rung's hits once, not per parent. */
  independent?: boolean;
  /** Present, the rung cannot list yet and says why. */
  refusal?: string | null;
  /** What an empty rung says instead of the list's `empty`. */
  note?: string;
  /** Typed text becomes a value on this rung only (the list's `onCreate` applies to every rung). */
  onCreate?: (text: string) => void;
  createLabel?: (text: string) => string;
}

export interface CollectionOptions<T> {
  items?: readonly T[];
  keyOf: (item: T) => string;
  labelOf: (item: T) => string;
  groupOf?: (item: T) => string | undefined;
  /** Groups drawn first, in this order, whatever the query ranks; the rest follow by rank. */
  leadingGroups?: readonly string[];
  /** `words` only: secondary text (a description); a query word may match by starting one of its words. */
  detailOf?: (item: T) => string;
  /** A named group shows this many rows, then one "N more" row that opens the rest in place. */
  groupCap?: number;
  filter?: FilterMode;
  select?: SelectMode;
  /** Long navigation lists activate on Enter/plain click; popup multi lists keep toggling. */
  multiAction?: "toggle" | "activate";
  /** Controlled selection by key. */
  selected?: readonly string[];
  onSelectedChange?: (keys: string[]) => void;
  /** Controlled cursor by key: a focus owned outside the list (a linked pane's hover) is its cursor. */
  cursor?: string | null;
  /** The cursor moved (a hover or a key); fires only on a change. */
  onCursorChange?: (key: string | null) => void;
  /** A pick: Enter or click on a row (a create row calls `onCreate` instead). */
  onPick?: (item: T, path: readonly T[]) => void;
  /** Present, a sentinel row offers the typed text as a new value. */
  onCreate?: (text: string) => void;
  /** A ladder: the list walks these levels; Enter picks and advances. */
  levels?: readonly Level<T>[];
  /** The rung a ladder opens on (the first one still unbound). */
  startLevel?: number;
  /** Remote options: pending and failed are states of the list, not rows. */
  status?: "ready" | "pending" | "failed";
  /** A row that refuses picks, and why: keys and clicks both skip it. */
  refusalOf?: (item: T) => string | null | undefined;
  /** Escape with nothing to clear: the popup's close. */
  onEscape?: () => void;
  /** Tab / Shift-Tab leave the list (the in-cell contract): true when the move was taken. */
  onTab?: (back: boolean) => boolean;
  /** A query owned outside the list (the composer's text after "/"). */
  query?: string;
  /** False, the cursor never lands on the top hit by itself: Enter keeps free text. Otherwise the
   * top hit is cursored while typing, and on open when the query is owned outside the list. */
  autoCursor?: boolean;
  /** The query the list opens with (a cell opened by a printable key). */
  initialQuery?: string;
  /** The element the keys listen on: the list itself, or the input that owns it. */
  target: HTMLElement | null;
  /** Virtual renderers mount and scroll the cursor themselves. */
  scrollCursor?: boolean;
}

export type VisibleRow<T> =
  | { kind: "head"; key: string; label: string; count: number }
  | { kind: "item"; key: string; item: T; path: readonly T[]; level: number }
  | { kind: "create"; key: string; text: string }
  /** A capped group's tail: `count` rows hidden; a pick shows them and cursors `next`. */
  | { kind: "more"; key: string; group: string; count: number; next: string };

/** A row control owns its native keys; an external query/combobox input still owns this list. */
function collectionKey(definition: ScopeKey, region: HTMLElement | null): ScopeKey {
  return {
    ...definition,
    callback: (event, context) => {
      // IME confirmation belongs to the composition, never to a pick or a cursor move.
      if (event.isComposing || event.keyCode === 229) return;
      const control =
        event.target instanceof Element
          ? event.target.closest(
              'input,textarea,select,button,a[href],[contenteditable="true"],[role="textbox"],[role="combobox"],.dl-cell',
            )
          : null;
      const row = control?.closest(".dl-row");
      // A list body ignores its search field; the field's own suggestion list (region === control) does not.
      if (control !== region && control?.closest("[data-list-search]") && region?.contains(control))
        return;
      if (row && region?.contains(row)) return;
      if (definition.options?.preventDefault !== false) event.preventDefault();
      if (definition.options?.stopPropagation !== false) event.stopPropagation();
      definition.callback(event, context);
    },
    // Admission must precede native prevention; the hotkey manager otherwise cancels cell edits.
    options: {
      ...definition.options,
      ignoreInputs: false,
      preventDefault: false,
      stopPropagation: false,
    },
  };
}

/* ── ranking ─────────────────────────────────────────────────────────────────────────────── */

/**
 * A small fuzzy ranker: every query character must appear in order. Score rewards consecutive
 * runs and word starts, and penalises the gap before the first hit. Null = no match.
 * ponytail: O(label × query) per item; fine for the few hundred rows any list here holds.
 */
function fuzzyScore(label: string, query: string): number | null {
  const text = label.toLowerCase();
  const q = query.toLowerCase();
  let score = 0;
  let from = 0;
  let previous = -2;
  for (const char of q) {
    const at = text.indexOf(char, from);
    if (at < 0) return null;
    if (at === previous + 1) score += 5;
    if (at === 0 || /[\s\-_./›]/.test(text[at - 1]!)) score += 3;
    if (previous < 0) score -= Math.min(at, 5);
    previous = at;
    from = at + 1;
  }
  return score;
}

export function filterItems<T>(
  items: readonly T[],
  labelOf: (item: T) => string,
  mode: FilterMode,
  query: string,
  detailOf?: (item: T) => string,
): T[] {
  const q = query.trim();
  if (mode === "none" || !q) return [...items];
  if (mode === "substring" || mode === "words") {
    const clauses = readQuery(q);
    return items.filter((item) =>
      passes(
        item,
        clauses,
        new Map(),
        (row, word) =>
          wordMatches(labelOf(row), word) || (!!detailOf && wordMatches(detailOf(row), word)),
      ),
    );
  }
  return items
    .map((item, index) => ({ item, index, score: fuzzyScore(labelOf(item), q) }))
    .filter((hit): hit is { item: T; index: number; score: number } => hit.score !== null)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((hit) => hit.item);
}

/* ── the hook ────────────────────────────────────────────────────────────────────────────── */

export function useCollection<T>(options: CollectionOptions<T>) {
  const {
    keyOf,
    labelOf,
    groupOf,
    leadingGroups = [],
    detailOf,
    groupCap,
    filter = "none",
    select = "none",
    levels,
    status: remote = "ready",
  } = options;
  const listId = useId();
  const [ownQuery, setOwnQuery] = useState(options.initialQuery ?? "");
  const query = options.query ?? ownQuery;
  const setQuery = (next: string) => setOwnQuery(next);
  const [ownCursor, setOwnCursor] = useState<string | null>(null);
  const cursorKey = options.cursor !== undefined ? options.cursor : ownCursor;
  const setCursorKey = (key: string | null) => {
    if (key === cursorKey) return;
    if (options.cursor === undefined) setOwnCursor(key);
    options.onCursorChange?.(key);
  };
  const [anchor, setAnchor] = useState<string | null>(null);
  const [path, setPath] = useState<T[]>([]);
  // The rung is its own state, so a ladder can open below a path it did not walk (startLevel).
  const [depth, setDepth] = useState(options.startLevel ?? 0);
  // Capped groups the user opened with their "more" row.
  const [expanded, setExpanded] = useState<readonly string[]>([]);
  const [ownSelection, setOwnSelection] = useState<string[]>([]);
  const selectedKeys = options.selected ?? ownSelection;
  const setSelected = (keys: string[]) => {
    if (options.selected === undefined) setOwnSelection(keys);
    options.onSelectedChange?.(keys);
  };

  const level = levels ? Math.min(depth, levels.length - 1) : 0;
  const levelItems = levels ? levels[level]!.items(path) : (options.items ?? []);

  const createOf = levels ? (levels[level]!.onCreate ?? options.onCreate) : options.onCreate;
  const visible = useMemo((): VisibleRow<T>[] => {
    const rows: VisibleRow<T>[] = [];
    // A ladder with a query also shows hits one level down, under a "current › next" head.
    const pools: { items: readonly T[]; path: readonly T[]; level: number; head?: string }[] = [
      { items: levelItems, path, level },
    ];
    const rung = levels?.[level];
    const next = levels?.[level + 1];
    if (next?.independent && query.trim() && !rung?.multi && !rung?.refusal)
      pools.push({
        items: next.items(path),
        path,
        level: level + 1,
        head: `${rung!.crumb ?? rung!.label} › ${next.label}`,
      });
    else if (levels && query.trim() && level + 1 < levels.length)
      for (const parent of levelItems)
        pools.push({
          items: levels[level + 1]!.items([...path, parent]),
          path: [...path, parent],
          level: level + 1,
          head: `${labelOf(parent)} › ${levels[level + 1]!.label}`,
        });
    for (const pool of pools) {
      const hits = filterItems(pool.items, labelOf, filter, query, detailOf);
      if (!hits.length) continue;
      const byGroup = new Map<string | undefined, T[]>();
      for (const item of hits) {
        const group = pool.head ?? groupOf?.(item);
        byGroup.set(group, [...(byGroup.get(group) ?? []), item]);
      }
      const lead = (group: string | undefined) => {
        const at = group === undefined ? -1 : leadingGroups.indexOf(group);
        return at < 0 ? leadingGroups.length : at;
      };
      for (const [group, members] of [...byGroup].sort(([a], [b]) => lead(a) - lead(b))) {
        if (group !== undefined)
          rows.push({ kind: "head", key: `head:${group}`, label: group, count: members.length });
        const capped =
          group !== undefined &&
          groupCap !== undefined &&
          members.length > groupCap &&
          !expanded.includes(group);
        for (const item of capped ? members.slice(0, groupCap) : members)
          rows.push({
            kind: "item",
            key: keyOf(item),
            item,
            path: pool.path,
            level: pool.level,
          });
        if (capped)
          rows.push({
            kind: "more",
            key: `more:${group}`,
            group,
            count: members.length - groupCap,
            next: keyOf(members[groupCap]!),
          });
      }
    }
    const text = query.trim();
    if (createOf && text && !rows.some((r) => r.kind === "item" && labelOf(r.item) === text))
      rows.push({ kind: "create", key: `create:${text}`, text });
    return rows;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- items are identified by the render
  }, [
    levelItems,
    query,
    filter,
    path,
    level,
    levels,
    createOf,
    groupCap,
    expanded,
    leadingGroups.join("|"),
  ]);

  const pickable = visible.filter(
    (row) => row.kind !== "head" && (row.kind !== "item" || !options.refusalOf?.(row.item)),
  );
  const cursor =
    pickable.find((row) => row.key === cursorKey) ??
    // An owned query (a menu on a text input) opens with its top row cursored: Enter picks it.
    (options.autoCursor !== false && (query.trim() || options.query !== undefined)
      ? pickable[0]
      : undefined);
  const status: CollectionStatus = levels?.[level]?.refusal
    ? "refused"
    : remote === "pending"
      ? "pending"
      : remote === "failed"
        ? "failed"
        : levelItems.length === 0
          ? "empty"
          : pickable.length === 0
            ? "no-match"
            : "ready";

  const moveBy = (step: number) => {
    if (!pickable.length) return;
    const at = cursor ? pickable.indexOf(cursor) : -1;
    const next = pickable[Math.max(0, Math.min(pickable.length - 1, at + step))]!;
    setCursorKey(next.key);
    return next;
  };
  const toggle = (key: string) =>
    setSelected(
      selectedKeys.includes(key) ? selectedKeys.filter((k) => k !== key) : [...selectedKeys, key],
    );
  /** Shift-range over the VISIBLE order, from the anchor to this row. */
  const range = (key: string) => {
    const keys = pickable.filter((row) => row.kind === "item").map((row) => row.key);
    const from = keys.indexOf(anchor ?? cursor?.key ?? key);
    const to = keys.indexOf(key);
    if (from < 0 || to < 0) return setSelected([key]);
    const span = keys.slice(Math.min(from, to), Math.max(from, to) + 1);
    setSelected([...new Set([...selectedKeys, ...span])]);
  };

  const pick = (row: VisibleRow<T> | undefined, shift = false, toggling = false) => {
    if (!row || row.kind === "head") return;
    if (row.kind === "create") return createOf?.(row.text);
    if (row.kind === "more") {
      setExpanded([...expanded, row.group]);
      return setCursorKey(row.next);
    }
    setCursorKey(row.key);
    if (options.refusalOf?.(row.item)) return;
    if (select === "multi") {
      if (shift) {
        range(row.key);
        return;
      }
      if (toggling || options.multiAction !== "activate") {
        toggle(row.key);
        setAnchor(row.key);
        return;
      }
    }
    if (select === "single") setSelected([row.key]);
    const rung = levels?.[row.level];
    rung?.onPick?.(row.item);
    if (rung?.multi) return;
    if (levels && row.level + 1 < levels.length) {
      // The ladder advances: the pick is a step, not the end.
      setPath([...row.path, row.item]);
      setDepth(row.level + 1);
      setQuery("");
      setCursorKey(null);
      return;
    }
    options.onPick?.(row.item, row.path);
  };

  const escape = () => {
    // A query owned outside the list is not the list's to clear: Escape closes.
    if (query && options.query === undefined) return setQuery("");
    if (levels && depth > (options.startLevel ?? 0)) {
      setPath(path.slice(0, depth - 1));
      return setDepth(depth - 1);
    }
    options.onEscape?.();
  };

  const keys: ScopeKey[] = (
    [
      {
        hotkey: "ArrowDown",
        callback: () => moveBy(1),
        label: "next",
        says: "move the cursor down",
      },
      {
        hotkey: "ArrowUp",
        callback: () => moveBy(-1),
        label: "previous",
        says: "move the cursor up",
      },
      {
        hotkey: "Home",
        callback: () => moveBy(-Infinity),
        label: "first",
        says: "the first row",
      },
      {
        hotkey: "End",
        callback: () => moveBy(Infinity),
        label: "last",
        says: "the last row",
      },
      {
        hotkey: "Enter",
        callback: () => pick(cursor),
        label: "pick",
        says: "pick the row under the cursor",
      },
      {
        hotkey: "Escape",
        callback: escape,
        label: "back",
        says: "clear the query, go up a level, or close",
      },
      ...(options.onTab
        ? [
            {
              hotkey: "Tab" as const,
              callback: () => options.onTab?.(false),
              label: "next cell",
              says: "leave the list for the next cell",
            },
            {
              hotkey: "Shift+Tab" as const,
              callback: () => options.onTab?.(true),
              label: "previous cell",
              says: "leave the list for the previous cell",
            },
          ]
        : []),
      ...(select === "multi"
        ? [
            {
              hotkey: "Space" as const,
              callback: () => pick(cursor, false, true),
              label: "toggle",
              says: "add or remove the row",
            },
            {
              hotkey: "Shift+ArrowDown" as const,
              callback: () => {
                const next = moveBy(1);
                if (next) range(next.key);
              },
              label: "extend down",
              says: "extend the selection over the visible rows",
            },
            {
              hotkey: "Shift+ArrowUp" as const,
              callback: () => {
                const next = moveBy(-1);
                if (next) range(next.key);
              },
              label: "extend up",
              says: "extend the selection over the visible rows",
            },
          ]
        : []),
    ] satisfies ScopeKey[]
  ).map((definition) => collectionKey(definition, options.target));
  useScopeKeys(keys, options.target);

  const optionId = (key: string) => `${listId}-${key.replace(/[^\w-]/g, "_")}`;
  // The cursored row stays in view as the keys move it.
  const cursorId = cursor ? optionId(cursor.key) : null;
  useEffect(() => {
    if (cursorId && options.scrollCursor !== false)
      document.getElementById(cursorId)?.scrollIntoView?.({ block: "nearest" });
  }, [cursorId, options.scrollCursor]);
  return {
    query,
    /** Typing resets the cursor to the top hit. */
    setQuery: (next: string) => {
      setQuery(next);
      setCursorKey(null);
    },
    visible,
    status,
    cursor: cursor?.key ?? null,
    setCursor: setCursorKey,
    selected: selectedKeys,
    path,
    level,
    levelLabel: levels?.[level]?.label,
    /** Breadcrumb: back to a rung of the ladder. */
    backTo: (to: number) => {
      setPath(path.slice(0, to));
      setDepth(to);
      setQuery("");
      setCursorKey(null);
    },
    pick: (key: string, shift = false, toggling = false) =>
      pick(
        visible.find((row) => row.key === key),
        shift,
        toggling,
      ),
    /** The list element's props: a listbox, multi when selecting many. */
    listProps: {
      id: listId,
      role: "listbox",
      "aria-multiselectable": select === "multi" || undefined,
    },
    /** For an input-owned list (combobox input, composer): the input points at the cursor. */
    inputProps: {
      role: "combobox",
      "aria-controls": listId,
      "aria-expanded": true,
      "aria-activedescendant": cursor ? optionId(cursor.key) : undefined,
    },
    /** A row's props: its id (for aria-activedescendant), role and state. */
    rowProps: (key: string) => ({
      id: optionId(key),
      role: "option",
      "data-key": key,
      cursor: key === cursor?.key,
      selected: select === "none" ? undefined : selectedKeys.includes(key),
      onMouseMove: () => setCursorKey(key),
      onClick: (event: { shiftKey: boolean; ctrlKey?: boolean; metaKey?: boolean }) =>
        pick(
          visible.find((row) => row.key === key),
          event.shiftKey,
          event.ctrlKey || event.metaKey,
        ),
    }),
  };
}

export type Collection<T> = ReturnType<typeof useCollection<T>>;

/** All persisted list state is data; routes may own it in their address. */
export interface ListState<Sort extends string = string> {
  search: ListSearch;
  sort: Sort | "";
  closed: readonly string[];
  /** Expanded tree nodes and inline details, keyed by data identity. */
  open: readonly string[];
  selected: readonly string[];
}

export const emptyListState = <Sort extends string = string>(): ListState<Sort> => ({
  search: emptyListSearch(),
  sort: "",
  closed: [],
  open: [],
  selected: [],
});

export interface ListOptions<T, Sort extends string = string> {
  items: readonly T[];
  keyOf: (item: T) => string;
  /** Keep this reader stable; its index is rebuilt when the data or reader changes. */
  search: (item: T) => {
    text: readonly (string | number | null | undefined)[];
    ids?: readonly number[];
  };
  fields?: Readonly<Record<string, QueryRead<T> & { label?: string }>>;
  /** Changes cancel pending writes and unfinished completion, even if the search stayed identical. */
  scope?: string;
  sorts?: Readonly<Record<Sort, (item: T) => string | number | undefined>>;
  groups?: {
    of: (item: T) => string;
    order?: readonly string[];
    collapsible?: readonly string[];
    defaultClosed?: readonly string[];
  };
  tree?: { childrenOf: (item: T) => readonly T[] };
  stageOf?: (item: T) => RowState["stage"];
  select?: SelectMode;
  state?: ListState<Sort>;
  initialState?: Partial<ListState<Sort>>;
  /** Typing publishes after 250 ms idle; explicit selection, sort and facet changes publish immediately. */
  onState?: (state: ListState<Sort>) => void;
  onPick?: (item: T) => void;
  refusalOf?: (item: T) => string | null | undefined;
}

export interface ListItem<T> {
  key: string;
  item: T;
  depth: number;
  ancestors: readonly string[];
  section: string;
  branch: boolean;
}

export interface ListSearchable {
  text: readonly (string | number | null | undefined)[];
  ids?: readonly number[];
}

export function listWordMatches(searchable: ListSearchable, word: string): boolean {
  return (
    (/^\d+$/.test(word) && !!searchable.ids?.includes(Number(word))) ||
    searchable.text.some((value) => value != null && wordMatches(String(value), word))
  );
}

/** Temporary draft consumers use this same matcher until they adopt useList. */
export const matchesListQuery = (query: string, searchable: ListSearchable) =>
  passes(searchable, readQuery(query), new Map(), listWordMatches);

const wordsOf = (keywords: string) => keywords.toLowerCase().match(/\S+/g) ?? [];

/** Typed conditions share the table evaluator, but literal keywords never pass through its parser. */
function searchPasses<T>(
  item: T,
  search: ListSearch,
  fields: ReadonlyMap<string, QueryRead<T>>,
  word: (item: T, text: string) => boolean,
) {
  return (
    wordsOf(search.keywords).every((text) => word(item, text)) &&
    passes(
      item,
      search.pills.map((pill) => ({
        kind: "field" as const,
        label: pill.field,
        op: "=" as const,
        value: pill.value,
        not: false,
        text: "",
      })),
      fields,
      word,
    )
  );
}

/** Query, sorting, sections and tree order share one data projection, independent of mounted rows. */
export function listModel<T, Sort extends string>(
  options: ListOptions<T, Sort>,
  state: ListState<Sort>,
  searchIndex?: ReadonlyMap<T, ListSearchable>,
) {
  const all: ListItem<T>[] = [];
  const visit = (items: readonly T[], ancestors: readonly string[], section?: string) => {
    for (const item of items) {
      const key = options.keyOf(item);
      const children = options.tree?.childrenOf(item) ?? [];
      const group = section ?? options.groups?.of(item) ?? "";
      all.push({
        key,
        item,
        depth: ancestors.length,
        ancestors,
        section: group,
        branch: children.length > 0,
      });
      visit(children, [...ancestors, key], group);
    }
  };
  visit(options.items, []);
  const fields = new Map(Object.entries(options.fields ?? {}).map(([key, read]) => [key, read]));
  if (options.stageOf)
    fields.set("change", {
      kind: "text",
      read: (item) => options.stageOf!(item) ?? "clean",
      values: ["clean", "proposed", "staged"],
    });
  const sortKey = state.sort;
  const refusal = listSearchRefusal(state.search, [...fields.keys()]);
  const word = (item: T, text: string) => {
    const searchable = searchIndex?.get(item) ?? options.search(item);
    return listWordMatches(searchable, text);
  };
  const lowerFields = new Map([...fields].map(([key, read]) => [key.toLowerCase(), read]));
  const matching = refusal
    ? []
    : all.filter((row) => searchPasses(row.item, state.search, lowerFields, word));
  const included = new Set(matching.flatMap((row) => [row.key, ...row.ancestors]));
  const filtering = !!state.search.keywords.trim() || state.search.pills.length > 0 || !!refusal;
  const sort = sortKey ? options.sorts?.[sortKey] : undefined;
  const ordered = all
    .filter((row) => included.has(row.key))
    .sort((a, b) => {
      // Sorting siblings retains the tree's parent-before-child order below.
      if (!sort) return 0;
      const x = sort(a.item),
        y = sort(b.item);
      return x === y
        ? 0
        : x === undefined
          ? -1
          : y === undefined
            ? 1
            : typeof x === "number" && typeof y === "number"
              ? x - y
              : String(x).localeCompare(String(y));
    });
  const sectionKeys = [
    ...new Set([...(options.groups?.order ?? []), ...ordered.map((row) => row.section)]),
  ];
  const bySection = new Map<string, ListItem<T>[]>();
  for (const row of ordered) {
    const members = bySection.get(row.section) ?? [];
    members.push(row);
    bySection.set(row.section, members);
  }
  const sections = sectionKeys
    .map((key) => {
      const members = bySection.get(key) ?? [];
      const children = new Map<string | undefined, ListItem<T>[]>();
      for (const row of members) {
        const parent = row.ancestors.at(-1);
        const siblings = children.get(parent) ?? [];
        siblings.push(row);
        children.set(parent, siblings);
      }
      const rows: ListItem<T>[] = [];
      const append = (parent: string | undefined) => {
        for (const row of children.get(parent) ?? []) {
          rows.push(row);
          if (filtering || state.open.includes(row.key)) append(row.key);
        }
      };
      append(undefined);
      return {
        key,
        label: key,
        count: members.length,
        staged: members.filter((row) => options.stageOf?.(row.item) === "staged").length,
        collapsible:
          !!options.groups &&
          (!options.groups.collapsible || options.groups.collapsible.includes(key)),
        closed: state.closed.includes(key),
        rows,
      };
    })
    .filter((section) => section.count > 0);
  const facets = [...fields].map(([key, field]) => ({
    key,
    label: options.fields?.[key]?.label ?? key[0]!.toUpperCase() + key.slice(1),
    labels: field.labels,
  }));
  // Candidate counts are paid only while a picker is open. The vocabulary is from the full scope,
  // so narrowing never hides a zero-count choice.
  const valuesFor = (key: string, candidate = state.search) => {
    const field = fields.get(key);
    if (!field) return [];
    const search = { ...candidate, pills: candidate.pills.filter((pill) => pill.field !== key) };
    const rows = all.map((row) => row.item);
    const values = field.values ?? conditionValues(rows, field).map((each) => each.value);
    return conditionValues(
      listSearchRefusal(search, [...fields.keys()])
        ? []
        : rows.filter((item) => searchPasses(item, search, lowerFields, word)),
      { ...field, values },
    );
  };
  return {
    all,
    sections,
    facets,
    valuesFor,
    refusal,
    sort: sortKey,
    filtering,
    total: all.length,
    shown: matching.length,
  };
}

/** The long-list API grows the collection key owner; popups and ladders keep their existing API. */
export function useList<T, Sort extends string = string>(options: ListOptions<T, Sort>) {
  const [ownState, setOwnState] = useState<ListState<Sort>>(() => ({
    ...emptyListState<Sort>(),
    closed: options.groups?.defaultClosed ?? [],
    ...options.initialState,
  }));
  const source = options.state ?? ownState;
  const sourceKey = JSON.stringify(source.search);
  const scope = options.scope ?? "";
  const [draft, setDraft] = useState({ sourceKey, scope, search: source.search });
  const published = useRef(new Set<string>());
  const reset = useRef(0);
  const publication = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  let currentSearch = draft.search;
  if (draft.sourceKey !== sourceKey || draft.scope !== scope) {
    const acknowledged = draft.scope === scope && published.current.delete(sourceKey);
    currentSearch =
      acknowledged && JSON.stringify(draft.search) !== sourceKey ? draft.search : source.search;
    if (!acknowledged) {
      published.current.clear();
      reset.current++;
    }
    clearTimeout(publication.current);
    setDraft({ sourceKey, scope, search: currentSearch });
  }
  const state = { ...source, search: currentSearch };
  const latest = useRef({ options, state, sourceKey, scope });
  latest.current = { options, state, sourceKey, scope };
  const publish = (next: ListState<Sort>) => {
    clearTimeout(publication.current);
    const { options: current } = latest.current;
    published.current.add(JSON.stringify(next.search));
    if (!current.state) setOwnState(next);
    current.onState?.(next);
  };
  useEffect(() => {
    if (
      JSON.stringify(currentSearch) === sourceKey ||
      published.current.has(JSON.stringify(currentSearch))
    )
      return;
    publication.current = setTimeout(
      () => startTransition(() => publish(latest.current.state)),
      250,
    );
    return () => clearTimeout(publication.current);
  }, [currentSearch, sourceKey, scope]);
  const setState = (next: ListState<Sort>) => {
    setDraft({ sourceKey, scope, search: next.search });
    publish(next);
  };
  const setSearch = (search: ListSearch) => setState({ ...state, search });
  const searchIndex = useMemo(() => {
    const index = new Map<T, ListSearchable>();
    const visit = (items: readonly T[]) => {
      for (const item of items) {
        index.set(item, options.search(item));
        if (options.tree) visit(options.tree.childrenOf(item));
      }
    };
    visit(options.items);
    return index;
  }, [options.items, options.search, options.tree?.childrenOf]);
  const model = listModel(options, state, searchIndex);
  const [target, setTarget] = useState<HTMLElement | null>(null);
  const rows = model.sections.flatMap((section) => (section.closed ? [] : section.rows));
  const collection = useCollection({
    items: rows,
    keyOf: (row) => row.key,
    labelOf: (row) => String(searchIndex.get(row.item)?.text[0] ?? row.key),
    query: "",
    filter: "none",
    select: options.select ?? "single",
    selected: state.selected,
    multiAction: "activate",
    onSelectedChange: (selected) => setState({ ...state, selected }),
    refusalOf: (row) => options.refusalOf?.(row.item),
    onPick: (row) => options.onPick?.(row.item),
    onEscape: () => {
      if (state.search.keywords) setSearch({ ...state.search, keywords: "" });
      else if (state.search.pills.length)
        setSearch({ ...state.search, pills: state.search.pills.slice(0, -1) });
      else setState({ ...state, selected: [] });
    },
    target,
    scrollCursor: false,
  });
  const toggleOpen = (key: string) =>
    setState({
      ...state,
      open: state.open.includes(key)
        ? state.open.filter((each) => each !== key)
        : [...state.open, key],
    });
  const cursor = rows.find((row) => row.key === collection.cursor);
  useScopeKeys(
    (
      [
        {
          hotkey: "ArrowRight",
          label: "Open row",
          says: "Open the tree node or move into its children",
          callback: () => {
            if (!cursor) return;
            if (cursor.branch && !state.open.includes(cursor.key)) toggleOpen(cursor.key);
            else {
              const child = rows.find((row) => row.ancestors.at(-1) === cursor.key);
              if (child) collection.setCursor(child.key);
            }
          },
          options: { ignoreInputs: false },
        },
        {
          hotkey: "ArrowLeft",
          label: "Close row",
          says: "Close the tree node or move to its parent",
          callback: () => {
            if (!cursor) return;
            if (state.open.includes(cursor.key)) toggleOpen(cursor.key);
            else if (cursor.ancestors.length) collection.setCursor(cursor.ancestors.at(-1)!);
            else if (options.groups)
              setState({ ...state, closed: [...new Set([...state.closed, cursor.section])] });
          },
          options: { ignoreInputs: false },
        },
      ] satisfies ScopeKey[]
    ).map((definition) => collectionKey(definition, target)),
    target,
  );
  const [revealRequest, setRevealRequest] = useState<{ key: string; serial: number } | null>(null);
  return {
    ...model,
    state,
    setState,
    collection,
    target,
    setTarget,
    rows,
    revealRequest,
    setSearch,
    clearSearch: () => setSearch(emptyListSearch()),
    scope,
    reset: reset.current,
    setKeywords: (keywords: string) => {
      setDraft({ sourceKey, scope, search: { ...state.search, keywords } });
      collection.setCursor(null);
    },
    flush: () => {
      if (JSON.stringify(latest.current.state.search) !== latest.current.sourceKey)
        publish(latest.current.state);
    },
    setSort: (sort: Sort | "") => setState({ ...state, sort }),
    sorts: Object.keys(options.sorts ?? {}) as Sort[],
    toggleOpen,
    toggleSection: (key: string) =>
      setState({
        ...state,
        closed: state.closed.includes(key)
          ? state.closed.filter((each) => each !== key)
          : [...state.closed, key],
      }),
    pickPill: (field: string, value: string, search = state.search) =>
      setSearch(pickListPill(search, field, value)),
    removePill: (field: string) =>
      setSearch({
        ...state.search,
        pills: state.search.pills.filter((pill) => pill.field !== field),
      }),
    reveal: (key: string) => {
      const row = model.all.find((each) => each.key === key);
      if (!row) return;
      setState({
        ...state,
        search: rows.some((each) => each.key === key) ? state.search : emptyListSearch(),
        closed: state.closed.filter((each) => each !== row.section),
        open: [...new Set([...state.open, ...row.ancestors])],
      });
      collection.setCursor(key);
      setRevealRequest((previous) => ({ key, serial: (previous?.serial ?? 0) + 1 }));
    },
    tree: !!options.tree,
    grouped: !!options.groups,
    stageOf: options.stageOf,
    refusalOf: options.refusalOf,
  };
}

export type ListController<T, Sort extends string = string> = ReturnType<typeof useList<T, Sort>>;
