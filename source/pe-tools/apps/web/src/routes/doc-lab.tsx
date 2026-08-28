import { createFileRoute } from "@tanstack/react-router";
import { FlaskConical, X } from "lucide-react";

import { FactChip } from "#/components/lang/chip";
import { HelpTip } from "#/components/lang/help";
import { Verb } from "#/components/lang/verb";
import { GroundedDocView } from "#/grounded-doc/GroundedDocView";
import { useGroundedDoc } from "#/grounded-doc/engine";
import { SAMPLE_DOC } from "#/grounded-doc/sample";

/**
 * Experimental lab for the grounded-doc engine in isolation: parse a PDF,
 * markdown blocks on the left, document pages on the right, hover either side
 * to highlight (and scroll) the other. The engine + view are standalone —
 * this route is just a harness around them.
 */
export const Route = createFileRoute("/doc-lab")({ component: DocLabRoute });

function DocLabRoute() {
  const engine = useGroundedDoc();
  const focusedBlock = engine.blockById(engine.focus?.blockId);
  const focusedImage = engine.imageById(engine.focus?.blockId);
  const focused = focusedBlock
    ? { page: focusedBlock.page, kind: focusedBlock.kind, id: focusedBlock.id }
    : focusedImage
      ? { page: focusedImage.page, kind: `${focusedImage.category} image`, id: focusedImage.id }
      : null;

  return (
    <main className="flex h-screen flex-col overflow-hidden">
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-2.5">
        <div className="flex items-center gap-2">
          <h1 className="t-title face-display tracking-tight text-ink">Doc Lab</h1>
          <HelpTip>
            The grounded-document engine in isolation. Parse a PDF: markdown blocks land on the
            left, the original pages on the right. Hovering either side highlights (and scrolls) the
            other; clicking pins the link.
          </HelpTip>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {engine.doc && (
            <>
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
              <Verb
                label="remove"
                icon={X}
                onClick={engine.clear}
                reason="Forget this document and return to the upload surface — the parse cache keeps the result for a re-parse"
              />
            </>
          )}
        </div>
      </header>

      <div className="flex min-h-8 shrink-0 items-center gap-3 border-b border-line px-4 py-1">
        {focused ? (
          <>
            <span className="t-label face-mono truncate text-ink-2">
              {engine.pinned ? "pinned" : "focused"} · page {focused.page} · {focused.kind} ·{" "}
              {focused.id}
            </span>
            {engine.pinned && (
              <Verb
                label="unpin"
                onClick={engine.clearPin}
                reason="Release the pin so hover drives the focus again"
              />
            )}
          </>
        ) : (
          // RULED not-an-empty-state (fit reviews, 2026-08-16): a hover readout at rest is
          // idle chrome, not a missing scope — plain muted text, no story/exit ceremony.
          <span className="t-label text-ink-mute">
            nothing focused — hover a block, image, or page region; click to pin
          </span>
        )}
      </div>

      <GroundedDocView
        engine={engine}
        className="min-h-0 flex-1"
        emptyExtra={
          <Verb
            label="load the sample document"
            icon={FlaskConical}
            onClick={() => engine.setDoc(SAMPLE_DOC)}
            reason="FIXTURE — load the checked-in sample parse; no API key and no network involved"
          />
        }
      />
    </main>
  );
}
