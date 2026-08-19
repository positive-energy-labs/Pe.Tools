/**
 * PROTOTYPE (round 2 · piece 3) — shared chrome for the three editing paradigms.
 *
 * WHAT EVERY PARADIGM OWES THE READER: the full current state after every action. The paradigms
 * disagree about how you FIND the piece of information; none of them may disagree about showing
 * you what your edit did. So the edit channel, the change ledger and the live document all live
 * here, once, and each paradigm renders the same `StatePanel` beside its own surface.
 *
 * THE LEDGER IS DERIVED, NEVER REMEMBERED (SURFACE-PHILOSOPHY §1). It is a pointer-level diff of
 * the live document against the pristine fixture, recomputed every render — so an edit that
 * cancels an earlier edit REMOVES its line rather than adding a second one, and no undo bookkeeping
 * can drift from the document.
 *
 * THE TOKEN IS A LOCAL FORK. `components/sentence.tsx` owns the app's clickable-noun grammar, but
 * `Sentence` is bound to host targeting (`useFleet`, `resolveTarget`, a `target`/`onBind` pair) and
 * its `Slot`/`Popover` are module-private. GAP: the generic piece — "a typed token whose picker is
 * scoped to what is legal here" — is exactly what this round is testing and is NOT yet a shared
 * primitive. If paradigm C wins, that extraction is the promotion work.
 */
import { useMemo, useState } from "react";

import { Verb } from "#/components/lang/verb";

import {
  legalRefs,
  nodeValue,
  showcaseModel,
  type SlotKind,
} from "#/family-review/proto-editor/model";
import type { FamilyModel } from "#/family/family-model";

// ── the edit channel ────────────────────────────────────────────────────────────────────────────

export interface Editor {
  /** The document as edited — what a write would land. */
  model: FamilyModel;
  /** What the `family.json` currently holds. The PENDING WRITE is `model` minus this. */
  baseline: FamilyModel;
  typeName: string;
  setTypeName: (name: string) => void;
  /** Apply an immutable edit and record what it moved. */
  apply: (fn: (model: FamilyModel) => FamilyModel) => void;
  /** Pointers the LAST action moved — the flash, so the change is findable in a full document. */
  touched: string[];
  /** Discard the pending write; re-read the json. */
  reset: () => void;
  /** MOCK write: the edits land in the json and the diff empties. In memory, nowhere else — and
   *  landing in the json says NOTHING about documents this family was already materialized into. */
  write: () => void;
  /** The JSON pointer the reader is on, whichever pane put them there. Drives cross-pane
   *  highlighting: one focus, two panes, computed both ways — never two synchronised copies. */
  focus: string | null;
  setFocus: (pointer: string | null) => void;
}

export function useEditor(): Editor {
  const [baseline, setBaseline] = useState(showcaseModel);
  const [model, setModel] = useState(baseline);
  const [typeName, setTypeName] = useState("Standard");
  const [touched, setTouched] = useState<string[]>([]);
  const [focus, setFocus] = useState<string | null>(null);
  return {
    model,
    baseline,
    typeName,
    setTypeName,
    apply: (fn) =>
      setModel((prev) => {
        const next = fn(prev);
        setTouched(changes(prev, next).map((change) => change.path));
        return next;
      }),
    touched,
    reset: () => {
      setModel(baseline);
      setTouched([]);
    },
    write: () => {
      setBaseline(model);
      setTouched([]);
    },
    focus,
    setFocus,
  };
}

// ── pointer diff ────────────────────────────────────────────────────────────────────────────────

/** Every leaf of a document as JSON Pointer → text. An empty object is a leaf, so deleting the
 *  last key of a section reads as a change rather than vanishing silently. */
export function flatten(value: unknown, at = ""): Record<string, string> {
  if (value === null || typeof value !== "object") return { [at]: String(value) };
  const entries = Array.isArray(value)
    ? value.map((item, index) => [String(index), item] as const)
    : Object.entries(value as Record<string, unknown>);
  if (entries.length === 0) return { [at]: Array.isArray(value) ? "[]" : "{}" };
  return Object.assign({}, ...entries.map(([key, item]) => flatten(item, `${at}/${key}`)));
}

export interface Change {
  path: string;
  before: string | null;
  after: string | null;
}

export function changes(before: unknown, after: unknown): Change[] {
  const a = flatten(before);
  const b = flatten(after);
  return [...new Set([...Object.keys(a), ...Object.keys(b)])]
    .filter((path) => a[path] !== b[path])
    .sort()
    .map((path) => ({ path, before: a[path] ?? null, after: b[path] ?? null }));
}

// ── the state panel every paradigm renders ──────────────────────────────────────────────────────

/**
 * THE PENDING WRITE. Ruled 2026-08-19: edits ALWAYS land in the json — the json is the write
 * target, period. So this panel is not a scratchpad, it is the write itself, shown before it
 * happens: a pointer-level diff of the edited document against what the file holds, recomputed
 * every render. Landing in the json says NOTHING about documents this family was already
 * materialized into; the no-sync law forbids implying otherwise, and the chrome says so.
 */
export function StatePanel({
  editor,
  showDocument = true,
}: {
  editor: Editor;
  /** The composed page docks a real json pane, so it turns the read-only mirror off. */
  showDocument?: boolean;
}) {
  const staged = changes(editor.baseline, editor.model);
  const touched = new Set(editor.touched);

  return (
    <aside
      className="flex min-h-0 w-80 shrink-0 flex-col border-l"
      style={{ borderColor: "var(--r-line)", background: "var(--r-artifact)" }}
    >
      <div className="border-b px-3 py-2" style={{ borderColor: "var(--r-line)" }}>
        <div className="flex items-baseline justify-between gap-2">
          <span className="t-label t-upper text-[var(--r-ink-2)]">pending write</span>
          <span className="face-mono t-caption text-[var(--r-ink-mute)]">
            {staged.length} pointer{staged.length === 1 ? "" : "s"}
          </span>
        </div>
        {staged.length === 0 ? (
          <p className="t-caption mt-1 text-[var(--r-ink-mute)]">
            nothing to write — the edited document equals the json
          </p>
        ) : (
          <ul className="mt-1 space-y-0.5">
            {staged.map((change) => (
              <li key={change.path}>
                <button
                  type="button"
                  onClick={() => editor.setFocus(change.path)}
                  title={`Show ${change.path} in the json pane`}
                  className="face-mono t-caption w-full text-left"
                  style={{
                    background: editor.focus === change.path ? "var(--r-select)" : "transparent",
                    border: "none",
                    borderRadius: 2,
                    cursor: "pointer",
                    padding: 0,
                  }}
                >
                  <span
                    style={{
                      color: touched.has(change.path) ? "var(--r-caution)" : "var(--r-ink-2)",
                    }}
                  >
                    {change.path}
                  </span>
                  <span className="text-[var(--r-ink-mute)]"> {change.before ?? "∅"} → </span>
                  <span className="text-[var(--r-ink)]">{change.after ?? "∅"}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-2 flex flex-wrap items-baseline gap-2">
          <Verb
            label="write to family.json"
            reason={
              staged.length === 0
                ? "Nothing differs from the json"
                : `Land ${staged.length} pointer change(s) in the json. MOCK: in memory only, and it changes nothing in any document this family was already materialized into.`
            }
            disabled={staged.length === 0}
            onClick={editor.write}
          />
          <Verb
            label="discard"
            reason={
              staged.length === 0
                ? "Nothing to discard"
                : "Throw the pending write away and re-read the json"
            }
            disabled={staged.length === 0}
            onClick={editor.reset}
          />
        </div>
      </div>
      {showDocument ? (
        <div className="min-h-0 flex-1 overflow-auto px-3 py-2">
          <div className="t-label t-upper mb-1 text-[var(--r-ink-2)]">live document</div>
          <pre className="face-mono t-caption whitespace-pre-wrap text-[var(--r-ink-2)]">
            {JSON.stringify(editor.model, null, 2)}
          </pre>
        </div>
      ) : null}
    </aside>
  );
}

// ── typed tokens (the local fork — see the header) ───────────────────────────────────────────────

/** A reference token: shows what it points AT, picks only from what is legal HERE. */
export function RefToken({
  editor,
  value,
  kind,
  onPick,
  title,
  extra,
}: {
  editor: Editor;
  value: string | undefined;
  kind: SlotKind;
  onPick: (ref: string) => void;
  /** What binding this token DOES — never what the token is called. */
  title: string;
  /** Extra legal references this one slot allows beyond the closed set (e.g. a literal in use). */
  extra?: string[];
}) {
  const [open, setOpen] = useState(false);
  const options = useMemo(() => {
    const legal = legalRefs(editor.model, kind);
    return [...new Set([...legal, ...(extra ?? [])])];
  }, [editor.model, kind, extra]);
  const bound = value != null && value !== "";
  const strays = bound && !options.includes(value);

  return (
    <span className="relative inline-block">
      <button
        type="button"
        title={title}
        onClick={() => setOpen((prev) => !prev)}
        className="face-mono t-label"
        style={{
          padding: "0 1px",
          cursor: "pointer",
          background: open ? "var(--r-select)" : "transparent",
          border: "none",
          borderBottom: `0.5px solid ${bound ? "var(--r-ink)" : "var(--r-caution)"}`,
          borderRadius: 0,
          color: strays ? "var(--r-alarm)" : bound ? "var(--r-ink)" : "var(--r-caution)",
          whiteSpace: "nowrap",
        }}
      >
        {bound ? value : "— pick —"}
      </button>
      {open ? (
        <>
          <button
            type="button"
            aria-label="close picker"
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-20 cursor-default"
            style={{ background: "transparent", border: "none" }}
          />
          <div
            className="absolute left-0 top-full z-30 mt-1 max-h-72 w-72 overflow-y-auto px-1 py-1"
            style={{
              border: "0.5px solid var(--r-line-2)",
              background: "var(--r-page)",
              borderRadius: 2,
            }}
          >
            {options.length === 0 ? (
              <p className="t-caption px-1 py-1 text-[var(--r-ink-mute)]">
                nothing legal here yet — author one first
              </p>
            ) : (
              options.map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => {
                    onPick(option);
                    setOpen(false);
                  }}
                  className="face-mono t-label flex w-full items-baseline justify-between gap-2 px-1 py-0.5 text-left"
                  style={{
                    background: option === value ? "var(--r-select)" : "transparent",
                    border: "none",
                    cursor: "pointer",
                    color: "var(--r-ink)",
                  }}
                >
                  <span>{option}</span>
                  <span className="text-[var(--r-ink-mute)]">
                    {nodeValue(editor.model, editor.typeName, option) ?? ""}
                  </span>
                </button>
              ))
            )}
          </div>
        </>
      ) : null}
    </span>
  );
}

/** A literal token: a portable length, a name, a formula. Free text, committed on blur/Enter. */
export function TextToken({
  value,
  onCommit,
  title,
  width = 88,
}: {
  value: string;
  onCommit: (text: string) => void;
  title: string;
  width?: number;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? value;
  return (
    <input
      title={title}
      value={shown}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        if (draft != null && draft !== value) onCommit(draft);
        setDraft(null);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
        if (event.key === "Escape") setDraft(null);
      }}
      className="face-mono t-label"
      style={{
        width,
        padding: "0 2px",
        background: draft != null ? "var(--r-select)" : "transparent",
        border: "none",
        borderBottom: `0.5px solid ${value ? "var(--r-ink)" : "var(--r-caution)"}`,
        borderRadius: 0,
        color: "var(--r-ink)",
      }}
    />
  );
}

/** The staged type. Every resolved number on every paradigm reads through it. */
export function TypeStage({ editor }: { editor: Editor }) {
  return (
    <span className="flex items-baseline gap-1">
      <span className="t-caption text-[var(--r-ink-mute)]">type</span>
      {Object.keys(editor.model.types).map((name) => (
        <button
          key={name}
          type="button"
          title={`Resolve every value on this surface for the ${name} type`}
          onClick={() => editor.setTypeName(name)}
          className="face-mono t-label px-1"
          style={{
            background: name === editor.typeName ? "var(--r-select)" : "transparent",
            border: "none",
            borderRadius: 2,
            cursor: "pointer",
            color: name === editor.typeName ? "var(--r-ink)" : "var(--r-ink-2)",
          }}
        >
          {name}
        </button>
      ))}
    </span>
  );
}
