import { FileUp, Link2 } from "lucide-react";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import { EmptyState } from "#/components/lang/empty";
import { OutcomeLine } from "#/components/lang/outcome";
import { ActionButton } from "#/components/lang/action-button";
import { Input } from "#/components/lang/input";
import type { GroundedDocEngine } from "#/grounded-doc/engine";
import { Markdown } from "#/workbench/prose";
import { cn } from "#/lib/utils";
import { Press } from "#/components/lang/press";
import { ImagesPane, MarkdownBlock } from "./images-pane";
import { PagePane } from "./page-pane";
import { PressContent } from "#/components/anatomy/press-content";

export const BlockMarkdown = memo(function BlockMarkdown({ md }: { md: string }) {
  return <Markdown text={md} className="[&_table]:my-1 [&_:first-child]:mt-0" />;
});

export const pageKey = (page: number) => `p${page}`;

export const VEIL_HOVER = "veil";

export function GroundedDocView({
  engine,
  className,
  emptyExtra,
}: {
  engine: GroundedDocEngine;
  className?: string;
  emptyExtra?: React.ReactNode;
}) {
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

export function UploadSurface({
  engine,
  extra,
}: {
  engine: GroundedDocEngine;
  extra?: React.ReactNode;
}) {
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
      <Press
        type="button"
        tone="neutral"
        size="label"
        state={dragOver ? "selected" : "rest"}
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
      >
        <PressContent geometry="block">
          <span className="flex flex-col items-center gap-3 text-center">
            {parsing ? (
              <OutcomeLine
                kind="busy"
                label={`parsing ${engine.status.phase === "parsing" ? engine.status.fileName : "document"}`}
                says="LlamaCloud is reading the document"
              />
            ) : (
              <>
                <FileUp className="size-6" />
                <EmptyState
                  story="scope"
                  exit="drop a PDF here, paste a URL below, or load the sample"
                >
                  no document loaded
                </EmptyState>
                {engine.status.phase === "error" && (
                  <OutcomeLine kind="error" label="parse failed" says={engine.status.message} />
                )}
              </>
            )}
          </span>
          <input
            ref={inputRef}
            type="file"
            accept="application/pdf"
            className="hidden"
            onChange={(event) => handleFiles(event.target.files)}
          />
        </PressContent>
      </Press>

      {!parsing && (
        <div className="flex w-full items-center gap-1.5">
          <div className="relative flex-1">
            <Link2 className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2" />
            <Input
              type="url"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") submitUrl();
              }}
              placeholder="…or paste a public PDF URL"
            />
          </div>
          <ActionButton
            label="parse"
            onClick={submitUrl}
            disabled={!url.trim()}
            reason={
              url.trim()
                ? "Send the URL to LlamaCloud and ground the parse against its pages"
                : "paste a public PDF URL first"
            }
          />
        </div>
      )}
      {!parsing && extra}
    </div>
  );
}

export function MarkdownPane({
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
      onMouseLeave={() => engine.hoverBlock(null, "markdown")}
    >
      <div className="flex flex-col gap-1 p-3">
        {doc.pages.map((page) => (
          <div key={page.page} ref={anchorRef(refs, pageKey(page.page))}>
            <p className="sticky top-0 z-sticky -mx-3 mb-1 px-3 py-1">Page {page.page}</p>
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

export function anchorRef(refs: React.RefObject<Map<string, HTMLElement>>, key: string) {
  return (el: HTMLElement | null) => {
    if (el) refs.current.set(key, el);
    else refs.current.delete(key);
  };
}
