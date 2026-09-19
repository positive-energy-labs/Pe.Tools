import { Pin } from "lucide-react";
import type { GroundedDocEngine } from "#/grounded-doc/engine";
import type { DocImage, GroundedBlock } from "#/grounded-doc/types";
import { cn } from "#/lib/utils";
import { List } from "#/components/lang/list-popup";
import { BlockMarkdown, VEIL_HOVER, anchorRef, pageKey } from "./block-markdown";

/** The figures, one List grouped by page: the thumbnail is each Row's lead (R10). The one focus
 * is the cursor, from whichever pane set it; the pin is the selection, and a pick toggles it. */
export function ImagesPane({
  engine,
  refs,
}: {
  engine: GroundedDocEngine;
  refs: React.RefObject<Map<string, HTMLElement>>;
}) {
  const doc = engine.doc;
  if (!doc) return null;
  const images = doc.pages.flatMap((page) => engine.imagesForPage(page.page));
  // A text block's page scrolls this lane to that page's first figure.
  const firstOnPage = new Set(
    doc.pages.map((page) => engine.imagesForPage(page.page)[0]?.id).filter(Boolean),
  );

  return (
    <div
      className="flex min-w-0 flex-1 flex-col p-3"
      onMouseLeave={() => engine.hoverBlock(null, "image")}
    >
      <List<DocImage>
        aria-label="figures"
        region="figures"
        items={images}
        keyOf={(image) => image.id}
        labelOf={(image) => image.category}
        groupOf={(image) => `Page ${image.page}`}
        select="single"
        selected={engine.pinned ? [engine.pinned.blockId] : []}
        cursor={engine.focus?.blockId ?? null}
        onCursorChange={(id) => engine.hoverBlock(id, "image")}
        onPick={(image) => engine.pinBlock(image.id, "image")}
        empty="no figures"
        row={(image) => {
          const pinned = engine.pinned?.blockId === image.id;
          return {
            lead: (
              <img
                ref={(el) => {
                  anchorRef(refs, image.id)(el);
                  if (firstOnPage.has(image.id)) anchorRef(refs, pageKey(image.page))(el);
                }}
                src={image.url}
                alt={`${image.category} figure on page ${image.page}`}
                loading="lazy"
                className="h-16 w-24 object-contain"
              />
            ),
            label: image.category,
            meta: pinned ? <Pin className="size-3" /> : undefined,
            title: `${image.category} figure — click to ${pinned ? "unpin" : "pin"}`,
          };
        }}
      />
    </div>
  );
}

export function MarkdownBlock({
  block,
  engine,
  refs,
}: {
  block: GroundedBlock;
  engine: GroundedDocEngine;
  refs: React.RefObject<Map<string, HTMLElement>>;
}) {
  const isFocused = engine.focus?.blockId === block.id;
  const isPinned = engine.pinned?.blockId === block.id;
  const groundable = block.bboxes.length > 0;
  const isApprox = engine.ambiguousBlockIds.has(block.id);

  return (
    <div
      ref={(el) => {
        if (el) refs.current.set(block.id, el);
        else refs.current.delete(block.id);
      }}
      onMouseEnter={() => engine.hoverBlock(block.id, "markdown")}
      onClick={() => engine.pinBlock(block.id, "markdown")}
      className={cn(
        "group cursor-pointer px-2 py-1.5",
        isFocused ? "" : VEIL_HOVER,
        !groundable && "",
      )}
    >
      <div className="mb-0.5 flex items-center gap-1.5">
        <span className="">{block.kind}</span>
        {!groundable && (
          <span
            className=""
            title="No bounding box from the parser — this block cannot be located on the page"
          >
            no bbox
          </span>
        )}
        {isApprox && (
          <span
            className=""
            title="Approximate location — the parser gave this block and a sibling the same region, so the highlight can't be trusted precisely."
          >
            ≈ approx
          </span>
        )}
        {isPinned && <Pin className="size-3" />}
      </div>
      <BlockMarkdown md={block.md} />
    </div>
  );
}
