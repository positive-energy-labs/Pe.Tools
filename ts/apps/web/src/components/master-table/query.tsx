/**
 * THE QUERY BOX — the table's one query: a combobox whose caret word asks the grammar for
 * suggestions, and one chip per token it reads. `TableFrame` draws both; this owns the grammar UI.
 */
import { useState } from "react";

import { NarrowChip } from "#/components/lang/chip";
import { Input } from "#/components/lang/input";
import { ListPopup } from "#/components/lang/list-popup";
import type { QueryGrammar, QuerySuggestion } from "#/components/master-table/model";
import { removeToken, tokenAt } from "#/components/master-table/view";

/** One chip per token of the query; an unreadable token is a caution chip that narrows nothing. */
export function QueryChips({
  grammar,
  text,
  onChange,
  count,
}: {
  grammar: QueryGrammar;
  text: string;
  onChange: (text: string) => void;
  /** Rows still in scope. */
  count: number;
}) {
  return grammar
    .tokens(text)
    .map((token, index) => (
      <NarrowChip
        key={`${index}:${token.text}`}
        label={grammar.chip(token).label}
        count={count}
        caution={token.kind === "unknown"}
        onRemove={() => onChange(removeToken(text, token.text))}
        title={
          token.kind === "unknown"
            ? "A word of the query this table cannot read; it narrows nothing. Remove it or fix it in the box."
            : "One word of the query narrowing this table right now. The count is rows still in scope; removing it widens back out."
        }
      />
    ));
}

/** The one query box: the caret's word asks the grammar; Tab or Enter accept, arrows move. */
export function QueryBox({
  grammar,
  text,
  onChange,
  placeholder,
}: {
  grammar: QueryGrammar;
  text: string;
  onChange: (text: string) => void;
  placeholder?: string;
}) {
  const [input, setInput] = useState<HTMLInputElement | null>(null);
  const [open, setOpen] = useState(false);
  const [caret, setCaret] = useState(0);
  const [cursor, setCursor] = useState<string | null>(null);
  const word = tokenAt(text, caret);
  const suggestions = grammar.suggest(text, caret);
  const accept = (entry: QuerySuggestion) => {
    const trailing = /[:!]$/.test(entry.insert) ? "" : " ";
    const next = `${text.slice(0, word.start)}${entry.insert}${trailing}${text.slice(word.end).trimStart()}`;
    const at = word.start + entry.insert.length + trailing.length;
    onChange(next);
    setCaret(at);
    requestAnimationFrame(() => input?.setSelectionRange(at, at));
  };
  return (
    <div className="w-72">
      <Input
        ref={setInput}
        face="mono"
        role="combobox"
        aria-label="table query"
        aria-autocomplete="list"
        value={text}
        placeholder={placeholder ?? "type a word, or focus for the full list"}
        title="The table's query. Free words search the searchable columns; every other word is a rule, and each one is a chip below."
        onChange={(event) => {
          onChange(event.target.value);
          setCaret(event.target.selectionStart ?? event.target.value.length);
          setOpen(true);
        }}
        onSelect={(event) => setCaret(event.currentTarget.selectionStart ?? 0)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
      />
      <ListPopup<QuerySuggestion>
        anchor="caret"
        caret={input}
        owner={input}
        open={open && suggestions.length > 0}
        onOpenChange={setOpen}
        query={word.text}
        aria-label="query suggestions"
        items={suggestions}
        keyOf={(entry) => entry.insert}
        labelOf={(entry) => entry.label}
        filter="none"
        empty="no suggestions"
        maxHeight="14rem"
        onCursorChange={setCursor}
        onTab={() => {
          const entry = suggestions.find((each) => each.insert === cursor) ?? suggestions[0];
          if (entry) accept(entry);
          return Boolean(entry);
        }}
        onPick={accept}
        row={(entry) => ({ label: entry.label, meta: entry.hint })}
      />
    </div>
  );
}
