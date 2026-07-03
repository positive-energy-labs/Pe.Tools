import { FileUp, Link2, Loader2, Pin } from "lucide-react";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { Button } from "#/components/ui/button";
import { Input } from "#/components/ui/input";
import type { GroundedDocEngine } from "#/grounded-doc/engine";
import type { GroundedBlock, ParsedPage } from "#/grounded-doc/types";
import { PROSE_CLASS } from "#/workbench/prose";
import { cn } from "#/lib/utils";

// GFM adds tables/strikethrough/task-lists — equipment schedules are tables.
// Memoized because react-markdown re-parses on every render and the tree is
// re-rendered constantly by hover state changes.
const BlockMarkdown = memo(function BlockMarkdown({ md }: { md: string }) {
  return (
    <div className={cn(PROSE_CLASS, "max-w-none text-[12px] [&_table]:my-1 [&_:first-child]:mt-0")}>
      <Markdown remarkPlugins={[remarkGfm]}>{md}</Markdown>
    </div>
  );
});

const pageKey = (page: number) => `p${page}`;

/**
 * Grounded-document view with up to three scroll-synced lanes: markdown blocks,
 * extracted images (only when the parse returned figures/crops), and the
 * original document pages. Hover an item in any lane and its twin highlights;
 * lanes that didn't originate the hover scroll to the twin, or — when a lane has
 * no exact twin — to the same page, so md / image / original stay aligned.
 *
 * Purely presentational over a GroundedDocEngine — embed it anywhere and drive
 * focus externally via engine.hoverBlock(id, "external").
 */
export function GroundedDocView({
  engine,
  className,
  emptyExtra,
}: {
  engine: GroundedDocEngine;
  className?: string;
  /** Extra content for the empty/upload state (e.g. a "load sample" button). */
  emptyExtra?: React.ReactNode;
}) {
  // Each lane registers its items by id AND a per-page anchor (`p{n}`), so a
  // lane with no exact twin for the focused item can still scroll to its page.
  const mdRefs = useRef(new Map<string, HTMLElement>());
  const imgRefs = useRef(new Map<string, HTMLElement>());
  const pageRefs = useRef(new Map<string, HTMLElement>());

  useEffect(() => {
    const focus = engine.focus;
    if (!focus) return;
    const page = engine.focusedPage;
    const scrollLane = (registry: Map<string, HTMLElement>) => {
      const el =
        registry.get(focus.blockId) ?? (page != null ? registry.get(pageKey(page)) : undefined);
      el?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    };
    if (focus.origin !== "markdown") scrollLane(mdRefs.current);
    if (focus.origin !== "image") scrollLane(imgRefs.current);
    if (focus.origin !== "page") scrollLane(pageRefs.current);
  }, [engine.focus, engine.focusedPage]);

  if (!engine.doc) {
    return (
      <div className={cn("flex items-center justify-center", className)}>
        <UploadSurface engine={engine} extra={emptyExtra} />
      </div>
    );
  }

  const hasImages = engine.doc.images.length > 0;

  return (
    <div className={cn("flex min-h-0", className)}>
      <MarkdownPane engine={engine} refs={mdRefs} />
      {hasImages && <ImagesPane engine={engine} refs={imgRefs} />}
      <PagePane engine={engine} refs={pageRefs} />
    </div>
  );
}

// --- upload ------------------------------------------------------------------

function UploadSurface({ engine, extra }: { engine: GroundedDocEngine; extra?: React.ReactNode }) {
  const [dragOver, setDragOver] = useState(false);
  const [url, setUrl] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const parsing = engine.status.phase === "parsing";

  const handleFiles = useCallback(
    (files: FileList | null) => {
      const file = files?.[0];
      if (file) void engine.load(file);
    },
    [engine],
  );

  const submitUrl = useCallback(() => {
    const trimmed = url.trim();
    if (trimmed) void engine.loadUrl(trimmed);
  }, [engine, url]);

  return (
    <div className="flex w-full max-w-sm flex-col items-center gap-2">
      <button
        type="button"
        disabled={parsing}
        onClick={() => inputRef.current?.click()}
        onDragOver={(event) => {
          event.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragOver(false);
          handleFiles(event.dataTransfer.files);
        }}
        className={cn(
          "flex w-full flex-col items-center gap-3 rounded-xl border-2 border-dashed border-border/70 bg-background/60 px-6 py-12 text-center transition-colors",
          dragOver && "border-primary bg-primary/5",
          parsing && "opacity-70",
        )}
      >
        {parsing ? (
          <>
            <Loader2 className="size-6 animate-spin text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              Parsing {engine.status.phase === "parsing" ? engine.status.fileName : "document"} with
              LlamaCloud…
            </p>
          </>
        ) : (
          <>
            <FileUp className="size-6 text-muted-foreground" />
            <p className="text-sm font-medium text-foreground">Drop a PDF here</p>
            <p className="text-xs text-muted-foreground">
              Blocks keep their page bounding boxes, so markdown and document stay linked.
            </p>
            {engine.status.phase === "error" && (
              <p className="text-xs text-[var(--cat-clay)]">{engine.status.message}</p>
            )}
          </>
        )}
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf"
          className="hidden"
          onChange={(event) => handleFiles(event.target.files)}
        />
      </button>

      {!parsing && (
        <div className="flex w-full items-center gap-1.5">
          <div className="relative flex-1">
            <Link2 className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="url"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") submitUrl();
              }}
              placeholder="…or paste a public PDF URL"
              className="h-8 pl-7 text-xs"
            />
          </div>
          <Button size="sm" variant="outline" onClick={submitUrl} disabled={!url.trim()}>
            Parse
          </Button>
        </div>
      )}
      {!parsing && extra}
    </div>
  );
}

// --- markdown pane -------------------------------------------------------------

function MarkdownPane({
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
      className="min-w-0 flex-1 overflow-y-auto border-r border-border/60"
      onMouseLeave={() => engine.hoverBlock(null, "markdown")}
    >
      <div className="flex flex-col gap-1 p-3">
        {doc.pages.map((page) => (
          <div key={page.page} ref={laneAnchorRef(refs, pageKey(page.page))}>
            <p className="sticky top-0 z-10 -mx-3 mb-1 bg-background/95 px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground backdrop-blur">
              Page {page.page}
            </p>
            <div className="flex flex-col gap-1">
              {engine.blocksForPage(page.page).map((block) => (
                <MarkdownBlock key={block.id} block={block} engine={engine} refs={refs} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Ref callback that registers/unregisters an element under `key` in a lane registry. */
function laneAnchorRef(refs: React.RefObject<Map<string, HTMLElement>>, key: string) {
  return (el: HTMLElement | null) => {
    if (el) refs.current.set(key, el);
    else refs.current.delete(key);
  };
}

// --- images pane ---------------------------------------------------------------

function ImagesPane({
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
      className="min-w-0 flex-1 overflow-y-auto border-r border-border/60 bg-muted/10"
      onMouseLeave={() => engine.hoverBlock(null, "image")}
    >
      <div className="flex flex-col gap-1 p-3">
        {doc.pages.map((page) => {
          const images = engine.imagesForPage(page.page);
          if (images.length === 0) return null;
          return (
            <div key={page.page} ref={laneAnchorRef(refs, pageKey(page.page))}>
              <p className="sticky top-0 z-10 -mx-3 mb-1 bg-background/95 px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground backdrop-blur">
                Page {page.page}
              </p>
              <div className="flex flex-col gap-2">
                {images.map((image) => {
                  const isFocused = engine.focus?.blockId === image.id;
                  const isPinned = engine.pinned?.blockId === image.id;
                  return (
                    <button
                      type="button"
                      key={image.id}
                      ref={laneAnchorRef(refs, image.id)}
                      onMouseEnter={() => engine.hoverBlock(image.id, "image")}
                      onClick={() => engine.pinBlock(image.id, "image")}
                      className={cn(
                        "group flex flex-col overflow-hidden rounded-md border bg-white text-left transition-colors",
                        isFocused
                          ? "border-[var(--cat-lichen)] ring-2 ring-[var(--cat-lichen)]/40"
                          : "border-border/60 hover:border-[var(--cat-lichen)]/50",
                      )}
                    >
                      <img
                        src={image.url}
                        alt={`${image.category} figure on page ${image.page}`}
                        loading="lazy"
                        className="max-h-72 w-full object-contain"
                      />
                      <span className="flex items-center gap-1.5 border-t border-border/50 bg-muted/40 px-1.5 py-0.5">
                        <span className="rounded bg-muted px-1 py-px text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">
                          {image.category}
                        </span>
                        {isPinned && <Pin className="size-3 text-[var(--cat-lichen)]" />}
                      </span>
                    </button>
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

function MarkdownBlock({
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
        "group cursor-pointer rounded-md border border-transparent px-2 py-1.5 transition-colors",
        isFocused
          ? isApprox
            ? "border-[var(--cat-kiln)]/50 bg-[var(--cat-kiln)]/8"
            : "border-[var(--cat-blue)]/50 bg-[var(--cat-blue)]/8"
          : "hover:border-border/60 hover:bg-muted/30",
        !groundable && "opacity-60",
      )}
    >
      <div className="mb-0.5 flex items-center gap-1.5">
        <span className="rounded bg-muted px-1 py-px text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">
          {block.kind}
        </span>
        {!groundable && (
          <span className="text-[9px] text-muted-foreground/70" title="No bounding box from parser">
            no bbox
          </span>
        )}
        {isApprox && (
          <span
            className="rounded bg-[var(--cat-kiln)]/15 px-1 py-px text-[9px] font-semibold text-[var(--cat-kiln)]"
            title="Approximate location — the parser gave this block and a sibling the same region, so the highlight can't be trusted precisely."
          >
            ≈ approx
          </span>
        )}
        {isPinned && <Pin className="size-3 text-[var(--cat-blue)]" />}
      </div>
      <BlockMarkdown md={block.md} />
    </div>
  );
}

// --- page pane -----------------------------------------------------------------

function PagePane({
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
      className="min-w-0 flex-1 overflow-y-auto bg-muted/30"
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

function PageCanvas({
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
      <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        Page {page.page}
      </p>
      <div
        className="relative overflow-hidden rounded border border-border/60 bg-white shadow-sm"
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
            <button
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
                "absolute rounded-sm border transition-colors",
                isApprox && "border-dashed",
                isFocused
                  ? isApprox
                    ? "z-10 border-[var(--cat-kiln)] bg-[var(--cat-kiln)]/12 ring-2 ring-[var(--cat-kiln)]/40"
                    : "z-10 border-[var(--cat-blue)] bg-[var(--cat-blue)]/15 ring-2 ring-[var(--cat-blue)]/40"
                  : page.screenshotUrl
                    ? isApprox
                      ? "border-[var(--cat-kiln)]/40 hover:border-[var(--cat-kiln)]/70 hover:bg-[var(--cat-kiln)]/8"
                      : "border-transparent hover:border-[var(--cat-blue)]/50 hover:bg-[var(--cat-blue)]/8"
                    : // Wireframe mode (no screenshot): keep boxes faintly visible.
                      "border-border/70 bg-muted/20 hover:border-[var(--cat-blue)]/60 hover:bg-[var(--cat-blue)]/10",
              )}
            >
              {!page.screenshotUrl && (
                <span className="absolute left-0.5 top-0.5 text-[8px] font-semibold uppercase text-muted-foreground/70">
                  {block.kind}
                </span>
              )}
            </button>
          ));
        })}
        {/* Extracted-image regions, so hovering an image in the images lane
            highlights where it sits in the original page (and vice versa). */}
        {images.map((image) => {
          const isFocused = engine.focus?.blockId === image.id;
          const isPinned = engine.pinned?.blockId === image.id;
          return (
            <button
              type="button"
              key={image.id}
              ref={laneAnchorRef(refs, image.id)}
              style={toPercent(image.bbox)}
              title={`${image.category} image — click to ${isPinned ? "unpin" : "pin"}`}
              onMouseEnter={() => engine.hoverBlock(image.id, "page")}
              onClick={() => engine.pinBlock(image.id, "page")}
              className={cn(
                "absolute rounded-sm border border-dashed transition-colors",
                isFocused
                  ? "z-10 border-[var(--cat-lichen)] bg-[var(--cat-lichen)]/12 ring-2 ring-[var(--cat-lichen)]/40"
                  : "border-[var(--cat-lichen)]/40 hover:border-[var(--cat-lichen)]/70 hover:bg-[var(--cat-lichen)]/8",
              )}
            />
          );
        })}
      </div>
    </div>
  );
}
