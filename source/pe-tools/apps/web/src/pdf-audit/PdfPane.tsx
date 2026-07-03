import { FileUp, Loader2, Pin, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "#/components/ui/button";
import type { GroundedBlock, ParsedPage } from "#/pdf-audit/types";
import { usePdfAudit } from "#/pdf-audit/store";
import { cn } from "#/lib/utils";

/**
 * Right-hand grounding surface: the parsed PDF as page screenshots with block
 * bounding boxes. Hovering a mapped table cell highlights its source block
 * here and shows the block's markdown in the docked identity card — the
 * "where did this number come from" answer without leaving the table.
 */
export function PdfPane() {
  const { doc, parseStatus, focusedBlockId, pinnedBlockId, pinBlock, blockById, clearDoc } =
    usePdfAudit();
  const focusedBlock = blockById(focusedBlockId);

  if (!doc) {
    return <UploadSurface parsing={parseStatus.phase === "parsing"} error={parseStatus} />;
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center justify-between border-b border-border/60 px-3 py-1.5">
        <p className="truncate text-xs font-medium text-foreground" title={doc.fileName}>
          {doc.fileName}
          <span className="ml-2 text-muted-foreground">
            {doc.pages.length} page{doc.pages.length !== 1 ? "s" : ""} · {doc.blocks.length} blocks
          </span>
        </p>
        <Button variant="ghost" size="xs" onClick={clearDoc} title="Remove document">
          <X className="size-3" />
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto bg-muted/30 p-3">
        <div className="flex flex-col gap-3">
          {doc.pages.map((page) => (
            <PageView
              key={page.page}
              page={page}
              blocks={doc.blocks.filter((block) => block.page === page.page)}
              focusedBlockId={focusedBlockId}
              pinnedBlockId={pinnedBlockId}
              onPinBlock={pinBlock}
            />
          ))}
        </div>
      </div>

      {focusedBlock && (
        <IdentityCard
          block={focusedBlock}
          pinned={pinnedBlockId === focusedBlock.id}
          onUnpin={() => pinBlock(null)}
        />
      )}
    </div>
  );
}

function UploadSurface({
  parsing,
  error,
}: {
  parsing: boolean;
  error: { phase: string; message?: string };
}) {
  const { uploadPdf, parseStatus } = usePdfAudit();
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFiles = useCallback(
    (files: FileList | null) => {
      const file = files?.[0];
      if (file) void uploadPdf(file);
    },
    [uploadPdf],
  );

  return (
    <div className="flex h-full items-center justify-center p-6">
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
          "flex w-full max-w-sm flex-col items-center gap-3 rounded-xl border-2 border-dashed border-border/70 bg-background/60 px-6 py-12 text-center transition-colors",
          dragOver && "border-primary bg-primary/5",
          parsing && "opacity-70",
        )}
      >
        {parsing ? (
          <>
            <Loader2 className="size-6 animate-spin text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              Parsing {parseStatus.phase === "parsing" ? parseStatus.fileName : "document"} with
              LlamaCloud…
            </p>
            <p className="text-xs text-muted-foreground/70">
              This can take a minute for large documents
            </p>
          </>
        ) : (
          <>
            <FileUp className="size-6 text-muted-foreground" />
            <p className="text-sm font-medium text-foreground">Drop a PDF here</p>
            <p className="text-xs text-muted-foreground">
              A schedule, submittal, or manufacturer datasheet. Parsed blocks keep their page
              bounding boxes so every mapped value stays traceable.
            </p>
            {error.phase === "error" && (
              <p className="text-xs text-[var(--cat-clay)]">{error.message}</p>
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
    </div>
  );
}

function PageView({
  page,
  blocks,
  focusedBlockId,
  pinnedBlockId,
  onPinBlock,
}: {
  page: ParsedPage;
  blocks: GroundedBlock[];
  focusedBlockId: string | null;
  pinnedBlockId: string | null;
  onPinBlock: (blockId: string | null) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const hasFocus = blocks.some((block) => block.id === focusedBlockId);

  useEffect(() => {
    if (hasFocus) {
      containerRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [hasFocus, focusedBlockId]);

  const toPercent = (bbox: { x: number; y: number; w: number; h: number }) => ({
    left: `${(bbox.x / page.width) * 100}%`,
    top: `${(bbox.y / page.height) * 100}%`,
    width: `${(bbox.w / page.width) * 100}%`,
    height: `${(bbox.h / page.height) * 100}%`,
  });

  return (
    <div ref={containerRef} className="relative">
      <p className="mb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        Page {page.page}
      </p>
      {page.screenshotUrl ? (
        <div
          className="relative overflow-hidden rounded border border-border/60 bg-white shadow-sm"
          style={{ aspectRatio: `${page.width} / ${page.height}` }}
        >
          <img
            src={page.screenshotUrl}
            alt={`Page ${page.page}`}
            className="absolute inset-0 h-full w-full object-contain"
          />
          {blocks.map((block) =>
            block.bboxes.map((bbox, index) => {
              const isFocused = block.id === focusedBlockId;
              const isPinned = block.id === pinnedBlockId;
              return (
                <button
                  type="button"
                  key={`${block.id}-${index}`}
                  style={toPercent(bbox)}
                  title={block.kind}
                  onClick={() => onPinBlock(isPinned ? null : block.id)}
                  className={cn(
                    "absolute rounded-sm border transition-colors",
                    isFocused
                      ? "z-10 border-[var(--cat-blue)] bg-[var(--cat-blue)]/15 ring-2 ring-[var(--cat-blue)]/40"
                      : "border-transparent hover:border-[var(--cat-blue)]/50 hover:bg-[var(--cat-blue)]/8",
                  )}
                />
              );
            }),
          )}
        </div>
      ) : (
        <div className="max-h-96 overflow-y-auto rounded border border-border/60 bg-background p-3">
          {/* No screenshot from the parser — fall back to raw page markdown. */}
          <pre className="whitespace-pre-wrap font-mono text-[11px] text-muted-foreground">
            {page.markdown || "(empty page)"}
          </pre>
        </div>
      )}
    </div>
  );
}

function IdentityCard({
  block,
  pinned,
  onUnpin,
}: {
  block: GroundedBlock;
  pinned: boolean;
  onUnpin: () => void;
}) {
  return (
    <div className="shrink-0 border-t border-[var(--cat-blue)]/30 bg-[var(--cat-blue)]/5 px-3 py-2">
      <div className="mb-1 flex items-center justify-between">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--cat-blue)]">
          Source · page {block.page} · {block.kind}
        </p>
        {pinned && (
          <Button variant="ghost" size="xs" onClick={onUnpin} title="Unpin source">
            <Pin className="size-3" />
          </Button>
        )}
      </div>
      <pre className="max-h-40 overflow-y-auto whitespace-pre-wrap font-mono text-[11px] leading-snug text-foreground">
        {block.md}
      </pre>
    </div>
  );
}
