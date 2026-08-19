/**
 * /family-editor-proto — THROWAWAY. find-the-product round 2, piece 3: the SOLID-EDITING PARADIGM.
 *
 * THE QUESTION (MAP, round 2 frontier §3): `family.json` is complex and relation-heavy — frames
 * reference faces and planes, solids reference frames and parameters, arrays reference nested
 * families and limit planes. Authoring from scratch is hard even through a GUI, and JSON form
 * generation is REJECTED as the end state: it is glorified JSON editing. Wanted is an editing
 * paradigm that makes the RELATIONS abundantly clear and makes the exact piece of information you
 * are imagining trivially findable.
 *
 * Three paradigms, one document. All three edit the SAME real fixture — `PE Family Model Showcase`,
 * the family that carries chained planes, four frames off solid faces, a formula-driven parameter,
 * voids and four connectors — in memory, with no persistence, and all three render the full current
 * state after every action (right rail) so an edit and its consequence arrive together.
 *
 *   A · ANCHOR-FIRST   pick a datum, see everything defined off it and everything it is defined
 *                      from; editing walks the graph; re-anchoring dependents is one action.
 *   B · DRAWING-AS-FORM the triptych IS the form. Point at the picture you already have in your
 *                      head; the dimension line is the door to the parameter behind it.
 *   C · SENTENCE       every construct is one structured sentence whose every token is a typed
 *                      picker scoped to what is legal there.
 *
 *   D · COMPOSED     round 3: the page round 2's verdicts describe — the parameter hybrid on top,
 *                    the triptych + provenance sidebar in the middle, the aligned sentences below,
 *                    and the raw json as a two-way pane with cross-pane highlighting. a/b/c stay
 *                    untouched as the reference the composition is argued against.
 *
 * `?paradigm=a|b|c|d`. Dies with the round; promote the winner, and the losers never reach main.
 */
import { createFileRoute, useNavigate } from "@tanstack/react-router";

import { FactChip } from "#/components/lang/chip";
import { Verb } from "#/components/lang/verb";
import { ParadigmA } from "#/family-review/proto-editor/a";
import { ParadigmB } from "#/family-review/proto-editor/b";
import { ParadigmC } from "#/family-review/proto-editor/c";
import { ParadigmD } from "#/family-review/proto-editor/composed";
import { StatePanel, TypeStage, useEditor } from "#/family-review/proto-editor/shell";
import { VariantSwitcher } from "#/param-tables/proto/switcher";

const PARADIGMS = [
  { key: "a", name: "Anchor-first — the relation graph, one node at a time" },
  { key: "b", name: "Drawing-as-form — point at the picture" },
  { key: "c", name: "Sentence builder — typed tokens, scoped pickers" },
  { key: "d", name: "Composed — params grid · triptych+sidebar · aligned sentences · json" },
];

export const Route = createFileRoute("/family-editor-proto")({
  validateSearch: (search: Record<string, unknown>): { paradigm: string } => ({
    paradigm: typeof search.paradigm === "string" ? search.paradigm : "a",
  }),
  component: FamilyEditorProto,
});

function FamilyEditorProto() {
  const { paradigm } = Route.useSearch();
  const navigate = useNavigate();
  const editor = useEditor();

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header
        className="flex flex-wrap items-baseline gap-2 border-b px-3 py-2"
        style={{ borderColor: "var(--r-line)" }}
      >
        <span className="face-mono t-label t-upper text-[var(--r-ink-mute)]">family editor</span>
        <span className="t-value text-[var(--r-ink)]">{editor.model.family.name}</span>
        <TypeStage editor={editor} />
        <FactChip
          tone="caution"
          dashed
          title="The checked-in family-model-showcase fixture, parsed from the same text the roundtrip suite builds against. Edits live in memory for the length of a page view and are written nowhere — a shipping editor states which document it reads from and which it would send to."
        >
          fixture · in memory · writes nowhere
        </FactChip>
        <Verb
          label="reset"
          reason="Throw away every staged edit and re-read the checked-in fixture"
          onClick={editor.reset}
        />
      </header>

      <div className="flex min-h-0 flex-1">
        {/* D docks its own json pane and pending-write panel; a/b/c share the plain one. */}
        {paradigm === "d" ? (
          <ParadigmD editor={editor} />
        ) : (
          <>
            {paradigm === "b" ? (
              <ParadigmB editor={editor} />
            ) : paradigm === "c" ? (
              <ParadigmC editor={editor} />
            ) : (
              <ParadigmA editor={editor} />
            )}
            <StatePanel editor={editor} />
          </>
        )}
      </div>

      <VariantSwitcher
        variants={PARADIGMS}
        current={paradigm}
        onSelect={(key) =>
          void navigate({ to: ".", search: (prev) => ({ ...prev, paradigm: key }), replace: true })
        }
      />
    </div>
  );
}
