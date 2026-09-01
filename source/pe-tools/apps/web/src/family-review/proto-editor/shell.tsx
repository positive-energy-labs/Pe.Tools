import { token } from "#/lib/token";
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
import { Press } from "#/components/lang/press";
import { PressContent } from "#/components/anatomy/press-content";

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
      className="flex min-h-0 w-80 flex-col"
      style={{ borderColor: token("line"), backgroundColor: token("artifact") }}
    >
      <div className="px-3 py-2" style={{ borderColor: token("line") }}>
        <div className="flex items-baseline justify-between gap-2">
          <span>pending write</span>
          <span>
            {staged.length} pointer{staged.length === 1 ? "" : "s"}
          </span>
        </div>
        {staged.length === 0 ? (
          <p className="mt-1">nothing to write — the edited document equals the json</p>
        ) : (
          <ul className="mt-1">
            {staged.map((change) => (
              <li key={change.path} className="[&>button]:w-full">
                <Press
                  type="button"
                  onClick={() => editor.setFocus(change.path)}
                  title={`Show ${change.path} in the json pane`}
                  size="caption"
                  data-selected={editor.focus === change.path ? "" : undefined}
                  style={{
                    border: "none",
                    borderRadius: "var(--radius)",
                    cursor: "pointer",
                    padding: 0,
                  }}
                >
                  <span
                    style={{
                      color: touched.has(change.path) ? token("caution") : token("ink-2"),
                    }}
                  >
                    {change.path}
                  </span>
                  <span> {change.before ?? "∅"} → </span>
                  <span>{change.after ?? "∅"}</span>
                </Press>
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
          <div className="mb-1">live document</div>
          <pre>{JSON.stringify(editor.model, null, 2)}</pre>
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
    <span>
      <Press
        type="button"
        title={title}
        onClick={() => setOpen((prev) => !prev)}
        data-selected={open ? "" : undefined}
        style={{
          padding: "0 1px",
          cursor: "pointer",
          border: "none",
          borderBottom: `0.5px solid ${bound ? token("ink") : token("caution")}`,
          borderRadius: 0,
          color: strays ? token("alarm") : bound ? token("ink") : token("caution"),
          whiteSpace: "nowrap",
        }}
      >
        {bound ? value : "— pick —"}
      </Press>
      {open ? (
        <>
          <span className="z-raised">
            <Press
              type="button"
              aria-label="close picker"
              onClick={() => setOpen(false)}
              style={{ backgroundColor: "transparent", border: "none" }}
            />
          </span>
          <div
            className="z-popup mt-1 max-h-72 w-72 overflow-y-auto px-1 py-1"
            style={{
              border: `0.5px solid ${token("line-2")}`,
              backgroundColor: token("page"),
              borderRadius: "var(--radius)",
            }}
          >
            {options.length === 0 ? (
              <p className="px-1 py-1">nothing legal here yet — author one first</p>
            ) : (
              options.map((option) => (
                <Press
                  key={option}
                  type="button"
                  onClick={() => {
                    onPick(option);
                    setOpen(false);
                  }}
                  size="label"
                  data-selected={option === value ? "" : undefined}
                  style={{
                    border: "none",
                    cursor: "pointer",
                    color: token("ink"),
                  }}
                >
                  <PressContent geometry="baseline">
                    <span>{option}</span>
                    <span>{nodeValue(editor.model, editor.typeName, option) ?? ""}</span>
                  </PressContent>
                </Press>
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
      data-selected={draft != null ? "" : undefined}
      style={{
        width,
        padding: "0 2px",
        border: "none",
        borderBottom: `0.5px solid ${value ? token("ink") : token("caution")}`,
        borderRadius: 0,
        color: token("ink"),
      }}
    />
  );
}

/** The staged type. Every resolved number on every paradigm reads through it. */
export function TypeStage({ editor }: { editor: Editor }) {
  return (
    <span className="flex items-baseline gap-1">
      <span>type</span>
      {Object.keys(editor.model.types).map((name) => (
        <Press
          key={name}
          type="button"
          title={`Resolve every value on this surface for the ${name} type`}
          onClick={() => editor.setTypeName(name)}
          size="label"
          data-selected={name === editor.typeName ? "" : undefined}
          style={{
            border: "none",
            borderRadius: "var(--radius)",
            cursor: "pointer",
            color: name === editor.typeName ? token("ink") : token("ink-2"),
          }}
        >
          {name}
        </Press>
      ))}
    </span>
  );
}
