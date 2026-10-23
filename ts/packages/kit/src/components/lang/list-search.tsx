import { useEffect, useRef, useState, startTransition, type RefObject } from "react";
import { type ListSearch } from "@pe/agent-contracts";
import { Button } from "./button";
import { NarrowChip } from "./chip";
import { useCollection, type ListController } from "./collection";
import { PopupFrame } from "./list-popup";
import { Popover } from "./popover";
import { Row } from "./row";
import { SearchControl } from "./search-control";

type Choice = { key: string; label: string; count?: number; value?: string };
type Editor = { field: string; search: ListSearch; caret: number; query: string };

/** Completion is a transaction: only a final value pick removes a captured trailing token. */
export function ListSearchBox<T, Sort extends string>({
  list,
  label,
  input,
}: {
  list: ListController<T, Sort>;
  label: string;
  input: RefObject<HTMLInputElement | null>;
}) {
  const keywords = list.state.search.keywords;
  const [echo, setEcho] = useState({ source: keywords, value: keywords });
  if (echo.source !== keywords) setEcho({ source: keywords, value: keywords });
  const [open, setOpen] = useState(false);
  const [allFields, setAllFields] = useState(false);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [deliberate, setDeliberate] = useState(false);
  const composing = useRef(false);
  const anchor = useRef<HTMLDivElement>(null);
  const token = /\S+$/.exec(echo.value);
  const candidateFields = list.facets.filter(
    (field) =>
      allFields ||
      !token ||
      field.label.toLowerCase().includes(token[0].toLowerCase()) ||
      field.key.toLowerCase().startsWith(token[0].toLowerCase()),
  );
  const values = editor ? list.valuesFor(editor.field, editor.search) : [];
  const choices: Choice[] = editor
    ? values
        .filter((item) =>
          (item.label ?? item.value).toLowerCase().includes(editor.query.toLowerCase()),
        )
        .map((item) => ({
          key: item.value,
          label: item.label ?? item.value,
          value: item.value,
          count: item.count,
        }))
    : candidateFields.map((field) => ({ key: field.key, label: `Filter by ${field.label}` }));
  const focus = (caret?: number) => {
    input.current?.focus();
    if (caret !== undefined)
      requestAnimationFrame(() => input.current?.setSelectionRange(caret, caret));
  };
  const cancel = () => {
    const caret = editor?.caret;
    setEditor(null);
    setOpen(false);
    setDeliberate(false);
    focus(caret);
  };
  const begin = (field: string, inline: boolean) => {
    const caret = input.current?.selectionStart ?? echo.value.length;
    const consume = inline && token && caret === echo.value.length;
    setEditor({
      field,
      caret,
      query: "",
      search: {
        ...list.state.search,
        keywords: consume ? echo.value.slice(0, token.index).trimEnd() : echo.value,
      },
    });
    setOpen(true);
    setDeliberate(false);
    focus();
  };
  const pick = (choice: Choice) => {
    if (!editor) {
      begin(choice.key, !allFields);
      return;
    }
    if (!choice.count) return;
    const search = editor.search;
    list.pickPill(editor.field, choice.value!, search);
    setEcho({ source: search.keywords, value: search.keywords });
    setEditor(null);
    setOpen(false);
    setDeliberate(false);
    focus(search.keywords.length);
  };
  const suggestions = useCollection({
    items: choices,
    keyOf: (choice) => choice.key,
    labelOf: (choice) => choice.label,
    filter: "none",
    select: "none",
    onPick: pick,
    refusalOf: (choice) => (choice.count === 0 ? "No matching rows" : null),
    scrollCursor: false,
    target: null,
  });
  const expanded = open && (editor !== null || choices.length > 0);
  const activeId =
    expanded && deliberate && suggestions.cursor !== null
      ? suggestions.rowProps(suggestions.cursor).id
      : undefined;
  useEffect(() => {
    setEditor(null);
    setOpen(false);
    setDeliberate(false);
    setEcho({ source: keywords, value: keywords });
    // Only external navigation cancels a transaction; our own typing acknowledgements do not.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list.reset]);
  useEffect(() => {
    if (activeId) document.getElementById(activeId)?.scrollIntoView?.({ block: "nearest" });
  }, [activeId]);
  const flush = () => {
    if (!editor && echo.value !== list.state.search.keywords)
      list.setSearch({ ...list.state.search, keywords: echo.value });
    else list.flush();
  };
  const clear = () => {
    setEditor(null);
    setOpen(false);
    setEcho({ source: "", value: "" });
    list.clearSearch();
    focus();
  };
  const [announcement, announce] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => announce(`${list.shown} of ${list.total} ${label}`), 250);
    return () => clearTimeout(timer);
  }, [list.shown, list.total, label]);
  return (
    <Popover
      open={expanded}
      onOpenChange={(next) => {
        if (!next) {
          setEditor(null);
          setOpen(false);
          setDeliberate(false);
        }
      }}
      modal={false}
    >
      <div ref={anchor} data-list-search="">
        <SearchControl
          face="bar"
          data-list-filter=""
          trail={
            list.facets.length ? (
              <Button
                label={`Filter ${label}`}
                onClick={() => {
                  setEditor(null);
                  setAllFields(true);
                  setDeliberate(false);
                  setOpen(true);
                  focus();
                }}
              >
                Filter
              </Button>
            ) : null
          }
        >
          <input
            ref={input}
            role="combobox"
            aria-autocomplete="list"
            aria-label={
              editor
                ? `Choose ${list.facets.find((f) => f.key === editor.field)?.label ?? editor.field}`
                : `Search ${label}`
            }
            aria-expanded={expanded}
            aria-controls={expanded ? suggestions.listProps.id : undefined}
            aria-activedescendant={activeId}
            placeholder={editor ? "Choose a value" : `Search ${label}`}
            value={editor?.query ?? echo.value}
            className="min-w-0 flex-1 bg-transparent outline-none"
            onFocus={() => {
              if (!editor) setOpen(true);
            }}
            onBlur={(event) => {
              flush();
              if (!event.relatedTarget?.closest?.("[data-list-popup], [data-list-search]")) {
                setOpen(false);
                setEditor(null);
              }
            }}
            onCompositionStart={() => {
              composing.current = true;
            }}
            onCompositionEnd={() => {
              composing.current = false;
            }}
            onChange={(event) => {
              const value = event.currentTarget.value;
              setDeliberate(false);
              setOpen(true);
              if (editor) setEditor({ ...editor, query: value });
              else {
                setAllFields(false);
                setEcho({ source: keywords, value });
                startTransition(() => list.setKeywords(value));
              }
            }}
            onKeyDown={(event) => {
              if (composing.current || event.nativeEvent.isComposing || event.keyCode === 229) {
                event.stopPropagation();
                return;
              }
              if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault();
                event.stopPropagation();
                setOpen(true);
                const enabled = choices.filter((choice) => choice.count !== 0);
                const at = deliberate
                  ? enabled.findIndex((choice) => choice.key === suggestions.cursor)
                  : -1;
                const next =
                  at < 0
                    ? event.key === "ArrowDown"
                      ? 0
                      : enabled.length - 1
                    : (at + (event.key === "ArrowDown" ? 1 : -1) + enabled.length) % enabled.length;
                suggestions.setCursor(enabled[next]?.key ?? null);
                setDeliberate(true);
              } else if (event.key === "Enter") {
                event.preventDefault();
                event.stopPropagation();
                if (expanded && deliberate && suggestions.cursor !== null)
                  suggestions.pick(suggestions.cursor);
                else flush();
              } else if (event.key === "Escape") {
                if (editor || expanded) cancel();
                else if (echo.value) {
                  setOpen(false);
                  setEcho({ source: keywords, value: "" });
                  list.setSearch({ ...list.state.search, keywords: "" });
                } else if (list.state.search.pills.length)
                  list.removePill(list.state.search.pills.at(-1)!.field);
                else return;
                event.preventDefault();
                event.stopPropagation();
              } else if (
                event.key === "Backspace" &&
                !editor &&
                !echo.value &&
                list.state.search.pills.length
              ) {
                event.preventDefault();
                event.stopPropagation();
                list.removePill(list.state.search.pills.at(-1)!.field);
              }
            }}
          />
          <span
            className="t-small text-ink-2 face-mono shrink-0 pr-1"
            data-list-filter-count=""
            aria-busy={echo.value !== keywords}
          >
            {list.filtering || echo.value ? `${list.shown} of ${list.total}` : list.total}
          </span>
        </SearchControl>
        {list.state.search.pills.length || list.filtering ? (
          <div
            className="flex flex-wrap items-center gap-1 px-(--item-pad-x) py-1"
            aria-label="Applied filters"
          >
            {list.state.search.pills.map((pill, index) => {
              const field = list.facets.find((each) => each.key === pill.field);
              const title = `${field?.label ?? pill.field}: ${field?.labels?.get(pill.value) ?? pill.value}`;
              return (
                <span
                  key={`${pill.field}-${index}`}
                  className="inline-flex items-center"
                  data-list-pill=""
                >
                  <NarrowChip
                    label={title}
                    title="An equality filter; edit or remove to change the results"
                    caution={Boolean(list.refusal)}
                    onEdit={() => begin(pill.field, false)}
                    onRemove={() => list.removePill(pill.field)}
                  />
                </span>
              );
            })}
            <Button label="Clear search" onClick={clear}>
              Clear search
            </Button>
          </div>
        ) : null}
        {list.refusal ? <p role="alert">{list.refusal}</p> : null}
        <span className="sr-only" role="status" aria-live="polite">
          {announcement}
        </span>
      </div>
      {expanded ? (
        <PopupFrame
          anchor={anchor.current}
          label={editor ? "Filter values" : "Search filters"}
          owned
          purpose="picker"
        >
          {editor ? (
            <div className="px-(--item-pad-x) py-1">
              {list.facets.find((f) => f.key === editor.field)?.label ?? editor.field}
            </div>
          ) : null}
          <div
            {...suggestions.listProps}
            aria-label={editor ? "Filter values" : "Search filters"}
            className="max-h-64 overflow-y-auto"
            onMouseDown={(event) => event.preventDefault()}
          >
            {choices.map((choice) => (
              <Row
                key={choice.key}
                {...suggestions.rowProps(choice.key)}
                label={choice.label}
                meta={choice.count}
                cursor={deliberate && suggestions.cursor === choice.key}
                aria-disabled={choice.count === 0 || undefined}
                refusal={choice.count === 0 ? "No matching rows" : undefined}
                onMouseMove={() => {
                  suggestions.setCursor(choice.key);
                  setDeliberate(true);
                }}
              />
            ))}
            {!choices.length ? (
              <p>{values.length ? "No matching values" : "No available values"}</p>
            ) : null}
          </div>
        </PopupFrame>
      ) : null}
    </Popover>
  );
}
