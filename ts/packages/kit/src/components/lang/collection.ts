/**
 * useCollection: the one headless list behaviour and the one key owner for every list. It knows
 * no pixels: it turns items into visible rows, holds cursor, selection and query, and binds keys
 * on the scope node (`useScopeKeys`). Identity is by key, never by object.
 */
import { useEffect, useId, useMemo, useState } from "react";

import { useScopeKeys, type ScopeKey } from "../../keys";

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
}

export type VisibleRow<T> =
  | { kind: "head"; key: string; label: string; count: number }
  | { kind: "item"; key: string; item: T; path: readonly T[]; level: number }
  | { kind: "create"; key: string; text: string }
  /** A capped group's tail: `count` rows hidden; a pick shows them and cursors `next`. */
  | { kind: "more"; key: string; group: string; count: number; next: string };

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
  if (mode === "substring") {
    const lower = q.toLowerCase();
    return items.filter((item) => labelOf(item).toLowerCase().includes(lower));
  }
  if (mode === "words") {
    // Each query word starts a word of the label, sits in the label, or starts a word of the
    // detail, best first. "duct" finds "Duct Loss", never "Identity and instruction" or "product".
    const parts = (text: string) => text.toLowerCase().split(/[\s\-_./›()]+/);
    return items
      .map((item, index) => {
        const label = labelOf(item).toLowerCase();
        const labelWords = parts(label);
        const detailWords = detailOf ? parts(detailOf(item)) : [];
        let score = 0;
        for (const word of q.toLowerCase().split(/\s+/)) {
          if (labelWords.some((part) => part.startsWith(word))) score += 3;
          else if (label.includes(word)) score += 2;
          else if (detailWords.some((part) => part.startsWith(word))) score += 1;
          else return null;
        }
        return { item, index, score };
      })
      .filter((hit) => hit !== null)
      .sort((a, b) => b.score - a.score || a.index - b.index)
      .map((hit) => hit.item);
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
    if (
      options.onCreate &&
      text &&
      !rows.some((r) => r.kind === "item" && labelOf(r.item) === text)
    )
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
    options.onCreate,
    groupCap,
    expanded,
    leadingGroups.join("|"),
  ]);

  const pickable = visible.filter((row) => row.kind !== "head");
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
    const from = keys.indexOf(anchor ?? key);
    const to = keys.indexOf(key);
    if (from < 0 || to < 0) return setSelected([key]);
    const span = keys.slice(Math.min(from, to), Math.max(from, to) + 1);
    setSelected([...new Set([...selectedKeys, ...span])]);
  };

  const pick = (row: VisibleRow<T> | undefined, shift = false) => {
    if (!row || row.kind === "head") return;
    if (row.kind === "create") return options.onCreate?.(row.text);
    if (row.kind === "more") {
      setExpanded([...expanded, row.group]);
      return setCursorKey(row.next);
    }
    setCursorKey(row.key);
    if (options.refusalOf?.(row.item)) return;
    if (select === "multi") {
      if (shift) range(row.key);
      else {
        toggle(row.key);
        setAnchor(row.key);
      }
      return;
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
              callback: () => pick(cursor),
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
  ).map(
    (definition): ScopeKey => ({
      ...definition,
      options: {
        // The list's own input owns typing; these keys still reach the list from it.
        ignoreInputs: false,
      },
    }),
  );
  useScopeKeys(keys, options.target);

  const optionId = (key: string) => `${listId}-${key.replace(/[^\w-]/g, "_")}`;
  // The cursored row stays in view as the keys move it.
  const cursorId = cursor ? optionId(cursor.key) : null;
  useEffect(() => {
    if (cursorId) document.getElementById(cursorId)?.scrollIntoView?.({ block: "nearest" });
  }, [cursorId]);
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
    pick: (key: string, shift = false) =>
      pick(
        visible.find((row) => row.key === key),
        shift,
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
      onClick: (event: { shiftKey: boolean }) =>
        pick(
          visible.find((row) => row.key === key),
          event.shiftKey,
        ),
    }),
  };
}

export type Collection<T> = ReturnType<typeof useCollection<T>>;
