import { token } from "#/lib/token";
/**
 * The round-3 composed winner. The family ledger holds the prototype verdict.
 */
import { createFileRoute } from "@tanstack/react-router";

import { FactChip } from "#/components/lang/chip";
import { HelpTip } from "#/components/lang/help";
import { Verb } from "#/components/lang/verb";
import { ParadigmD } from "#/family-review/proto-editor/composed";
import { TypeStage, useEditor } from "#/family-review/proto-editor/shell";

export const Route = createFileRoute("/family-editor-proto")({
  component: FamilyEditorProto,
});

function FamilyEditorProto() {
  const editor = useEditor();

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header
        className="flex flex-wrap items-baseline gap-2 border-b px-3 py-2"
        style={{ borderColor: token("line") }}
      >
        <span className="face-mono t-label t-upper text-ink-mute">family editor</span>
        <span className="t-value text-ink">{editor.model.family.name}</span>
        <TypeStage editor={editor} />
        {/* The chip states the fact; the HelpTip beside it carries the provenance sentence. */}
        <FactChip
          tone="caution"
          dashed
          title="What this editor reads from, and where its edits go — the seam is a fixture, so both answers are stated in full beside it."
        >
          fixture · in memory · writes nowhere
        </FactChip>
        <HelpTip>
          The checked-in family-model-showcase fixture, parsed from the same text the roundtrip
          suite builds against. Edits live in memory for the length of a page view and are written
          nowhere — a shipping editor states which document it reads from and which it would send
          to.
        </HelpTip>
        <Verb
          label="reset"
          reason="Throw away every staged edit and re-read the checked-in fixture"
          onClick={editor.reset}
        />
      </header>

      <ParadigmD editor={editor} />
    </div>
  );
}
