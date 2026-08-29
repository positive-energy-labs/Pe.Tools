import { Pin } from "lucide-react";
import type { GroundedDocEngine } from "#/grounded-doc/engine";
import type { GroundedBlock, ParsedPage } from "#/grounded-doc/types";
import { cn } from "#/lib/utils";
import { Press } from "#/components/lang/press";
import { BlockMarkdown, VEIL_HOVER, laneAnchorRef, pageKey } from "./block-markdown";

export function ImagesPane({
  engine,
  refs,
}: {
  engine: GroundedDocEngine;
  refs: React.RefObject<Map<string, HTMLElement>>;
}) {
  const doc = engine.doc;
  if (!doc) return null;

  return (
    <div
      className="min-w-0 flex-1 overflow-y-auto"
      onMouseLeave={() => engine.hoverBlock(null, "image")}
    >
      <div className="flex flex-col gap-1 p-3">
        {doc.pages.map((page) => {
          const images = engine.imagesForPage(page.page);
          if (images.length === 0) return null;
          return (
            <div key={page.page} ref={laneAnchorRef(refs, pageKey(page.page))}>
              <p className="sticky top-0 z-sticky -mx-3 mb-1 px-3 py-1 backdrop-blur">
                Page {page.page}
              </p>
              <div className="flex flex-col gap-2">
                {images.map((image) => {
                  const isFocused = engine.focus?.blockId === image.id;
                  const isPinned = engine.pinned?.blockId === image.id;
                  return (
                    <Press
                      type="button"
                      key={image.id}
                      ref={laneAnchorRef(refs, image.id)}
                      onMouseEnter={() => engine.hoverBlock(image.id, "image")}
                      onClick={() => engine.pinBlock(image.id, "image")}
                      className={cn(
                        "group flex flex-col overflow-hidden text-left",
                        isFocused ? "" : "",
                        !isFocused && VEIL_HOVER,
                      )}
                    >
                      <img
                        src={image.url}
                        alt={`${image.category} figure on page ${image.page}`}
                        loading="lazy"
                        className="max-h-72 w-full object-contain"
                      />
                      <span className="flex items-center gap-1.5 px-1.5 py-0.5">
                        <span className="">{image.category}</span>
                        {isPinned && <Pin className="size-3" />}
                      </span>
                    </Press>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
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

export function PagePane({
  engine,
  refs,
}: {
  engine: GroundedDocEngine;
  refs: React.RefObject<Map<string, HTMLElement>>;
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
          <PageCanvas key={page.page} page={page} engine={engine} refs={refs} />
        ))}
      </div>
    </div>
  );
}

export function PageCanvas({
  page,
  engine,
  refs,
}: {
  page: ParsedPage;
  engine: GroundedDocEngine;
  refs: React.RefObject<Map<string, HTMLElement>>;
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
    <div ref={laneAnchorRef(refs, pageKey(page.page))}>
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
          const isFocused = engine.focus?.blockId === block.id;
          const isPinned = engine.pinned?.blockId === block.id;
          const isApprox = engine.ambiguousBlockIds.has(block.id);
          return block.bboxes.map((bbox, index) => (
            <Press
              type="button"
              key={`${block.id}-${index}`}
              ref={
                index === 0
                  ? (el) => {
                      if (el) refs.current.set(block.id, el);
                      else refs.current.delete(block.id);
                    }
                  : undefined
              }
              style={toPercent(bbox)}
              title={
                isApprox
                  ? `${block.kind} — approximate region (parser gave a sibling block the same box)`
                  : `${block.kind} — click to ${isPinned ? "unpin" : "pin"}`
              }
              onMouseEnter={() => engine.hoverBlock(block.id, "page")}
              onClick={() => engine.pinBlock(block.id, "page")}
              className={cn(
                "absolute",
                isFocused
                  ? isApprox
                    ? "z-raised"
                    : "z-raised"
                  : page.screenshotUrl
                    ? isApprox
                      ? ""
                      : cn("", VEIL_HOVER)
                    : // Wireframe mode (no screenshot): keep boxes faintly visible.
                      cn("", VEIL_HOVER),
              )}
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
              key={image.id}
              ref={laneAnchorRef(refs, image.id)}
              style={toPercent(image.bbox)}
              title={`${image.category} image — click to ${isPinned ? "unpin" : "pin"}`}
              onMouseEnter={() => engine.hoverBlock(image.id, "page")}
              onClick={() => engine.pinBlock(image.id, "page")}
              className={cn("absolute", isFocused ? "z-raised" : cn("", VEIL_HOVER))}
            />
          );
        })}
      </div>
    </div>
  );
}
