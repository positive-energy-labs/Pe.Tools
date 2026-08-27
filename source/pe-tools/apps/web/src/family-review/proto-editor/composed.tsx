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
 * THE JSON PANE IS A COMPOSITION, NOT `JsonEditor`. `JsonEditor` takes no `decorations`, so an
 * editable pane cannot paint a highlighted range with it. `JsonView` does, and the shipped
 * `.jsonpane-input` / `.jsonpane-paint` classes are exactly the overlay contract — so the pane here
 * is `JsonView` as paint under the shipped textarea. Two rules of local css, zero edits to the
 * sibling-owned file. The promotion fix is one `decorations` prop on `JsonEditor`.
 */
import { useEffect, useMemo, useRef, useState } from "react";

import { FactChip } from "#/components/lang/chip";
import { Verb } from "#/components/lang/verb";
import { ParamGrid } from "#/family-review/proto-editor/composed-params";
import { PartSidebar, SentenceGrids, Triptych } from "#/family-review/proto-editor/composed-parts";
import { jsonWithSpans, pointerAtOffset } from "#/family-review/proto-editor/json-map";
import { StatePanel, TypeStage, type Editor } from "#/family-review/proto-editor/shell";
import { JsonView, type HighlightDecoration } from "#/settings-panes/json-editor";
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
            <span className="t-label t-upper text-[var(--pe-ink-2)]">geometry</span>
            <span className="t-caption text-[var(--pe-caution)]">
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
      className="flex flex-wrap items-baseline gap-2 border-b pb-2"
      style={{ borderColor: "var(--pe-line)" }}
    >
      <span className="t-caption text-[var(--pe-ink-mute)]">reads from</span>
      <span className="face-mono t-label text-[var(--pe-ink)]">
        family-model-showcase.family.json
      </span>
      <span className="t-caption text-[var(--pe-ink-mute)]">· writes to</span>
      <span className="face-mono t-label text-[var(--pe-ink)]">the same json</span>
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
  const [draft, setDraft] = useState<string | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const paint = useRef<HTMLDivElement>(null);
  const pane = useRef<HTMLDivElement>(null);

  const map = useMemo(() => jsonWithSpans(editor.model), [editor.model]);
  const text = draft ?? map.text;

  const decorations = useMemo<HighlightDecoration[]>(() => {
    const span = editor.focus == null ? undefined : map.byPointer.get(editor.focus);
    // A draft in flight moves every offset, so the paint would land on the wrong characters.
    if (!span || draft != null) return [];
    return [{ range: [span.start, span.end] as const, className: "dec-field" }];
  }, [editor.focus, map, draft]);

  // Bring the painted range into view when the focus arrived from a structured surface.
  useEffect(() => {
    paint.current?.querySelector(".dec-field")?.scrollIntoView({ block: "nearest" });
  }, [editor.focus]);

  const caretMoved = (event: React.SyntheticEvent) => {
    const target = event.target as HTMLTextAreaElement;
    if (target.tagName !== "TEXTAREA" || draft != null) return;
    editor.setFocus(pointerAtOffset(map, target.selectionStart));
  };

  return (
    <div
      className="flex min-h-0 w-[420px] shrink-0 flex-col border-l"
      style={{ borderColor: "var(--pe-line)" }}
    >
      <div
        className="flex items-baseline justify-between gap-2 border-b px-3 py-2"
        style={{ borderColor: "var(--pe-line)" }}
      >
        <span className="t-label t-upper text-[var(--pe-ink-2)]">family.json</span>
        <span className="face-mono t-caption text-[var(--pe-ink-mute)]">
          {editor.focus ?? "click a field or the json"}
        </span>
      </div>
      {parseError ? (
        <p
          className="t-caption border-b px-3 py-1 text-[var(--pe-alarm)]"
          style={{ borderColor: "var(--pe-line)" }}
        >
          not valid json yet — {parseError}. The structured surfaces still show the last document
          that parsed.
        </p>
      ) : null}
      <div ref={pane} className="min-h-0 flex-1">
        <div className="jsonpane jsonpane--editor face-mono t-value h-full">
          <div ref={paint} className="jsonpane-paint fed-json-paint">
            <JsonView code={`${text}\n`} decorations={decorations} />
          </div>
          <textarea
            className="jsonpane-input"
            value={text}
            spellCheck={false}
            autoCapitalize="off"
            autoComplete="off"
            wrap="off"
            aria-label="raw family.json"
            onChange={(event) => {
              const next = event.target.value;
              setDraft(next);
              try {
                const parsed = JSON.parse(next) as FamilyModel;
                setParseError(null);
                editor.apply(() => parsed);
              } catch (error) {
                setParseError(error instanceof Error ? error.message : "parse failed");
              }
            }}
            onBlur={() => {
              // Re-normalize to the canonical serialization once the user is done typing, so the
              // pointer→range map and the text can never disagree.
              if (parseError == null) setDraft(null);
            }}
            onSelect={caretMoved}
            onClick={caretMoved}
            onKeyUp={caretMoved}
            onScroll={(event) => {
              const node = paint.current;
              if (!node) return;
              node.scrollTop = event.currentTarget.scrollTop;
              node.scrollLeft = event.currentTarget.scrollLeft;
            }}
          />
        </div>
      </div>
    </div>
  );
}
