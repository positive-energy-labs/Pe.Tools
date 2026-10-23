/**
 * THE QUERY BOX — a table's one query (MAP ruling 22). Its words are chips inside the box; the
 * input is the word being built, step by step: a field, then an operator (or a sort), then a
 * value, each offered in `ListPopup` with counts over the rows in scope (ruling 26). A free word
 * searches every searchable field and narrows while it is typed. The query text stays canonical:
 * a chip is a word of `state.query`, a sort chip is an entry of `state.sorts`.
 *
 * With a `command`, an arrow (`→` or `->`) ends the query and opens the caller's vocabulary: its
 * chips follow the arrow chip, its tokens are offered for the word being typed, each complete word
 * (a space, Tab, or a paste) goes through its token, and Enter on an empty word runs the command.
 */
import { CompletionGhost, Matched, SearchControl } from "../lang/search-control";
import { useEffect, useState, type ReactNode } from "react";

import { NarrowChip } from "../lang/chip";
import { ListPopup } from "../lang/list-popup";
import type { QueryCommand, QueryVocabulary, TableState } from "./model";
import {
  QUERY_OPS,
  clauseText,
  opSaid,
  parseConditionNumber,
  queryWords,
  quoted,
  readClause,
  type QueryClause,
} from "./view";
import { TooltipHint } from "../lang/tooltip";
import { focusQuiet } from "../../lib/utils";

import { useTeach } from "../lang/use-teach";

interface Pick {
  key: string;
  label: string;
  /** A short fact beside the label; the explanation goes to `description` (the list detail). */
  hint: string;
  description?: string;
  take: () => void;
}

/** What a field can do, said once for every picker. */
export const fieldSaid = (field: { kind?: "text" | "number"; sort?: string }) =>
  [field.kind && `${field.kind} filter`, field.sort && "sortable"].filter(Boolean).join(" · ");

const join = (...words: string[]) => words.filter(Boolean).join(" ");
const rowsSaid = (count: number) => `${count} row${count === 1 ? "" : "s"}`;

const SAYS = "A word of the query, ANDed with every other chip. Click to edit it in the box.";
const ARROW = /→|->/;

/** The token a complete word (or words) is: an exact label first, else the one label it begins. */
function tokenOf(words: readonly string[], command: QueryCommand) {
  for (let take = Math.min(3, words.length); take >= 1; take--) {
    const said = words.slice(0, take).join(" ").toLowerCase();
    const offered = command.tokens(said);
    const exact = offered.find((each) => each.label.toLowerCase() === said);
    if (exact) return { token: exact, take };
    if (take === 1) {
      const begun = offered.filter((each) => each.label.toLowerCase().startsWith(said));
      if (begun.length === 1) return { token: begun[0]!, take };
    }
  }
  return null;
}

export function chipOf(clause: QueryClause, { fields, rules, filters }: QueryVocabulary) {
  const filter = filters?.find((each) => each.clause === clause.text);
  if (filter)
    return {
      label: filter.label,
      detail: filter.default ? "default" : undefined,
      title: `${filter.description} Condition: ${filter.clause}.${filter.default ? " A default starting filter; remove it to widen the view." : ""}`,
    };
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
  command,
  children,
  lead,
}: {
  vocabulary: QueryVocabulary;
  state: TableState;
  onStateChange: (state: TableState) => void;
  /** The word being built; the frame holds it so the header can open a draft. */
  draft: string;
  onDraft: (draft: string) => void;
  onInput?: (input: HTMLInputElement | null) => void;
  placeholder?: string;
  /** The second vocabulary after `→`. */
  command?: QueryCommand;
  /** Route-owned narrowings, drawn as chips ahead of the query's own. */
  children?: ReactNode;
  /** A leading picker segment in the same frame (the table's filter workbench). */
  lead?: ReactNode;
}) {
  useTeach({
    kind: "search",
    label: "table query",
    fields: vocabulary.fields
      .filter((f) => f.kind || f.sort)
      .map((f) => ({
        label: f.label,
        operators: [
          ...(f.kind ? QUERY_OPS[f.kind].map(([, , says]) => says) : []),
          ...(f.sort ? ["sort ↑", "sort ↓"] : []),
        ],
        examples: f.kind
          ? [
              clauseText(
                false,
                f.label,
                f.kind === "number" ? ">" : "=",
                f.kind === "number" ? "1" : "value",
              ),
            ]
          : [],
      })),
    syntax: [
      "Words search every searchable field; ! negates",
      "Conditions are ANDed; Tab completes",
      ...vocabulary.rules.map((r) => `${r.word}: ${r.label}`),
      ...(command ? [command.says] : []),
    ],
  });
  const [input, setInput] = useState<HTMLInputElement | null>(null);
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState<string | null>(null);
  // The chip being edited: Escape puts it back.
  const [editing, setEditing] = useState<string | null>(null);
  // A pick closes the popup as it picks; a pick that advances the draft reopens it.
  useEffect(() => {
    if (input && document.activeElement === input) setOpen(true);
  }, [input, draft]);
  const armed = command?.armed === true;
  // Typing resets the cursor to the top hit (or, after the arrow, to none).
  useEffect(() => setCursor(null), [draft]);
  // After the arrow, each complete word goes through its token, one word per render, so a pasted
  // "2025 detach" lands as two chips with the second read against the state the first made.
  useEffect(() => {
    if (!command?.armed || !/\s/.test(draft)) return;
    const words = draft.trim().split(/\s+/).filter(Boolean);
    const done = /\s$/.test(draft) ? words.length : words.length - 1;
    if (done < 1) return;
    const hit = tokenOf(words.slice(0, done), command);
    if (!hit) return;
    hit.token.take();
    onDraft(
      words.slice(hit.take).join(" ") + (/\s$/.test(draft) && words.length > hit.take ? " " : ""),
    );
  }, [command, draft, onDraft]);
  const { fields, rules } = vocabulary;
  // A field is nameable when it filters (`kind`) or sorts (`sort`); a sort-only one offers sorts.
  const named = (label: string) =>
    fields.find(
      (each) => (each.kind || each.sort) && each.label.toLowerCase() === label.toLowerCase(),
    );
  // A draft that may still become a field or a rule is a proposal, not yet a search word.
  const naming = (text: string) => {
    const lower = text.replace(/^!?"?/, "").replace(/"$/, "").toLowerCase();
    return (
      lower !== "" &&
      (fields.some(
        (each) => (each.kind || each.sort) && each.label.toLowerCase().startsWith(lower),
      ) ||
        rules.some((each) => each.word.startsWith(lower)) ||
        vocabulary.filters?.some(
          (each) =>
            each.label.toLowerCase().startsWith(lower) ||
            each.clause.toLowerCase().startsWith(lower),
        ))
    );
  };
  const livens = (text: string) => readClause(text).kind === "word" && !naming(text);
  const words = queryWords(state.query);
  // A free draft narrows live as the query's last word; every other word is a chip.
  const live = !armed && draft !== "" && livens(draft) && words.at(-1) === draft;
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
  /** The arrow typed or pasted: the words before it are the query's, the rest is the command's. */
  const arm = (value: string) => {
    const at = value.search(ARROW);
    const left = value.slice(0, at).trim();
    const right = value.slice(at).replace(ARROW, "").trimStart();
    setEditing(null);
    write(join(base, ...queryWords(left)));
    command!.onArmed(true);
    onDraft(right);
  };

  const neg = draft.startsWith("!") ? "!" : "";
  const clause = readClause(draft);
  const field = clause.kind === "field" ? named(clause.label) : undefined;
  const bare = draft.slice(neg.length).replace(/^"|"$/g, "");
  const exact = clause.kind === "field" ? undefined : named(bare);
  let picks: Pick[];
  if (armed) {
    picks = command!.tokens(draft.trim().toLowerCase()).map((token) => ({
      key: `token:${token.key}`,
      label: token.label,
      hint: token.hint ?? "",
      take: () => {
        token.take();
        setCursor(null);
        onDraft("");
      },
    }));
  } else if (clause.kind === "field" && field?.kind) {
    const kind = field.kind;
    const typed = clause.value.trim();
    const token = (value: string) => clauseText(neg !== "", field.label, clause.op, value);
    const valid = typed !== "" && (kind === "text" || parseConditionNumber(typed) != null);
    const values = vocabulary.values(field.label, base);
    const needle = typed.toLowerCase();
    const same = values.find(
      (each) => each.value.toLowerCase() === needle || each.label?.toLowerCase() === needle,
    );
    picks = [
      ...(valid
        ? [
            {
              key: "typed",
              label: typed,
              hint: same ? rowsSaid(same.count) : "as typed",
              take: () => commit(token(same?.value ?? typed)),
            },
          ]
        : []),
      ...values
        .filter(
          (each) =>
            each !== same &&
            (each.value.toLowerCase().includes(needle) ||
              each.label?.toLowerCase().includes(needle)),
        )
        .slice(0, 50)
        .map((each) => ({
          key: `value:${each.value}`,
          label: each.label ?? each.value,
          hint: rowsSaid(each.count),
          take: () => commit(token(each.value)),
        })),
    ];
  } else if (exact) {
    const head = `${neg}${quoted(exact.label)}`;
    const sort = exact.sort;
    picks = (exact.kind ? QUERY_OPS[exact.kind] : []).map(([op, empty, said]) => ({
      key: `${op}${empty}`,
      label: said,
      hint: "",
      take: () => (empty ? commit(`${head}${op}`) : onDraft(`${head}${op}`)),
    }));
    if (sort && !neg)
      for (const dir of ["asc", "desc"] as const)
        picks.push({
          key: dir,
          label: dir === "asc" ? "sort ↑" : "sort ↓",
          hint: `priority ${state.sorts.filter((each) => each.key !== sort).length + 1}`,
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
      .filter((each) => (each.kind || each.sort) && each.label.toLowerCase().includes(needle))
      .map((each) => ({
        key: `field:${each.label}`,
        label: each.label,
        hint: fieldSaid(each),
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
      ...(!neg
        ? (vocabulary.filters ?? [])
            .filter((each) => `${each.label} ${each.clause}`.toLowerCase().includes(needle))
            .map((each) => ({
              key: `filter:${each.clause}`,
              label: each.label,
              hint: `${each.default ? "default · " : ""}${rowsSaid(vocabulary.count(join(base, each.clause)))}`,
              description: each.description,
              take: () => {
                if (!queryWords(base).includes(each.clause)) commit(each.clause);
                else onDraft("");
              },
            }))
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
  // Enter on an empty word after the arrow runs the command, unless the cursor was moved onto a token.
  const cursored = picks.some((each) => each.key === cursor);
  const runs = armed && draft === "" && !cursored;
  // The word the picks complete: the token after the arrow, a condition's value, else a field name.
  const needle = armed
    ? draft.trim()
    : field
      ? clause.kind === "field"
        ? clause.value.trim()
        : ""
      : bare;
  const completes = (each: Pick) =>
    each.key !== "search" &&
    each.key !== "typed" &&
    needle !== "" &&
    each.label.length > needle.length &&
    each.label.toLowerCase().startsWith(needle.toLowerCase());
  // The ghost and Tab agree: a moved cursor, else the first pick the typed word begins.
  const ghostPick = draft.endsWith(needle) ? picks.find(completes) : undefined;
  const tabPick =
    picks.find((each) => each.key === cursor && each.key !== "search") ??
    ghostPick ??
    picks.find((each) => each.key !== "search") ??
    picks[0];

  return (
    <SearchControl
      data-slot="query-box"
      className="min-w-0 flex-1"
      lead={lead}
      chips={
        <>
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
                  focusQuiet(input);
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
          {armed ? (
            <NarrowChip
              label="→"
              onRemove={() => command!.onArmed(false)}
              title={`${command!.says}. Removing the arrow drops the command and keeps the query.`}
            />
          ) : null}
          {armed
            ? command!.chips.map((chip) => (
                <NarrowChip
                  key={chip.key}
                  label={chip.label}
                  detail={chip.detail}
                  onRemove={chip.onRemove}
                  title={chip.title}
                />
              ))
            : null}
        </>
      }
    >
      <CompletionGhost
        value={draft}
        ghost={open && ghostPick ? ghostPick.label.slice(needle.length) : ""}
      >
        <TooltipHint
          content={
            command
              ? "Words search every field; a field name starts a condition; ! negates. An arrow (→ or ->) ends the query and names what to do with the rows it keeps."
              : "Words search every field (4 finds the number 4, not 14). A field name starts a step-by-step condition or sort; ! negates."
          }
        >
          <input
            ref={(element) => {
              setInput(element);
              onInput?.(element);
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
            className="t-small face-mono h-(--item-h) min-w-0 flex-1 bg-transparent outline-none placeholder:text-ink-2"
            value={draft}
            placeholder={
              armed
                ? command!.placeholder
                : (placeholder ?? "search any field, or type a field name")
            }
            onChange={(event) => {
              const value = event.target.value;
              setOpen(true);
              if (armed) return onDraft(value);
              if (command && ARROW.test(value)) return arm(value);
              const quoting = value.split('"').length % 2 === 0;
              // "Item Na" is still naming a field across its space: it stays one draft.
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
            // Enter on an empty word after the arrow runs the command. Taken in the capture phase: the
            // open list owns this input's keys through a native listener that stops propagation, so a
            // bubble-phase handler would never hear it while tokens are still offered.
            onKeyDownCapture={(event) => {
              if (event.key !== "Enter" || !runs) return;
              event.preventDefault();
              event.stopPropagation();
              command!.onCommit();
            }}
            onKeyDown={(event) => {
              // → at the end of the word takes what the ghost shows, as Tab does.
              if (
                event.key === "ArrowRight" &&
                open &&
                ghostPick &&
                event.currentTarget.selectionStart === draft.length
              ) {
                event.preventDefault();
                return ghostPick.take();
              }
              // With the list closed, Escape still clears the word, then drops the command.
              if (event.key === "Escape" && armed && !open)
                return draft === "" ? command!.onArmed(false) : onDraft("");
              if (event.key !== "Backspace" || draft !== "") return;
              event.preventDefault();
              // Backspace on an empty box takes the last chip back into the box, as text.
              if (armed) {
                const last = command!.chips.at(-1);
                if (last) {
                  last.onRemove();
                  onDraft(last.label);
                } else command!.onArmed(false);
                return;
              }
              const last = committed.at(-1);
              if (last) type(last, committed.slice(0, -1).join(" "));
              else if (state.sorts.length)
                onStateChange({ ...state, sorts: state.sorts.slice(0, -1) });
            }}
          />
        </TooltipHint>
      </CompletionGhost>
      <ListPopup<Pick>
        anchor="caret"
        // Suggestions are short facts (a field, an operator, a value): a picker's measure, not prose's.
        purpose="picker"
        caret={input}
        owner={input}
        open={open && picks.length > 0}
        onOpenChange={setOpen}
        query={draft}
        aria-label="query suggestions"
        autoCursor={!runs}
        items={picks}
        keyOf={(entry) => entry.key}
        labelOf={(entry) => entry.label}
        filter="none"
        empty="no suggestions"
        maxHeight="14rem"
        // Escape cancels the draft through the list's one door (MAP ruling 24); after the arrow an
        // empty draft's Escape drops the command.
        onEscape={() => {
          if (armed) return draft === "" ? command!.onArmed(false) : onDraft("");
          return editing ? commit(editing) : type("");
        }}
        // Enter takes the highlighted suggestion, else the top one, at every step; after the arrow
        // an empty word has no top one, so Enter runs the command.
        cursor={cursored ? cursor : runs ? null : (picks[0]?.key ?? null)}
        onCursorChange={setCursor}
        // Tab completes to the first suggestion; the typed row is what Enter already keeps.
        onTab={() => {
          tabPick?.take();
          return Boolean(tabPick);
        }}
        onPick={(entry) => entry.take()}
        row={(entry) => ({
          label: <Matched text={entry.label} needle={needle} />,
          meta: entry.hint,
        })}
        detail={(entry) => entry.description}
      />
    </SearchControl>
  );
}
