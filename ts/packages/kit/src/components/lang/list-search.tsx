import {
  useEffect,
  useSyncExternalStore,
  useMemo,
  useRef,
  useState,
  startTransition,
  type ReactNode,
} from "react";
import { X, Filter, ArrowDownWideNarrow } from "lucide-react";
import { type ListSearch } from "@pe/agent-contracts";
import { Button } from "./button";
import { OutcomeLine } from "./outcome";
import { useWork } from "./pane";
import { chipRecipe } from "./chip";
import { type ListController } from "./collection";
import { KeyHint } from "./key-hint";
import { ListPopup } from "./list-popup";
import { CompletionGhost, Matched, SearchControl } from "./search-control";
import { focusQuiet } from "../../lib/utils";
import { useTeach } from "./use-teach";
import { LIST_SEARCH_SYNTAX, SEARCH_FOCUS_SYNTAX } from "./list-teaching";
import { useScopeKeys, useScopeLive } from "../../keys";

type Pick = {
  key: string;
  text: string;
  label: ReactNode;
  aside?: string;
  /** Rows the value admits under the other conditions; 0 refuses the pick. Absent for non-values. */
  count?: number;
  meta?: ReactNode;
  /** The text the ghost completes: the typed word must begin it. */
  complete?: string;
  take: () => void;
};
/** A value being chosen for one field; `from` is the value label of the pill being edited. */
type Editor = { field: string; search: ListSearch; caret: number; query: string; from?: string };

const rank = (label: string, needle: string) => {
  const at = label.toLowerCase().indexOf(needle);
  return at === 0 ? 0 : at > 0 && /\W/.test(label[at - 1]!) ? 1 : 2;
};

/** Keywords stay typed; an explicit facet pick makes a pill. Escape cancels the pick. */
export function ListBar<T, Sort extends string>({
  list,
  label,
}: {
  list: ListController<T, Sort>;
  label: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  useSearchKey({
    region: () => list.target,
    available: () => !!input.current,
    focus: () => {
      focusQuiet(input.current);
      input.current?.select();
    },
  });
  const defaultOrder = list.grouped ? "Shelf order" : "Input order";
  useTeach({
    kind: "search",
    label: `Search ${label}`,
    fields: list.facets.map((field) => ({
      label: field.label,
      operators: ["is"],
      examples: [`Filter, choose ${field.label}, choose a value`],
    })),
    syntax: LIST_SEARCH_SYNTAX,
  });
  const keywords = list.state.search.keywords;
  const [echo, setEcho] = useState({ source: keywords, value: keywords });
  if (echo.source !== keywords) setEcho({ source: keywords, value: keywords });
  const [field, setField] = useState<HTMLInputElement | null>(null);
  const [open, setOpen] = useState(false);
  const [browse, setBrowse] = useState(false);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const composing = useRef(false);
  const advancing = useRef(false);
  const typed = echo.value;
  useWork(typed !== keywords, `${label}…`);
  const now = useRef({ typed, token: /\S+$/.exec(typed) });
  now.current = { typed, token: /\S+$/.exec(typed) };
  const seen = keywords;
  const seenToken = /\S+$/.exec(seen);
  const facet = (key: string) => list.facets.find((each) => each.key === key);
  const labelOf = (key: string) => facet(key)?.label ?? key;
  const valueLabel = (key: string, value: string) => facet(key)?.labels?.get(value) ?? value;

  const focus = (caret?: number) => {
    focusQuiet(input.current);
    if (caret !== undefined)
      requestAnimationFrame(() => input.current?.setSelectionRange(caret, caret));
  };
  const close = () => {
    setEditor(null);
    setOpen(false);
    setBrowse(false);
    setCursor(null);
  };
  const cancel = () => {
    const caret = editor?.caret;
    close();
    focus(caret);
  };
  const begin = (key: string, consume: boolean, from?: string) => {
    const { typed, token } = now.current;
    const caret = input.current?.selectionStart ?? typed.length;
    const eat = consume && token && caret === typed.length;
    advancing.current = true;
    setEditor({
      field: key,
      caret,
      query: from ?? "",
      from,
      search: {
        ...list.state.search,
        keywords: eat ? typed.slice(0, token.index).trimEnd() : typed,
      },
    });
    setOpen(true);
    setBrowse(false);
    setCursor(null);
    focus();
    if (from) requestAnimationFrame(() => input.current?.select());
  };
  const commit = (key: string, value: string, search: ListSearch) => {
    list.pickPill(key, value, search);
    setEcho({ source: search.keywords, value: search.keywords });
    close();
    focus(search.keywords.length);
  };
  const flush = () => {
    const { typed } = now.current;
    if (!editor && typed !== list.state.search.keywords)
      list.setSearch({ ...list.state.search, keywords: typed });
    else list.flush();
  };

  const suggest = useMemo(() => {
    const fieldPick = (each: (typeof list.facets)[number], consume: boolean, needle = ""): Pick => {
      const values = list.valuesFor(each.key).filter((value) => value.count > 0);
      return {
        key: `field:${each.key}`,
        text: `Filter by ${each.label}`,
        label: (
          <>
            Filter by <Matched text={each.label} needle={needle} />
          </>
        ),
        aside: values
          .slice(0, 4)
          .map((value) => value.label ?? value.value)
          .join(" · "),
        complete: each.label,
        take: () => begin(each.key, consume),
      };
    };
    let picks: Pick[] = [];
    let needle = "";
    let current: string | null = null;
    if (editor) {
      const query = editor.query === editor.from ? "" : editor.query.trim();
      needle = query;
      picks = list
        .valuesFor(editor.field, editor.search)
        .filter((value) => (value.label ?? value.value).toLowerCase().includes(query.toLowerCase()))
        .map((value) => {
          const text = value.label ?? value.value;
          if (text === editor.from) current = `value:${value.value}`;
          return {
            key: `value:${value.value}`,
            text,
            label: <Matched text={text} needle={query} />,
            count: value.count,
            meta: value.count,
            complete: text,
            take: () => commit(editor.field, value.value, editor.search),
          };
        });
    } else if (seenToken && !browse && (open || field === document.activeElement)) {
      needle = seenToken[0].toLowerCase();
      const base = { ...list.state.search, keywords: seen.slice(0, seenToken.index).trimEnd() };
      const values = list.facets
        .flatMap((each) =>
          list.valuesFor(each.key, base).map((value) => ({
            each,
            value,
            text: value.label ?? value.value,
          })),
        )
        .filter((hit) => hit.text.toLowerCase().includes(needle))
        .sort(
          (a, b) =>
            Number(!a.value.count) - Number(!b.value.count) ||
            rank(a.text, needle) - rank(b.text, needle) ||
            b.value.count - a.value.count,
        )
        .slice(0, 6)
        .map(
          ({ each, value, text }): Pick => ({
            key: `value:${each.key}:${value.value}`,
            text: `${each.label}: ${text}`,
            label: (
              <>
                <span className="text-ink-2">{each.label}: </span>
                <Matched text={text} needle={needle} />
              </>
            ),
            count: value.count,
            meta: value.count,
            complete: text,
            take: () => commit(each.key, value.value, base),
          }),
        );
      const fields = list.facets
        .filter(
          (each) =>
            each.label.toLowerCase().includes(needle) || each.key.toLowerCase().startsWith(needle),
        )
        .map((each) => fieldPick(each, true, needle));
      if (values.length || fields.length)
        picks = [
          {
            key: "search",
            text: `Search “${seen.trim()}”`,
            label: `Search “${seen.trim()}”`,
            meta: list.shown,
            take: () => {
              flush();
              close();
            },
          },
          ...values,
          ...fields,
        ];
    } else if (open && browse) picks = list.facets.map((each) => fieldPick(each, false));

    const enabled = picks.filter((each) => each.count !== 0);
    const cursored = enabled.some((each) => each.key === cursor) ? cursor : null;
    const active = cursored ?? current ?? enabled[0]?.key ?? null;
    const word = editor ? needle : (seenToken?.[0] ?? "");
    const ghostPick = word
      ? enabled.find(
          (each) =>
            each.complete &&
            each.complete.length > word.length &&
            each.complete.toLowerCase().startsWith(word.toLowerCase()),
        )
      : undefined;
    const tabPick =
      (cursored && cursored !== "search" ? enabled.find((each) => each.key === cursored) : null) ??
      ghostPick ??
      enabled.find((each) => each.key !== "search");
    return { picks, current, active, word, ghostPick, tabPick };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list, seen, editor, browse, open, cursor, field]);
  const { picks, current, active, word, ghostPick, tabPick } = suggest;
  const typedNow = editor ? editor.query : typed;
  const ghost =
    ghostPick && (editor || seen === typed) && typedNow.endsWith(word)
      ? ghostPick.complete!.slice(word.length)
      : "";
  const expanded = (open || editor !== null) && (editor !== null || picks.length > 0);

  useEffect(() => {
    close();
    setEcho({ source: keywords, value: keywords });
    // Only external navigation cancels a transaction; our own typing acknowledgements do not.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list.reset]);
  const clear = () => {
    close();
    setEcho({ source: "", value: "" });
    list.clearSearch();
    focus();
  };
  const [announcement, announce] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => announce(`${list.shown} of ${list.total} ${label}`), 250);
    return () => clearTimeout(timer);
  }, [list.shown, list.total, label]);
  const pills = list.state.search.pills;
  const draft = editor ? (
    <span
      key={`draft:${editor.field}`}
      className={chipRecipe().base({ class: "bg-ink-2/10 text-ink" })}
      data-list-draft=""
    >
      {labelOf(editor.field)}:
    </span>
  ) : null;
  const editedAt = editor?.from ? pills.findIndex((pill) => pill.field === editor.field) : -1;
  const popup = useMemo(
    () => (
      <ListPopup<Pick>
        anchor="caret"
        caret={field}
        owner={field}
        purpose="picker"
        open={expanded}
        onOpenChange={(next) => {
          if (next) return;
          if (advancing.current) advancing.current = false;
          else close();
        }}
        query={editor ? editor.query : seen}
        aria-label={editor ? "Filter values" : "Search filters"}
        items={picks}
        keyOf={(each) => each.key}
        labelOf={(each) => each.text}
        filter="none"
        select={current ? "single" : "none"}
        selected={current ? [current] : undefined}
        empty={editor && editor.query ? "No matching values" : "No available values"}
        maxHeight="16rem"
        cursor={active}
        onCursorChange={setCursor}
        onPick={(each) => each.take()}
        onEscape={cancel}
        onTab={(back) => {
          if (back || !tabPick) return false;
          tabPick.take();
          return true;
        }}
        row={(each) => ({
          label: each.label,
          aside: each.aside,
          meta:
            each === ghostPick ? (
              <>
                {each.meta}
                <span aria-hidden className="ml-1">
                  <KeyHint mute>Tab</KeyHint>
                </span>
              </>
            ) : (
              each.meta
            ),
          refusal: each.count === 0 ? "No matching rows" : undefined,
        })}
      />
    ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [suggest, expanded, field, editor, seen],
  );
  return (
    <div data-list-search="" data-list-bar="" data-surface="artifact">
      <SearchControl
        face="bar"
        data-list-filter=""
        chips={
          pills.length || draft ? (
            <>
              {pills.map((pill, index) => {
                if (index === editedAt) return draft;
                const title = `${labelOf(pill.field)}: ${valueLabel(pill.field, pill.value)}`;
                return (
                  <span
                    key={pill.field}
                    className={chipRecipe().base()}
                    data-list-pill=""
                    data-tone={list.refusal ? "caution" : undefined}
                  >
                    <Button
                      label={title}
                      icon={Filter}
                      onClick={() => begin(pill.field, false, valueLabel(pill.field, pill.value))}
                    >
                      {title}
                    </Button>
                    <Button
                      label={`Remove the "${title}" narrowing`}
                      icon={X}
                      onClick={() => list.removePill(pill.field)}
                    />
                  </span>
                );
              })}
              {editedAt < 0 ? draft : null}
            </>
          ) : undefined
        }
        trail={
          <>
            {list.sorts.length ? (
              <ListPopup
                aria-label={`Sort ${label}`}
                triggerLabel={`Sort ${label}: ${list.sort || defaultOrder}`}
                anchor="trigger"
                trigger={
                  <>
                    <ArrowDownWideNarrow aria-hidden className="size-3" />
                    <span data-list-search-label="">Sort: {list.sort || defaultOrder}</span>
                  </>
                }
                items={[
                  { key: "", label: defaultOrder },
                  ...list.sorts.map((key) => ({ key, label: key })),
                ]}
                keyOf={(item) => item.key}
                labelOf={(item) => item.label}
                select="single"
                selected={[list.sort]}
                empty="No sorts"
                onPick={(item) => list.setSort(item.key as Sort | "")}
                row={(item) => ({ label: item.label })}
              />
            ) : null}
            {list.filtering ? <Button icon={X} label="Clear search" onClick={clear} /> : null}
            {list.facets.length ? (
              <Button
                label={`Filter ${label}`}
                icon={Filter}
                onClick={() => {
                  close();
                  setBrowse(true);
                  setOpen(true);
                  focus();
                }}
              >
                Filter
              </Button>
            ) : null}
          </>
        }
      >
        <CompletionGhost value={typedNow} ghost={ghost}>
          <input
            ref={(element) => {
              input.current = element;
              setField(element);
            }}
            role="combobox"
            aria-autocomplete="both"
            aria-label={editor ? `Choose ${labelOf(editor.field)}` : `Search ${label}`}
            aria-expanded={expanded}
            autoComplete="off"
            spellCheck={false}
            placeholder={editor ? "Choose a value" : `Search ${label}`}
            value={typedNow}
            className="w-full min-w-0 truncate bg-transparent outline-none placeholder:text-ink-2"
            onClick={() => {
              if (!editor && !typed) {
                setBrowse(true);
                setOpen(true);
              }
            }}
            onBlur={(event) => {
              flush();
              if (!event.relatedTarget?.closest?.("[data-list-popup], [data-list-search]")) close();
            }}
            onCompositionStart={() => {
              composing.current = true;
            }}
            onCompositionEnd={() => {
              composing.current = false;
            }}
            onChange={(event) => {
              const value = event.currentTarget.value;
              setCursor(null);
              setBrowse(false);
              setOpen(true);
              if (editor) setEditor({ ...editor, query: value });
              else {
                setEcho({ source: keywords, value });
                startTransition(() => list.setKeywords(value));
              }
            }}
            // An open popup owns ↑ ↓ Enter Tab Escape on this input (a native listener that stops
            // propagation); these are the keys of the closed box and the ones the list leaves alone.
            onKeyDown={(event) => {
              if (composing.current || event.nativeEvent.isComposing || event.keyCode === 229) {
                event.stopPropagation();
                return;
              }
              const caretAtEnd = event.currentTarget.selectionStart === typedNow.length;
              if (event.key === "ArrowRight" && ghostPick && caretAtEnd) ghostPick.take();
              else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                flush();
                close();
                const rows = list.rows.filter((row) => !list.refusalOf?.(row.item));
                const row = event.key === "ArrowDown" ? rows[0] : rows.at(-1);
                if (row) list.collection.setCursor(row.key, true);
                focusQuiet(list.target);
              } else if (event.key === "Enter") {
                flush();
                close();
              } else if (event.key === "Escape") {
                if (typed) {
                  setEcho({ source: keywords, value: "" });
                  list.setSearch({ ...list.state.search, keywords: "" });
                } else if (pills.length) list.removePill(pills.at(-1)!.field);
                else if (list.target) focusQuiet(list.target);
                else event.currentTarget.blur();
              } else if (event.key === "Backspace" && !typedNow) {
                if (editor?.from) {
                  list.removePill(editor.field);
                  close();
                } else if (editor) cancel();
                else if (pills.length) {
                  const last = pills.at(-1)!;
                  begin(last.field, false, valueLabel(last.field, last.value));
                } else return;
              } else return;
              event.preventDefault();
              event.stopPropagation();
            }}
          />
        </CompletionGhost>
        {!typedNow && !editor ? (
          <span className="[[data-list-search]:focus-within_&]:hidden">
            <KeyHint mute>/</KeyHint>
          </span>
        ) : null}
        <span
          className="t-small text-ink-2 face-mono shrink-0 pr-1"
          data-list-filter-count=""
          aria-busy={typed !== keywords}
        >
          {list.filtering || typed ? `${list.shown} of ${list.total}` : list.total}
        </span>
      </SearchControl>
      {list.collection.reading === "pending" && list.total ? (
        <OutcomeLine kind="busy" label="reading…" />
      ) : null}
      {list.refusal ? <p role="alert">{list.refusal}</p> : null}
      <span className="sr-only" role="status" aria-live="polite">
        {announcement}
      </span>
      {popup}
    </div>
  );
}

export interface SearchKeyOwner {
  region: () => HTMLElement | null;
  focus: () => void;
  available?: () => boolean;
}
const targets = new Set<SearchKeyOwner>();
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
const leader = () => targets.values().next().value ?? null;
const noLeader = () => null;

function pick(): SearchKeyOwner | null {
  const all = [...targets].filter((t) => t.available?.() !== false);
  const active = document.activeElement;
  return (
    all.find((t) => active && t.region()?.contains(active)) ??
    all.find((t) => t.region()?.matches(":hover")) ??
    all[0] ??
    null
  );
}

/** Register search intent; the first mounted registration owns the sole body binding. */
export function useSearchKey(owner: SearchKeyOwner) {
  const live = useScopeLive();
  useTeach(
    { kind: "search", label: "Search", fields: [], syntax: SEARCH_FOCUS_SYNTAX },
    owner.available?.() !== false,
  );
  const latest = useRef<SearchKeyOwner | null>(null);
  latest.current = live ? owner : null;
  const [self] = useState<SearchKeyOwner>(() => ({
    region: () => latest.current?.region() ?? null,
    focus: () => latest.current?.focus(),
    available: () => !!latest.current && latest.current.available?.() !== false,
  }));
  useEffect(() => {
    if (!live) return;
    targets.add(self);
    listeners.forEach((notify) => notify());
    return () => {
      targets.delete(self);
      listeners.forEach((notify) => notify());
      // Hidden subscribers can retain the former leader, including its caller's geometry.
      // Revoke its callbacks after same-turn StrictMode reconnects have had a chance to register.
      queueMicrotask(() => {
        if (!targets.has(self)) latest.current = null;
      });
    };
  }, [self, live]);
  const bindingOwner = useSyncExternalStore(subscribe, leader, noLeader);
  const [body, setBody] = useState<HTMLElement | null>(null);
  useEffect(() => setBody(document.body), []);
  useScopeKeys(
    bindingOwner === self
      ? [
          {
            hotkey: "/",
            label: "Search",
            says: "Search the focused region, then the region under the pointer, then the first live list.",
            callback: (event) => {
              // The composer owns slash commands while its text field has focus.
              if (
                (document.activeElement as HTMLElement | null)?.closest(
                  "input, textarea, select, [contenteditable=true]",
                )
              )
                return;
              const target = pick();
              if (!target) return;
              event.preventDefault();
              target.focus();
            },
            options: { preventDefault: false },
          },
        ]
      : [],
    body,
  );
}
