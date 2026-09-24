import { RouteShell, emptyManifest } from "#/route";
import { createFileRoute } from "@tanstack/react-router";
import { FlaskConical, X } from "lucide-react";

import { FactChip } from "#/components/lang/chip";
import { ActionButton } from "#/components/lang/action-button";
import { Pane } from "#/components/lang/pane";
import { Surface } from "#/components/lang/surface";
import { GroundedDocView } from "#/grounded-doc/GroundedDocView";
import { useGroundedDoc } from "#/grounded-doc/engine";
import { SAMPLE_DOC } from "#/grounded-doc/sample";

/**
 * Experimental lab for the grounded-doc engine in isolation: parse a PDF,
 * markdown blocks on the left, document pages on the right, hover either side
 * to highlight (and scroll) the other. The engine + view are standalone —
 * this route is just a harness around them.
 */
/** Not cut over yet: an empty manifest is a legal manifest and the shell renders one. */
const manifest = {
  ...emptyManifest("doc-lab", "Doc Lab"),
  docs: "The grounded-document engine in isolation. Parse a PDF: markdown blocks land on the left, the original pages on the right. Hovering either side highlights (and scrolls) the other; clicking pins the link.",
};

export const Route = createFileRoute("/doc-lab")({
  component: DocLabRoute,
});

function DocLabRoute() {
  const engine = useGroundedDoc({});
  const focusedBlock = engine.blockById(engine.focus?.blockId);
  const focusedImage = engine.imageById(engine.focus?.blockId);
  const focused = focusedBlock
    ? { page: focusedBlock.page, kind: focusedBlock.kind, id: focusedBlock.id }
    : focusedImage
      ? { page: focusedImage.page, kind: `${focusedImage.category} image`, id: focusedImage.id }
      : null;

  return (
    <RouteShell
      manifest={manifest}
      head={
        engine.doc ? (
          <div className="flex flex-wrap items-center gap-2">
            <FactChip title={`the parsed document — ${engine.doc.fileName}`}>
              {engine.doc.fileName}
            </FactChip>
            <FactChip title="pages · markdown blocks · extracted images the parser returned">
              {engine.doc.pages.length}p · {engine.doc.blocks.length} blocks
              {engine.doc.images.length > 0 ? ` · ${engine.doc.images.length} img` : ""}
            </FactChip>
            {engine.doc === SAMPLE_DOC && (
              <FactChip
                dashed
                title="FIXTURE — the checked-in sample parse (src/grounded-doc/sample.ts). What replaces it: parsing a real PDF through LlamaCloud."
              >
                fixture · sample
              </FactChip>
            )}
            <ActionButton
              label="remove"
              icon={X}
              onClick={engine.clear}
              reason="Forget this document and return to the upload surface — the parse cache keeps the result for a re-parse"
            />
          </div>
        ) : undefined
      }
    >
      <Surface>
        <Pane kind="content" title="document" scroll="clip" flush>
          <div className="flex min-h-8 shrink-0 items-center gap-3 px-4 py-1">
            {focused ? (
              <>
                <span>
                  {engine.pinned ? "pinned" : "focused"} · page {focused.page} · {focused.kind} ·{" "}
                  {focused.id}
                </span>
                {engine.pinned && (
                  <ActionButton
                    label="unpin"
                    onClick={engine.clearPin}
                    reason="Release the pin so hover drives the focus again"
                  />
                )}
              </>
            ) : (
              // RULED not-an-empty-state (fit reviews, 2026-08-16): a hover readout at rest is
              // idle chrome, not a missing scope — plain muted text, no story/exit ceremony.
              <span>nothing focused — hover a block, image, or page region; click to pin</span>
            )}
          </div>

          <GroundedDocView
            engine={engine}
            className="min-h-0 flex-1"
            emptyExtra={
              <ActionButton
                label="load the sample document"
                icon={FlaskConical}
                onClick={() => engine.setDoc(SAMPLE_DOC)}
                reason="FIXTURE — load the checked-in sample parse; no API key and no network involved"
              />
            }
          />
        </Pane>
      </Surface>
    </RouteShell>
  );
}
