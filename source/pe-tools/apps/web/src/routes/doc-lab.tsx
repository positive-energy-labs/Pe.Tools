import { createFileRoute } from "@tanstack/react-router";
import { FlaskConical, X } from "lucide-react";

import { Button } from "#/components/ui/button";
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
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-border/60 px-4 py-2.5">
        <div>
          <h1 className="text-base font-semibold tracking-tight text-foreground">Doc Lab</h1>
          <p className="text-xs text-muted-foreground">
            Grounded document viewer — hover markdown or the page to link them
          </p>
        </div>
        <div className="flex items-center gap-2">
          {engine.doc && (
            <>
              <span className="text-xs text-muted-foreground" title={engine.doc.fileName}>
                {engine.doc.fileName} · {engine.doc.pages.length} page
                {engine.doc.pages.length !== 1 ? "s" : ""} · {engine.doc.blocks.length} blocks
                {engine.doc.images.length > 0 ? ` · ${engine.doc.images.length} images` : ""}
              </span>
              <Button variant="ghost" size="xs" onClick={engine.clear} title="Remove document">
                <X className="size-3" />
              </Button>
            </>
          )}
        </div>
      </header>

      <div className="flex shrink-0 items-center gap-3 border-b border-border/40 bg-muted/20 px-4 py-1 text-xs text-muted-foreground">
        {focused ? (
          <span className="truncate">
            <span className="font-medium text-[var(--cat-blue)]">
              {engine.pinned ? "Pinned" : "Focused"}:
            </span>{" "}
            page {focused.page} · {focused.kind} · {focused.id}
            {engine.pinned && (
              <Button variant="ghost" size="xs" className="ml-1" onClick={engine.clearPin}>
                unpin
              </Button>
            )}
          </span>
        ) : (
          <span>Hover a block, image, or page region; click to pin</span>
        )}
      </div>

      <GroundedDocView
        engine={engine}
        className="min-h-0 flex-1"
        emptyExtra={
          <Button variant="outline" size="sm" onClick={() => engine.setDoc(SAMPLE_DOC)}>
            <FlaskConical className="size-3" />
            Load sample document (no API key needed)
          </Button>
        }
      />
    </main>
  );
}
