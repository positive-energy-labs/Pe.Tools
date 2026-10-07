/**
 * The page canvas: the page screenshot with every block's and figure's bbox drawn over it, where
 * it sits on the page. Spatial, not a list (list census tier 2 names it a toggle).
 */
import type { GroundedDocEngine } from "#/grounded-doc/engine";
import type { ParsedPage } from "#/grounded-doc/types";
import { Press } from "#/components/lang/press";
import { anchorRef, pageKey } from "./block-markdown";

export function PagePane({
  engine,
  refs,
  litBlockIds,
}: {
  engine: GroundedDocEngine;
  refs: React.RefObject<Map<string, HTMLElement>>;
  litBlockIds?: ReadonlySet<string>;
}) {
  const doc = engine.doc;
  if (!doc) return null;

  return (
    <div
      className="min-w-0 flex-1 overflow-y-auto"
      onMouseLeave={() => engine.hoverBlock(null, "page")}
    >
      <div className="flex flex-col gap-4 p-3">
        {doc.pages.map((page) => (
          <PageCanvas
            key={page.page}
            page={page}
            engine={engine}
            refs={refs}
            litBlockIds={litBlockIds}
          />
        ))}
      </div>
    </div>
  );
}

function PageCanvas({
  page,
  engine,
  refs,
  litBlockIds,
}: {
  page: ParsedPage;
  engine: GroundedDocEngine;
  refs: React.RefObject<Map<string, HTMLElement>>;
  litBlockIds?: ReadonlySet<string>;
}) {
  const blocks = engine.blocksForPage(page.page);
  const images = engine.imagesForPage(page.page);

  const toPercent = (bbox: { x: number; y: number; w: number; h: number }) => ({
    left: `${(bbox.x / page.width) * 100}%`,
    top: `${(bbox.y / page.height) * 100}%`,
    width: `${(bbox.w / page.width) * 100}%`,
    height: `${(bbox.h / page.height) * 100}%`,
  });

  return (
    <div ref={anchorRef(refs, pageKey(page.page))}>
      <p className="mb-1">Page {page.page}</p>
      <div
        className="relative overflow-hidden"
        style={{ aspectRatio: `${page.width} / ${page.height}` }}
      >
        {page.screenshotUrl && (
          <img
            src={page.screenshotUrl}
            alt={`Page ${page.page}`}
            className="absolute inset-0 h-full w-full object-contain"
          />
        )}
        {blocks.map((block) => {
          const isFocused =
            engine.focus?.blockId === block.id || litBlockIds?.has(block.id) === true;
          const isPinned = engine.pinned?.blockId === block.id;
          const isApprox = engine.ambiguousBlockIds.has(block.id);
          return block.bboxes.map((bbox, index) => (
            <Press
              type="button"
              tone={isApprox ? "quiet" : page.screenshotUrl ? "neutral" : "neutral"}
              state={isFocused ? (isApprox ? "focused" : "focused") : "rest"}
              key={`${block.id}-${index}`}
              data-block-id={block.id}
              data-citation-lit={isFocused ? "true" : undefined}
              ref={
                index === 0
                  ? (el) => {
                      if (el) refs.current.set(block.id, el);
                      else refs.current.delete(block.id);
                    }
                  : undefined
              }
              style={{ ...toPercent(bbox), position: "absolute" }}
              title={
                isApprox
                  ? `${block.kind} — approximate region (parser gave a sibling block the same box)`
                  : `${block.kind} — click to ${isPinned ? "unpin" : "pin"}`
              }
              onMouseEnter={() => engine.hoverBlock(block.id, "page")}
              onClick={() => engine.pinBlock(block.id, "page")}
            >
              {!page.screenshotUrl && (
                <span className="absolute left-0.5 top-0.5">{block.kind}</span>
              )}
            </Press>
          ));
        })}

        {images.map((image) => {
          const isFocused = engine.focus?.blockId === image.id;
          const isPinned = engine.pinned?.blockId === image.id;
          return (
            <Press
              type="button"
              tone="neutral"
              state={isFocused ? "focused" : "rest"}
              key={image.id}
              ref={anchorRef(refs, image.id)}
              style={{ ...toPercent(image.bbox), position: "absolute" }}
              title={`${image.category} image — click to ${isPinned ? "unpin" : "pin"}`}
              onMouseEnter={() => engine.hoverBlock(image.id, "page")}
              onClick={() => engine.pinBlock(image.id, "page")}
            />
          );
        })}
      </div>
    </div>
  );
}
