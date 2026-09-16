import { token } from "#/lib/token";
/**
 * PROTOTYPE (round 3) — PARADIGM D · THE COMPOSED PAGE.
 *
 * Round 2 ruled the shape and this builds it, top to bottom in one lane:
 *   1. the PARAMETER surface as a hybrid — table skeleton × sentence vocabulary, one column per
 *      type, because editing and auditing ACROSS TYPES is the one job a list of sentences loses.
 *   2. the TRIPTYCH as a view, with a sidebar that answers "what drives this" in both graph
 *      directions when you click a part. Paradigm B reduced to the honest half; A's provenance
 *      click living inside it.
 *   3. EVERYTHING ELSE as paradigm C's sentences, laid on one css grid per kind so the token slots
 *      line up down the page — the ruled alignment gap, closed without becoming a table.
 *   4. the RAW JSON as a synced pane, two-way, with cross-pane highlighting both directions.
 *
 * EDITS LAND IN THE JSON. Ruled 2026-08-19: the json is the write target, period. So the chrome
 * names one read source and one write target, the pending-write panel is the diff that write would
 * land, and `materialize into Revit` is present as a DASHED, DISABLED seam — the future one-click,
 * drawn as the seam it is rather than implied by silence. Nothing here syncs anything to any
 * document this family was already materialized into; nothing can, and the no-sync law says the UI
 * must never suggest otherwise.
 *
 * THE JSON PANE IS `prism-react-editor` (POC). It owns the textarea overlay, JSON grammar, bracket
 * matching, Tab indent and undo; the focused field's range is a one-match search scoped to its span.
 * The editor is uncontrolled: its `value` prop is held still while a draft is in flight, because a
 * new prop resets caret and history.
 */
import { useEffect, useMemo, useState } from "react";
import { Editor as PrismEditorView } from "prism-react-editor";
import {
  addEditorHotkey,
  indentSelectedLines,
  insertTab,
  useEditHistory,
} from "prism-react-editor/commands";
import { usePrismEditor } from "prism-react-editor/extensions";
import { useBracketMatcher } from "prism-react-editor/match-brackets";
import { useHighlightBracketPairs } from "prism-react-editor/highlight-brackets";
import { useEditorSearch } from "prism-react-editor/search";
import "prism-react-editor/prism/languages/json";
import "prism-react-editor/layout.css";

import { FactChip } from "#/components/lang/chip";
import { Verb } from "#/components/lang/verb";
import { ParamGrid } from "#/family-review/proto-editor/composed-params";
import { PartSidebar, SentenceGrids } from "#/family-review/proto-editor/composed-parts";
import { Triptych } from "#/family-review/proto-editor/composed-triptych";
import { jsonWithSpans, pointerAtOffset } from "#/family-review/proto-editor/json-map";
import { StatePanel, TypeStage, type Editor } from "#/family-review/proto-editor/shell";
import type { FamilyModel } from "#/family/family-model";

import "./composed.css";

export function ParadigmD({ editor }: { editor: Editor }) {
  const [selected, setSelected] = useState<string | null>("solid:body");
  const [jsonOpen, setJsonOpen] = useState(true);
  const [draft, setDraft] = useState("");

  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto p-3">
        <Chrome editor={editor} jsonOpen={jsonOpen} onToggleJson={() => setJsonOpen((on) => !on)} />

        <ParamGrid editor={editor} />

        <section>
          <div className="mb-1 flex flex-wrap items-baseline gap-2">
            <span>geometry</span>
            <span>
              drawn by `/family`&apos;s v1 evaluator: solids are centred on the family centre planes
              and a solid&apos;s `frame` is NOT applied. Planes, frames and connectors resolve for
              real. A view, never a form — the sidebar is the form.
            </span>
          </div>
          <div className="flex flex-wrap items-start gap-3">
            <Triptych editor={editor} selected={selected} onSelect={setSelected} />
            <PartSidebar editor={editor} selected={selected} onSelect={setSelected} />
          </div>
        </section>

        <SentenceGrids
          editor={editor}
          selected={selected}
          onSelect={setSelected}
          draft={draft}
          setDraft={setDraft}
        />
      </div>

      {jsonOpen ? <JsonPane editor={editor} /> : null}
      <StatePanel editor={editor} showDocument={false} />
    </div>
  );
}

// ── chrome: one read source, one write target, and the seam that is not built ───────────────────

function Chrome({
  editor,
  jsonOpen,
  onToggleJson,
}: {
  editor: Editor;
  jsonOpen: boolean;
  onToggleJson: () => void;
}) {
  return (
    <header
      className="flex flex-wrap items-baseline gap-2 pb-2"
      style={{ borderColor: token("line") }}
    >
      <span>reads from</span>
      <span>family-model-showcase.family.json</span>
      <span>· writes to</span>
      <span>the same json</span>
      <TypeStage editor={editor} />
      <FactChip
        tone="meta"
        title="Every edit on this page lands in the json and nowhere else. A family.json may already be materialized into many documents across many years; landing a write here changes none of them, and this surface will never imply it can."
      >
        one write target
      </FactChip>
      <FactChip
        tone="caution"
        dashed
        title="Not built. The future one-click: land the write in the json AND push it into a chosen open document. Drawn as a seam so its absence is visible rather than assumed."
      >
        seam · materialize into Revit
      </FactChip>
      <Verb
        label="materialize into Revit"
        disabled
        reason="Not built. Edits land in the json; pushing a json into a live document is a separate, future one-click that needs a host and a chosen document."
        onClick={() => {}}
      />
      <span className="ml-auto">
        <Verb
          label={jsonOpen ? "hide json" : "show json"}
          reason="Dock or undock the raw json pane. It is two-way: type in it and the structured surfaces move."
          onClick={onToggleJson}
        />
      </span>
    </header>
  );
}

// ── the synced json pane ────────────────────────────────────────────────────────────────────────

function JsonPane({ editor }: { editor: Editor }) {
  // The text the editor was handed when a draft began; held so typing never resets the caret.
  const [held, setHeld] = useState<string | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);

  const map = useMemo(() => jsonWithSpans(editor.model), [editor.model]);
  const value = held ?? map.text;

  // A draft in flight moves every offset, so the paint would land on the wrong characters.
  const span = held == null && editor.focus != null ? map.byPointer.get(editor.focus) : undefined;

  return (
    <div className="flex min-h-0 w-[420px] flex-col" style={{ borderColor: token("line") }}>
      <div
        className="flex items-baseline justify-between gap-2 px-3 py-2"
        style={{ borderColor: token("line") }}
      >
        <span>family.json</span>
        <span>{editor.focus ?? "click a field or the json"}</span>
      </div>
      {parseError ? (
        <p className="px-3 py-1" style={{ borderColor: token("line") }}>
          not valid json yet — {parseError}. The structured surfaces still show the last document
          that parsed.
        </p>
      ) : null}
      <div data-json-prism="" className="min-h-0 flex-1">
        <PrismEditorView
          language="json"
          value={value}
          lineNumbers={false}
          textareaProps={{
            "aria-label": "raw family.json",
            onBlur: () => {
              // Re-normalize to the canonical serialization once the user is done typing, so the
              // pointer→range map and the text can never disagree.
              if (parseError == null) setHeld(null);
            },
          }}
          onUpdate={(next, prism) => {
            if (!prism.focused) return; // the editor echoing a new `value` prop, not an edit
            if (held == null) setHeld(value);
            try {
              const parsed = JSON.parse(next) as FamilyModel;
              setParseError(null);
              editor.apply(() => parsed);
            } catch (error) {
              setParseError(error instanceof Error ? error.message : "parse failed");
            }
          }}
          onSelectionChange={([start], _, prism) => {
            if (prism.focused && held == null) editor.setFocus(pointerAtOffset(map, start));
          }}
        >
          <JsonExtensions value={value} start={span?.start} end={span?.end} />
        </PrismEditorView>
      </div>
    </div>
  );
}

/** JSON grammar is imported above; this adds bracket matching, Tab indent, undo and the field paint. */
function JsonExtensions({ value, start, end }: { value: string; start?: number; end?: number }) {
  const [prism] = usePrismEditor();
  useBracketMatcher(prism, false);
  useHighlightBracketPairs(prism);
  useEditHistory(prism);
  useEffect(() => {
    const indent = addEditorHotkey(prism, "Tab", (on) => {
      const [from, to] = on.getSelection();
      return from === to ? insertTab(on, from) : indentSelectedLines(on);
    });
    const outdent = addEditorHotkey(prism, "Shift+Tab", (on) => indentSelectedLines(on, true));
    return () => {
      indent();
      outdent();
    };
  }, [prism]);

  const field = useEditorSearch(prism);
  useEffect(() => {
    field.container.dataset.jsonField = "";
    if (start == null || end == null) return field.stopSearch();
    field.search(prism.value.slice(start, end), true, false, false, [start, end]);
    // Bring the painted range into view only when the focus arrived from a structured surface.
    if (!prism.focused) field.container.querySelector("span")?.scrollIntoView({ block: "nearest" });
  }, [prism, field, value, start, end]);
  return null;
}
