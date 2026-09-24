/**
 * THE QUERY BOX — a table's one query (MAP ruling 22). Its words are chips inside the box; the
 * input is the word being built, step by step: a field, then an operator (or a sort), then a
 * value, each offered in `ListPopup` with counts over the rows in scope (ruling 26). A free word
 * searches every searchable field and narrows while it is typed. The query text stays canonical:
 * a chip is a word of `state.query`, a sort chip is an entry of `state.sorts`.
 */
import { createContext, useEffect, useState, type ReactNode } from "react";

import { NarrowChip } from "#/components/lang/chip";
import { ListPopup } from "#/components/lang/list-popup";
import type { QueryVocabulary, TableState } from "#/components/master-table/model";
import {
  QUERY_OPS,
  opSaid,
  parseConditionNumber,
  queryWords,
  quoted,
  readClause,
  type QueryClause,
} from "#/components/master-table/view";

/** The header's way into the box: opens a draft on one field. Absent outside a TableFrame. */
export const ConditionTarget = createContext<((label: string) => void) | null>(null);

interface Pick {
  key: string;
  label: string;
  hint: string;
  take: () => void;
}

const join = (...words: string[]) => words.filter(Boolean).join(" ");
const rowsSaid = (count: number) => `${count} row${count === 1 ? "" : "s"}`;

const SAYS = "A word of the query, ANDed with every other chip. Click to edit it in the box.";

function chipOf(clause: QueryClause, { fields, rules }: QueryVocabulary) {
  const not = clause.not ? "not " : "";
  if (clause.kind === "field") {
    const field = fields.find((each) => each.label.toLowerCase() === clause.label.toLowerCase());
    if (field?.kind)
      return {
        label: `${not}${field.label}`,
        detail: opSaid(field.kind, clause.op, clause.value),
        title: SAYS,
      };
  } else if (clause.kind === "word") {
    const rule = rules.find((each) => each.word === clause.word.toLowerCase());
    return rule
      ? { label: `${not}${rule.word}`, title: `A word of the query: ${not}${rule.label}. ${SAYS}` }
      : { label: `${not}search: ${clause.word}`, title: SAYS };
  }
  return {
    label: `unknown: ${clause.text}`,
    caution: true,
    title: "A word of the query this table cannot read; it narrows nothing. Edit or remove it.",
  };
}

export function QueryBox({
  vocabulary,
  state,
  onStateChange,
  draft,
  onDraft,
  onInput,
  placeholder,
  children,
}: {
  vocabulary: QueryVocabulary;
  state: TableState;
  onStateChange: (state: TableState) => void;
  /** The word being built; the frame holds it so the header can open a draft. */
  draft: string;
  onDraft: (draft: string) => void;
  onInput: (input: HTMLInputElement | null) => void;
  placeholder?: string;
  /** Route-owned narrowings, drawn as chips ahead of the query's own. */
  children?: ReactNode;
}) {
  const [input, setInput] = useState<HTMLInputElement | null>(null);
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState<string | null>(null);
  // The chip being edited: Escape puts it back.
  const [editing, setEditing] = useState<string | null>(null);
  // A pick closes the popup as it picks; a pick that advances the draft reopens it.
  useEffect(() => {
    if (input && document.activeElement === input) setOpen(true);
  }, [input, draft]);
  const { fields, rules } = vocabulary;
  const named = (label: string) =>
    fields.find((each) => each.kind && each.label.toLowerCase() === label.toLowerCase());
  // A draft that may still become a field or a rule is a proposal, not yet a search word.
  const naming = (text: string) => {
    const lower = text.replace(/^!?"?/, "").toLowerCase();
    return (
      lower !== "" &&
      (fields.some((each) => each.kind && each.label.toLowerCase().startsWith(lower)) ||
        rules.some((each) => each.word.startsWith(lower)))
    );
  };
  const livens = (text: string) => readClause(text).kind === "word" && !naming(text);
  const words = queryWords(state.query);
  // A free draft narrows live as the query's last word; every other word is a chip.
  const live = draft !== "" && livens(draft) && words.at(-1) === draft;
  const committed = live ? words.slice(0, -1) : words;
  const base = committed.join(" ");
  const write = (query: string) => {
    if (query !== state.query) onStateChange({ ...state, query });
  };
  const type = (text: string, from = base) => {
    onDraft(text);
    write(join(from, livens(text) ? text : ""));
  };
  const commit = (text: string) => {
    onDraft("");
    setEditing(null);
    write(join(base, text));
  };

  const neg = draft.startsWith("!") ? "!" : "";
  const clause = readClause(draft);
  const field = clause.kind === "field" ? named(clause.label) : undefined;
  const bare = draft.slice(neg.length).replace(/^"|"$/g, "");
  const exact = clause.kind === "field" ? undefined : named(bare);
  let picks: Pick[];
  if (clause.kind === "field" && field?.kind) {
    const kind = field.kind;
    const typed = clause.value.trim();
    const token = (value: string) => `${neg}${quoted(field.label)}${clause.op}${quoted(value)}`;
    const valid = typed !== "" && (kind === "text" || parseConditionNumber(typed) != null);
    const values = vocabulary.values(field.label, base);
    const same = values.find((each) => each.value.toLowerCase() === typed.toLowerCase());
    picks = [
      ...(valid
        ? [
            {
              key: "typed",
              label: typed,
              hint: same ? rowsSaid(same.count) : "as typed",
              take: () => commit(token(typed)),
            },
          ]
        : []),
      ...values
        .filter((each) => each !== same && each.value.toLowerCase().includes(typed.toLowerCase()))
        .slice(0, 50)
        .map((each) => ({
          key: `value:${each.value}`,
          label: each.value,
          hint: rowsSaid(each.count),
          take: () => commit(token(each.value)),
        })),
    ];
  } else if (exact?.kind) {
    const head = `${neg}${quoted(exact.label)}`;
    const sort = exact.sort;
    picks = QUERY_OPS[exact.kind].map(([op, empty, said]) => ({
      key: `${op}${empty}`,
      label: said,
      hint: empty ? "no value to enter" : "",
      take: () => (empty ? commit(`${head}${op}`) : onDraft(`${head}${op}`)),
    }));
    if (sort && !neg)
      for (const dir of ["asc", "desc"] as const)
        picks.push({
          key: dir,
          label: dir === "asc" ? "sort ↑" : "sort ↓",
          hint: "a sort chip",
          take: () => {
            onDraft("");
            onStateChange({
              ...state,
              query: base,
              sorts: [...state.sorts.filter((each) => each.key !== sort), { key: sort, dir }],
            });
          },
        });
  } else {
    const needle = bare.toLowerCase();
    const offered = fields
      .filter((each) => each.kind && each.label.toLowerCase().includes(needle))
      .map((each) => ({
        key: `field:${each.label}`,
        label: each.label,
        hint: `${each.kind} field`,
        prefix: each.label.toLowerCase().startsWith(needle),
        take: () => type(`${neg}${quoted(each.label)}`),
      }));
    // The typed word is row one with its hit count, so Enter keeps it (MAP ruling 47).
    picks = [
      ...(clause.kind === "word" && !rules.some((each) => each.word === needle)
        ? [
            {
              key: "search",
              label: `${neg ? "not " : ""}search “${clause.word}” in any field`,
              hint: rowsSaid(vocabulary.count(join(base, draft))),
              take: () => commit(draft),
            },
          ]
        : []),
      ...offered.filter((each) => each.prefix),
      ...rules
        .filter((each) => each.word.startsWith(needle))
        .map((each) => ({
          key: `rule:${each.word}`,
          label: `${neg}${each.word}`,
          hint: each.label,
          take: () => commit(`${neg}${each.word}`),
        })),
      ...offered.filter((each) => !each.prefix),
    ];
  }
  const sortLabel = (key: string) => fields.find((each) => each.sort === key)?.label ?? key;

  return (
    <div
      data-slot="query-box"
      className="flex max-h-[calc(var(--item-h)*2)] min-h-(--item-h) min-w-0 flex-1 flex-wrap items-center gap-x-1 gap-y-px overflow-y-auto"
    >
      {children}
      {committed.map((word, index) => {
        const chip = chipOf(readClause(word), vocabulary);
        const rest = committed.filter((_, at) => at !== index).join(" ");
        return (
          <NarrowChip
            key={`${index}:${word}`}
            label={chip.label}
            detail={chip.detail}
            caution={chip.caution}
            onRemove={() => write(join(rest, live ? draft : ""))}
            onEdit={() => {
              setEditing(word);
              type(word, rest);
              input?.focus();
            }}
            title={chip.title}
          />
        );
      })}
      {state.sorts.map((sort) => (
        <NarrowChip
          key={`sort:${sort.key}`}
          label={sortLabel(sort.key)}
          detail={sort.dir === "asc" ? "sort ↑" : "sort ↓"}
          onRemove={() =>
            onStateChange({ ...state, sorts: state.sorts.filter((each) => each !== sort) })
          }
          title="A sort, applied in chip order; removing it keeps the others."
        />
      ))}
      <input
        ref={(element) => {
          setInput(element);
          onInput(element);
        }}
        role="combobox"
        aria-label="table query"
        aria-autocomplete="list"
        aria-invalid={
          field?.kind === "number" &&
          clause.kind === "field" &&
          clause.value.trim() !== "" &&
          parseConditionNumber(clause.value) == null
            ? true
            : undefined
        }
        autoComplete="off"
        className="t-small face-mono h-(--item-h) min-w-40 flex-1 bg-transparent outline-none placeholder:text-ink-2"
        value={draft}
        placeholder={placeholder ?? "search any field, or type a field name"}
        title="Words search every field (4 finds the number 4, not 14). A field name starts a step-by-step condition or sort; ! negates."
        onChange={(event) => {
          const value = event.target.value;
          setOpen(true);
          const quoting = value.split('"').length % 2 === 0;
          // "Room Na" is still naming a field across its space: it stays one draft.
          if (quoting || !/\s/.test(value) || (!/[~=<>]/.test(value) && naming(value)))
            return type(value);
          const parts = queryWords(value);
          const rest = /\s$/.test(value) ? "" : (parts.pop() ?? "");
          setEditing(null);
          type(rest, join(base, ...parts));
        }}
        onFocus={() => setOpen(true)}
        onClick={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(event) => {
          if (event.key !== "Backspace" || draft !== "") return;
          event.preventDefault();
          // Backspace on an empty box takes the last chip back into the box, as text.
          const last = committed.at(-1);
          if (last) type(last, committed.slice(0, -1).join(" "));
          else if (state.sorts.length) onStateChange({ ...state, sorts: state.sorts.slice(0, -1) });
        }}
      />
      <ListPopup<Pick>
        anchor="caret"
        caret={input}
        owner={input}
        open={open && picks.length > 0}
        onOpenChange={setOpen}
        query={draft}
        aria-label="query suggestions"
        items={picks}
        keyOf={(entry) => entry.key}
        labelOf={(entry) => entry.label}
        filter="none"
        empty="no suggestions"
        maxHeight="14rem"
        // Escape cancels the draft through the list's one door (MAP ruling 24).
        onEscape={() => (editing ? commit(editing) : type(""))}
        // Enter takes the highlighted suggestion, else the top one, at every step.
        cursor={picks.some((each) => each.key === cursor) ? cursor : (picks[0]?.key ?? null)}
        onCursorChange={setCursor}
        // Tab completes to the first suggestion; the typed row is what Enter already keeps.
        onTab={() => {
          const entry =
            picks.find((each) => each.key === cursor && each.key !== "search") ??
            picks.find((each) => each.key !== "search") ??
            picks[0];
          entry?.take();
          return Boolean(entry);
        }}
        onPick={(entry) => entry.take()}
        row={(entry) => ({ label: entry.label, meta: entry.hint })}
      />
    </div>
  );
}
