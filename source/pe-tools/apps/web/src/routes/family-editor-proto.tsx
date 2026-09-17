import { RouteShell, emptyManifest } from "#/route";
import { token } from "#/lib/token";
/**
 * The round-3 composed winner. The family ledger holds the prototype verdict.
 */
import { createFileRoute } from "@tanstack/react-router";

import { FactChip } from "#/components/lang/chip";
import { HelpTip } from "#/components/lang/help";
import { ActionButton } from "#/components/lang/action-button";
import { Pane } from "#/components/lang/pane";
import { Surface, SurfaceCell } from "#/components/lang/surface";
import { ParadigmD } from "#/family-review/proto-editor/composed";
import { TypeBand, useEditor } from "#/family-review/proto-editor/shell";

/** Not cut over yet: an empty manifest is a legal manifest and the shell renders one. */
export const manifest = emptyManifest("family-editor-proto", "Family Editor Proto");

function RouteShelledFamilyEditorProto() {
  return (
    <RouteShell manifest={manifest}>
      <FamilyEditorProto />
    </RouteShell>
  );
}

export const Route = createFileRoute("/family-editor-proto")({
  component: RouteShelledFamilyEditorProto,
});

function FamilyEditorProto() {
  const editor = useEditor();

  return (
    <Surface columns="minmax(0,1fr)">
      <SurfaceCell>
        <Pane kind="content" title="family editor" scroll="clip">
          <header
            className="flex flex-wrap items-baseline gap-2 px-3 py-2"
            style={{ borderColor: token("line") }}
          >
            <span>family editor</span>
            <span>{editor.model.family.name}</span>
            <TypeBand editor={editor} />
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
              suite builds against. Edits live in memory for the length of a page view and are
              written nowhere — a shipping editor states which document it reads from and which it
              would send to.
            </HelpTip>
            <ActionButton
              label="reset"
              reason="Throw away every staged edit and re-read the checked-in fixture"
              onClick={editor.reset}
            />
          </header>

          <ParadigmD editor={editor} />
        </Pane>
      </SurfaceCell>
    </Surface>
  );
}
