/**
 * THE QUERY WORKBENCH — the query box's picker, opened from a button instead of a caret. It
 * writes the same `state.query` / `state.sorts` the box reads, in the same grammar (`clauseText`),
 * so a condition built here is a chip in the box and the reverse. One derivation of what a table
 * can do (`queryCapabilities`) feeds the box, this panel and every column header.
 *
 * `QueryWorkbench` is the table's Filters button (hover, click or keyboard); `ColumnMenu` is a
 * header's button over the same panel, fixed to its own field.
 */
import { createContext, useContext, useRef, useState, type ReactNode } from "react";
import { ChevronDown, Funnel, ListFilter } from "lucide-react";

import { cn } from "../../lib/utils";
import { Button } from "../lang/button";
import { NarrowChip } from "../lang/chip";
import type { Collection, Level } from "../lang/collection";
import { HoverCard, HoverCardTrigger } from "../lang/hover-card";
import { List, PopupFrame } from "../lang/list-popup";
import { Popover, PopoverTrigger } from "../lang/popover";
import { resolveStateColumn } from "./master-table-columns";
import type { Column, QueryVocabulary, TableState } from "./model";
import { chipOf, fieldSaid } from "./query";
import { hasQueryFilter, restoreQueryFilters, setQueryFilter } from "./query-filters";
import { SortMark } from "./sort-mark";
import {
  QUERY_OPS,
  clauseText,
  conditionValues,
  parseConditionNumber,
  queryWords,
  readClause,
  visibleRows,
  type QueryOp,
} from "./view";

/** What a table can be asked, derived once from its resolved columns and the rows in scope. */
export function queryCapabilities<Row>(
  rows: readonly Row[],
  columns: readonly Column<Row>[],
  state: TableState,
): QueryVocabulary {
  const scope = (query: string) => visibleRows(rows, columns, { ...state, query });
  const resolved = columns.map(resolveStateColumn);
  return {
    fields: resolved.map((column) => ({
      label: column.label,
      kind: column.condition?.kind,
      sort: column.sort ? column.key : undefined,
      enumerated: Boolean(column.condition?.values?.length),
      title: column.title,
    })),
    rules: [],
    count: (query) => scope(query).length,
    values: (label, query) => {
      const condition = resolved.find((column) => column.label === label)?.condition;
      return condition ? conditionValues(scope(query), condition) : [];
    },
  };
}

interface QueryControl {
  vocabulary: QueryVocabulary;
  state: TableState;
  onStateChange: (state: TableState) => void;
}

/** The frame's capabilities and state, for the headers under it. Absent outside a TableFrame. */
export const ColumnQuery = createContext<QueryControl | null>(null);

/** One row on any rung. A final row carries `take`; a row without it advances the ladder. */
interface Item {
  key: string;
  label: string;
  hint: string;
  description?: string;
  group?: string;
  field?: string;
  op?: QueryOp;
  take?: () => void;
}

const join = (...words: string[]) => words.filter(Boolean).join(" ");
const rowsSaid = (count: number) => `${count} row${count === 1 ? "" : "s"}`;

const withoutOne = (words: string[], word: string) => {
  const at = words.indexOf(word);
  return at < 0 ? words : words.filter((_, index) => index !== at);
};

/** NOT is logical polarity on a positive op; only `~` and `=` have a negative (`!~`, `!=`).
 * Comparisons ignore it. Returns the op and `!` as the grammar writes them. */
const wire = (op: QueryOp, negated: boolean): [QueryOp, boolean] =>
  !negated ? [op, false] : op === "~" ? [op, true] : op === "=" ? ["!=", false] : [op, false];

/** A written clause as polarity + positive op, so editing `!=` or `!~` shows the stage it means. */
const unwire = (op: QueryOp, not: boolean): [QueryOp, boolean] =>
  op === "!=" ? ["=", !not] : [op, not];

const fieldOf = (word: string, label: string) => {
  const clause = readClause(word);
  return clause.kind === "field" && clause.label.toLowerCase() === label.toLowerCase();
};

/** Field → operator → value as three collection levels; a header starts on its operator rung. */
function QueryPicker({
  vocabulary,
  state,
  onStateChange,
  only,
  onCommit,
  onClose,
}: QueryControl & {
  only?: string;
  /** A final action landed (value, empty, sort, clear): the host dismisses. */
  onCommit: () => void;
  /** Escape with nothing left to clear or walk back. */
  onClose: () => void;
}) {
  const [not, setNot] = useState(false);
  // A chip being edited opens on its value rung; it stays in the query until replaced.
  const [edit, setEdit] = useState<{ label: string; op: QueryOp; editing: string }>();
  const [epoch, setEpoch] = useState(0);
  // The workbench's field pick, so an enumerated field's second rung is named `value`.
  const [picked, setPicked] = useState<string>();
  const live = useRef<Collection<Item> | null>(null);
  const write = (query: string) => onStateChange({ ...state, query });
  const done = () => {
    setNot(false);
    setEdit(undefined);
    setPicked(undefined);
    setEpoch((each) => each + 1);
    onCommit();
  };
  const words = queryWords(state.query);
  const commit = (label: string, op: QueryOp, value: string) => {
    const [wop, negated] = wire(op, not);
    const kept = edit === undefined ? words : withoutOne(words, edit.editing);
    write(join(...kept, clauseText(negated, label, wop, value)));
    done();
  };
  const scoped = only ? words.filter((word) => fieldOf(word, only)) : words;
  const onlySort = only ? vocabulary.fields.find((each) => each.label === only)?.sort : undefined;
  const sorts = only ? state.sorts.filter((sort) => sort.key === onlySort) : state.sorts;
  const fieldNamed = (label: string | undefined) =>
    vocabulary.fields.find((each) => each.label === label);
  /** The condition under construction: the last op pick, or the chip being edited. */
  const target = (path: readonly Item[]) => {
    const last = path.at(-1);
    return last?.op ? { label: last.field!, op: last.op } : edit;
  };

  const fieldItems = (): Item[] => [
    ...(!not
      ? (vocabulary.filters ?? []).map((filter) => {
          const active = hasQueryFilter(state.query, filter);
          const next = setQueryFilter(state.query, filter, !active);
          return {
            key: `filter:${filter.clause}`,
            label: filter.label,
            hint: `${active ? "on" : "off"}${filter.default ? " · default" : ""} · ${rowsSaid(vocabulary.count(setQueryFilter(state.query, filter, true)))}`,
            description: `${filter.description} Condition: ${filter.clause}. Select to ${active ? "remove" : "apply"}.`,
            group: "Named filters",
            take: () => {
              write(next);
              done();
            },
          };
        })
      : []),
    ...vocabulary.fields
      .filter((each) => each.kind || each.sort)
      .map((each) => ({
        key: each.label,
        label: each.label,
        hint: fieldSaid(each),
        field: each.label,
        group: vocabulary.filters?.length ? "Fields" : undefined,
      })),
    // A route's rule words are part of the same query: one pick writes the word (`!` if negated).
    ...vocabulary.rules
      .filter((rule) => not || !vocabulary.filters?.some((filter) => filter.clause === rule.word))
      .map((rule) => {
        const word = `${not ? "!" : ""}${rule.word}`;
        return {
          key: `rule:${rule.word}`,
          label: word,
          hint: `${rule.label} · ${rowsSaid(vocabulary.count(join(state.query, word)))}`,
          group: vocabulary.filters?.length ? "Rules" : undefined,
          take: () => {
            write(join(state.query, word));
            done();
          },
        };
      }),
  ];
  const opItems = (path: readonly Item[]): Item[] => {
    const field = fieldNamed(path[0]?.field ?? only);
    if (!field) return [];
    // A declared vocabulary skips the operator rung: its values come first with `is` implied, then
    // the empty tests, then sorts (ledger round 2, binary opposites behind negation).
    const enumerated = field.enumerated && field.kind;
    return [
      ...(enumerated
        ? valueItems([{ key: "=", label: "", hint: "", field: field.label, op: "=" }])
        : []),
      ...(field.kind ? QUERY_OPS[field.kind] : [])
        .filter(([op, empty]) => op !== "!=" && (!enumerated || empty))
        .map(([op, empty, said]) => {
          const flips = not && (op === "~" || op === "=");
          const label = !flips
            ? said
            : op === "~"
              ? "does not contain"
              : empty
                ? "is not empty"
                : said === "="
                  ? "≠"
                  : "is not";
          return {
            key: `${op}${empty}`,
            label,
            hint: "",
            group: enumerated ? "other" : undefined,
            field: field.label,
            op,
            take: empty ? () => commit(field.label, op, "") : undefined,
          };
        }),
      ...(field.sort
        ? (["asc", "desc"] as const).map((dir) => ({
            key: `sort:${dir}`,
            label: dir === "asc" ? "sort ↑" : "sort ↓",
            hint: `priority ${state.sorts.filter((each) => each.key !== field.sort).length + 1}`,
            group: enumerated ? "other" : undefined,
            take: () => {
              onStateChange({
                ...state,
                sorts: [
                  ...state.sorts.filter((each) => each.key !== field.sort),
                  { key: field.sort!, dir },
                ],
              });
              done();
            },
          }))
        : []),
    ];
  };
  const valueItems = (path: readonly Item[]): Item[] => {
    const at = target(path);
    if (!at) return [];
    return vocabulary.values(at.label, state.query).map((each) => ({
      key: each.value,
      label: each.label ?? each.value,
      hint: rowsSaid(each.count),
      take: () => commit(at.label, at.op, each.value),
    }));
  };
  const valid = (path: readonly Item[], text: string) => {
    const kind = fieldNamed(target(path)?.label)?.kind;
    return text.trim() !== "" && (kind === "text" || parseConditionNumber(text) != null);
  };
  const final = (item: Item) => item.take?.();
  const skips = Boolean(fieldNamed(only ?? picked)?.enumerated);
  const ladder: Level<Item>[] = [
    {
      label: "field",
      crumb: edit?.label,
      items: fieldItems,
      onPick: (item) => {
        setPicked(item.field);
        final(item);
      },
    },
    // An implied `is` draws no crumb: the band reads `Shared › value`.
    skips
      ? { label: "", crumb: "", items: opItems, onPick: final }
      : { label: "operator", items: opItems, onPick: final },
    {
      label: "value",
      items: valueItems,
      onPick: final,
      onCreate: (text) => {
        const path = live.current?.path ?? [];
        const at = target(path);
        if (!at || !valid(path, text)) return;
        const known = valueItems(path).find(
          (item) => item.label.toLowerCase() === text.trim().toLowerCase(),
        );
        commit(at.label, at.op, known?.key ?? text.trim());
      },
      createLabel: (text) =>
        valid(live.current?.path ?? [], text) ? `use “${text}”` : `“${text}” is not a number`,
    },
  ];
  // A column's trigger already names its field: its ladder carries no words, so no heading.
  const levels = only ? ladder.map((rung) => ({ ...rung, label: "", crumb: "" })) : ladder;

  return (
    <List<Item>
      key={epoch}
      levels={levels}
      startLevel={edit ? 2 : only ? 1 : 0}
      keyOf={(item) => item.key}
      labelOf={(item) => item.label}
      groupOf={(item) => item.group}
      detailOf={(item) => item.description ?? item.hint}
      filter="fuzzy"
      aria-label={only ? `${only} filter and sort` : "filter workbench"}
      searchPlaceholder="search or type a value"
      searchTrail={(level) => {
        const op = level === 2 ? target(live.current?.path ?? [])?.op : undefined;
        return level < 2 || op === "~" || op === "=" ? (
          <Button kind="framed" label="negate" pressed={not} onClick={() => setNot(!not)}>
            not
          </Button>
        ) : null;
      }}
      empty="nothing to pick"
      noMatch="no match"
      maxHeight="14rem"
      detail={vocabulary.filters?.length ? (item) => item.description : undefined}
      onCollection={(collection) => {
        live.current = collection;
      }}
      onEscape={onClose}
      footer={(level) => {
        const path = live.current?.path ?? [];
        const field = fieldNamed(level === 1 ? (path[0]?.field ?? only) : target(path)?.label);
        return (
          <div className="flex flex-col gap-1 pb-1">
            {!only &&
              level === 0 &&
              vocabulary.filters?.some(
                (filter) => filter.default && !hasQueryFilter(state.query, filter),
              ) && (
                <Button
                  label="Restore default filters"
                  onClick={() => {
                    write(restoreQueryFilters(state.query, vocabulary.filters!));
                    done();
                  }}
                >
                  Restore defaults
                </Button>
              )}
            {level === 2 && field?.kind === "number" && (
              <p className="t-small text-ink-2">
                A number: pick a suggestion, or type one and press Enter.
              </p>
            )}
            {(scoped.length > 0 || sorts.length > 0) && (
              <div
                className={cn(
                  "flex flex-col gap-1",
                  level === 2 && field?.kind === "number" && "pt-1 hairline-t",
                )}
              >
                <div className="flex flex-wrap items-center gap-1">
                  {scoped.map((word) => {
                    const clause = readClause(word);
                    const chip = chipOf(clause, vocabulary);
                    const rest = join(...words.filter((each) => each !== word));
                    return (
                      <NarrowChip
                        key={word}
                        label={chip.label}
                        detail={chip.detail}
                        caution={chip.caution}
                        title={chip.title}
                        onRemove={() => write(rest)}
                        onEdit={
                          clause.kind === "field"
                            ? () => {
                                const [wop, negated] = unwire(clause.op, clause.not);
                                setNot(negated);
                                setEdit({ label: clause.label, op: wop, editing: word });
                                setEpoch((each) => each + 1);
                              }
                            : undefined
                        }
                      />
                    );
                  })}
                  {sorts.map((sort) => (
                    <NarrowChip
                      key={sort.key}
                      label={
                        vocabulary.fields.find((each) => each.sort === sort.key)?.label ?? sort.key
                      }
                      detail={`${sort.dir === "asc" ? "sort ↑" : "sort ↓"}${
                        state.sorts.length > 1 ? ` ${state.sorts.indexOf(sort) + 1}` : ""
                      }`}
                      title="A sort, applied in chip order; removing it keeps the others."
                      onRemove={() =>
                        onStateChange({
                          ...state,
                          sorts: state.sorts.filter((each) => each !== sort),
                        })
                      }
                    />
                  ))}
                </div>
                <Button
                  label={only ? `clear ${only}` : "clear conditions and sorts"}
                  onClick={() => {
                    onStateChange(
                      only
                        ? {
                            ...state,
                            query: join(...words.filter((word) => !fieldOf(word, only))),
                            sorts: state.sorts.filter((sort) => sort.key !== onlySort),
                          }
                        : { ...state, query: "", sorts: [] },
                    );
                    onCommit();
                  }}
                >
                  {only ? `clear ${only}` : "clear all"}
                </Button>
              </div>
            )}
          </div>
        );
      }}
      row={(item) => ({ label: item.label, meta: item.hint })}
    />
  );
}

/** The table's Filters button: hover (or click, or Enter) opens the picker over the query. */
export function QueryWorkbench(props: QueryControl) {
  const [open, setOpen] = useState(false);
  const active = queryWords(props.state.query).filter((word) => {
    const clause = readClause(word);
    return (
      clause.kind === "field" ||
      props.vocabulary.filters?.some((filter) => filter.clause === word) ||
      (clause.kind === "word" && props.vocabulary.rules.some((rule) => rule.word === clause.word))
    );
  }).length;
  return (
    <HoverCard open={open} onOpenChange={setOpen}>
      <HoverCardTrigger
        kind="framed"
        data-table-filter-trigger
        aria-label="Filters"
        aria-keyshortcuts="F"
        className="t-small px-(--control-pad-x)"
      >
        <span className="flex items-center gap-1">
          <ListFilter aria-hidden className="size-3 shrink-0" />
          Filters
          {active > 0 && <span className="face-mono">{active}</span>}
          <ChevronDown aria-hidden className="size-2.5 shrink-0" />
        </span>
      </HoverCardTrigger>
      <PopupFrame hover label="Filter workbench">
        <QueryPicker {...props} onCommit={() => setOpen(false)} onClose={() => setOpen(false)} />
      </PopupFrame>
    </HoverCard>
  );
}

/** A header's button over the same picker, fixed to its column's field. */
export function ColumnMenu({
  label,
  heading,
  direction,
  rank,
  sortCount,
  right,
}: {
  right?: boolean;
  label: string;
  heading: ReactNode;
  direction: false | "asc" | "desc";
  rank: number;
  sortCount: number;
}) {
  const context = useContext(ColumnQuery);
  const [open, setOpen] = useState(false);
  if (!context) return null;
  const filters = queryWords(context.state.query).filter((word) => fieldOf(word, label)).length;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        data-colhead-trigger=""
        aria-label={`${label}: filter and sort`}
        className={cn(
          "flex w-full min-w-0 items-center gap-1 t-small",
          right ? "justify-end" : "justify-start",
        )}
      >
        <span className="role-colhead min-w-0 truncate">{heading}</span>
        {direction && <SortMark direction={direction} rank={rank} count={sortCount} />}
        {filters > 0 && (
          <span className="shrink-0 text-ink">
            <Funnel
              aria-label={`${filters} filter${filters === 1 ? "" : "s"} on ${label}`}
              className="size-2.5"
            />
          </span>
        )}
      </PopoverTrigger>
      <PopupFrame label={`${label} filter and sort`}>
        <QueryPicker
          {...context}
          only={label}
          onCommit={() => setOpen(false)}
          onClose={() => setOpen(false)}
        />
      </PopupFrame>
    </Popover>
  );
}
