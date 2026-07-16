/**
 * /family doc pane — the parsed spec sheet with MULTI-citation grounding.
 *
 * Provenance law (the reason this pane exists at all):
 *   - a citation is drawn ONLY when it resolves to parser geometry — a measured OCR
 *     line box (solid), an interpolated table-cell estimate (dashed), or a parser-
 *     measured image region (solid). Anything else is listed as "unresolved", never
 *     drawn as a guessed box.
 *   - one proposal may carry several citations (a table cell AND a figure); all of
 *     them are drawn at once and the camera frames their union on the densest page.
 *
 * Geometry never enters route state: the durable doc carries markdown blocks and
 * image ids; this pane refetches the full geometry-bearing view from the parse cache.
 */
import { Loader2 } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import type { SettingsProposalSource } from "@pe/agent-contracts";

import { type RealTarget, buildTargets } from "#/lab/estimate";
import type { ParsedDocView } from "#/grounded-doc/types";

const PAGE_GAP = 24;

export interface CitationTarget {
  source: SettingsProposalSource;
  page: number;
  bbox: { x: number; y: number; w: number; h: number };
  /** true = parser-measured geometry (OCR line box or image region); false = estimated. */
  measured: boolean;
  kind: "cell" | "row" | "block" | "image";
}

export interface FamilyGrounding {
  view: ParsedDocView;
  resolve: (source: SettingsProposalSource) => CitationTarget | null;
}

/** Fetch the geometry-bearing parse view for a parseId and index it for citations. */
export function useFamilyGrounding(parseId: string | null | undefined): {
  grounding: FamilyGrounding | null;
} {
  const [view, setView] = useState<ParsedDocView | null>(null);
  useEffect(() => {
    if (!parseId || parseId === view?.jobId) return;
    let cancelled = false;
    void fetch(`/api/pdf-audit/parse/${parseId}`)
      .then(async (response) => (response.ok ? ((await response.json()) as ParsedDocView) : null))
      .then((fetched) => {
        if (fetched && !cancelled) setView(fetched);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [parseId, view?.jobId]);

  const grounding = useMemo<FamilyGrounding | null>(() => {
    if (!view) return null;
    const targets = new Map<string, RealTarget>(buildTargets(view).map((t) => [t.key, t]));
    const blockById = new Map(view.blocks.map((block) => [block.id, block]));
    const imageById = new Map(view.images.map((image) => [image.id, image]));
    return {
      view,
      resolve: (source) => {
        if (source.rowIdx != null && source.colIdx != null) {
          const target =
            targets.get(`${source.blockId}:${source.rowIdx}:${source.colIdx}`) ??
            targets.get(`${source.blockId}:${source.rowIdx}:span`);
          if (target)
            return {
              source,
              page: target.page,
              bbox: target.cellBBox,
              measured: target.measured,
              kind: target.spanning ? "row" : "cell",
            };
        }
        const image = imageById.get(source.blockId);
        if (image)
          return { source, page: image.page, bbox: image.bbox, measured: true, kind: "image" };
        const block = blockById.get(source.blockId);
        if (block?.bboxes.length)
          return {
            source,
            page: block.page,
            bbox: block.bboxes[0],
            measured: false,
            kind: "block",
          };
        return null;
      },
    };
  }, [view]);

  return { grounding };
}

/** Resolve a proposal's citations; unresolved ones are kept, honestly, as nulls. */
export function resolveCitations(
  grounding: FamilyGrounding | null,
  sources: SettingsProposalSource[] | null | undefined,
): { resolved: CitationTarget[]; unresolved: SettingsProposalSource[] } {
  if (!grounding || !sources?.length) return { resolved: [], unresolved: sources ?? [] };
  const resolved: CitationTarget[] = [];
  const unresolved: SettingsProposalSource[] = [];
  for (const source of sources) {
    const target = grounding.resolve(source);
    if (target) resolved.push(target);
    else unresolved.push(source);
  }
  return { resolved, unresolved };
}

export function FamilyDocPane({
  grounding,
  citations,
  unresolved,
  caption,
  onParse,
  parsing,
}: {
  grounding: FamilyGrounding | null;
  citations: CitationTarget[];
  unresolved: SettingsProposalSource[];
  /** One line describing what the citations belong to (field + proposed value). */
  caption?: string | null;
  onParse: (input: { url?: string; file?: File }) => void;
  parsing: boolean;
}) {
  const paneRef = useRef<HTMLDivElement>(null);
  const [pane, setPane] = useState({ vw: 0, vh: 0 });

  const measure = useCallback(() => {
    const el = paneRef.current;
    if (!el) return;
    setPane((prev) =>
      prev.vw === el.clientWidth && prev.vh === el.clientHeight
        ? prev
        : { vw: el.clientWidth, vh: el.clientHeight },
    );
  }, []);
  useLayoutEffect(() => {
    measure();
    const el = paneRef.current;
    if (!el) return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [measure]);

  const tops = useMemo(() => {
    const map = new Map<number, number>();
    let y = 0;
    for (const page of grounding?.view.pages ?? []) {
      map.set(page.page, y);
      y += page.height + PAGE_GAP;
    }
    return map;
  }, [grounding]);

  if (!grounding) return <UploadSurface onParse={onParse} parsing={parsing} />;

  // Camera: frame the union of citations on the page holding the most of them.
  let cam = { tx: 0, ty: 0, scale: 1 };
  if (pane.vw > 0) {
    const byPage = new Map<number, CitationTarget[]>();
    for (const citation of citations)
      byPage.set(citation.page, [...(byPage.get(citation.page) ?? []), citation]);
    const densest = [...byPage.entries()].sort((a, b) => b[1].length - a[1].length)[0];
    if (densest) {
      const [page, group] = densest;
      const x0 = Math.min(...group.map((c) => c.bbox.x)) - 16;
      const y0 = Math.min(...group.map((c) => c.bbox.y)) - 16;
      const x1 = Math.max(...group.map((c) => c.bbox.x + c.bbox.w)) + 16;
      const y1 = Math.max(...group.map((c) => c.bbox.y + c.bbox.h)) + 16;
      const frameH = Math.max(y1 - y0, 110);
      const pageTop = tops.get(page) ?? 0;
      const scale = Math.min(pane.vw / (x1 - x0), pane.vh / frameH, 2.2);
      cam = {
        scale,
        tx: pane.vw / 2 - ((x0 + x1) / 2) * scale,
        ty: pane.vh / 2 - (pageTop + (y0 + y1) / 2) * scale,
      };
    } else {
      const first = grounding.view.pages[0];
      if (first) {
        const scale = Math.min(pane.vw / first.width, pane.vh / first.height, 1.2);
        cam = { scale, tx: pane.vw / 2 - (first.width / 2) * scale, ty: 24 };
      }
    }
  }

  const stroke = 1.75 / cam.scale;

  return (
    <div
      ref={paneRef}
      className="relative h-full overflow-hidden border-l border-[var(--line)] bg-[color-mix(in_srgb,var(--basalt)_88%,var(--pe-blue))]"
    >
      <div
        className="absolute left-0 top-0"
        style={{
          transform: `translate(${cam.tx}px, ${cam.ty}px) scale(${cam.scale})`,
          transformOrigin: "top left",
          transition: "transform 0.65s cubic-bezier(0.3, 0.7, 0.2, 1)",
        }}
      >
        {grounding.view.pages.map((page) => (
          <div
            key={page.page}
            className="absolute bg-white shadow-2xl"
            style={{ top: tops.get(page.page), left: 0, width: page.width, height: page.height }}
          >
            {page.screenshotUrl ? (
              <img
                src={page.screenshotUrl}
                alt={`page ${page.page}`}
                style={{ width: page.width, height: page.height }}
                draggable={false}
              />
            ) : (
              <div
                className="flex items-center justify-center text-xs text-muted-foreground"
                style={{ width: page.width, height: page.height }}
              >
                page {page.page} render unavailable
              </div>
            )}
          </div>
        ))}

        {citations.map((citation, index) => {
          const color = citation.measured ? "var(--pe-green, var(--lichen))" : "var(--pe-blue)";
          return (
            <div
              key={`${citation.source.blockId}:${index}`}
              className="absolute animate-in fade-in duration-300"
              style={{ left: 0, top: tops.get(citation.page) }}
            >
              <div
                className="absolute rounded-[2px]"
                style={{
                  left: citation.bbox.x,
                  top: citation.bbox.y,
                  width: citation.bbox.w,
                  height: citation.bbox.h,
                  border: citation.measured
                    ? `${stroke}px solid ${color}`
                    : `${stroke}px dashed ${color}`,
                  background: `color-mix(in srgb, ${color} 9%, transparent)`,
                }}
              />
              {citations.length > 1 && (
                <div
                  className="absolute grid size-4 place-items-center rounded-full text-[9px] font-semibold text-white"
                  style={{
                    left: citation.bbox.x - 8 / cam.scale,
                    top: citation.bbox.y - 8 / cam.scale,
                    background: color,
                    transform: `scale(${1 / cam.scale})`,
                    transformOrigin: "top left",
                  }}
                >
                  {index + 1}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="absolute inset-x-4 bottom-4 space-y-1">
        {caption ? (
          <div className="rounded-[2px] border border-[var(--line)] bg-card/95 px-3 py-2 shadow-xl backdrop-blur">
            <div className="flex items-center justify-between gap-2">
              <span className="truncate font-mono text-[10px] text-muted-foreground">
                {caption}
              </span>
              <span className="flex shrink-0 gap-1">
                {citations.map((citation, index) => (
                  <span
                    key={index}
                    className="rounded-full px-1.5 py-0.5 text-[9px] font-medium"
                    style={{
                      background: citation.measured
                        ? "color-mix(in srgb, var(--lichen) 16%, transparent)"
                        : "color-mix(in srgb, var(--pe-blue) 14%, transparent)",
                      color: citation.measured ? "var(--lichen)" : "var(--pe-blue)",
                    }}
                  >
                    {citations.length > 1 ? `${index + 1} · ` : ""}
                    {citation.kind === "image"
                      ? "image measured"
                      : citation.measured
                        ? "cell measured"
                        : `${citation.kind} estimated`}
                  </span>
                ))}
                {unresolved.map((source, index) => (
                  <span
                    key={`u${index}`}
                    className="rounded-full px-1.5 py-0.5 text-[9px] font-medium"
                    style={{
                      background: "color-mix(in srgb, var(--kiln) 14%, transparent)",
                      color: "var(--kiln)",
                    }}
                    title={`Citation ${source.blockId} does not resolve to parser geometry — not drawn.`}
                  >
                    unresolved · {source.blockId}
                  </span>
                ))}
              </span>
            </div>
          </div>
        ) : (
          <div className="text-center text-[11px] text-white/50">
            hover a cited cell or constituent to ground it here
          </div>
        )}
      </div>
    </div>
  );
}

function UploadSurface({
  onParse,
  parsing,
}: {
  onParse: (input: { url?: string; file?: File }) => void;
  parsing: boolean;
}) {
  const [url, setUrl] = useState("");
  const [dragging, setDragging] = useState(false);
  return (
    <div
      onDragOver={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        const file = event.dataTransfer.files?.[0];
        if (file) onParse({ file });
      }}
      className={
        "flex h-full flex-col items-center justify-center gap-3 border-l border-[var(--line)] px-8 transition-colors " +
        (dragging
          ? "bg-[color-mix(in_srgb,var(--pe-blue)_20%,var(--basalt))]"
          : "bg-[color-mix(in_srgb,var(--basalt)_88%,var(--pe-blue))]")
      }
    >
      <p className="text-xs text-muted-foreground">
        {parsing
          ? "Parsing spec sheet (takes a minute or two)…"
          : "No spec sheet parsed — drop a PDF here, paste a URL, or ask pea to do it."}
      </p>
      {parsing ? (
        <Loader2 className="size-4 animate-spin text-muted-foreground" />
      ) : (
        <>
          <div className="flex w-full max-w-md items-center gap-2">
            <input
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="https://…/submittal.pdf"
              className="h-8 min-w-0 flex-1 rounded-[2px] border border-[var(--line)] bg-white/70 px-2.5 text-xs outline-none focus:border-[var(--pe-blue)]"
            />
            <button
              type="button"
              disabled={!url.trim()}
              onClick={() => onParse({ url: url.trim() })}
              className="rounded-[2px] border border-[var(--line)] px-2.5 py-1 text-xs hover:border-[var(--pe-blue)] disabled:opacity-40"
            >
              Parse
            </button>
          </div>
          <label className="cursor-pointer text-[11px] text-muted-foreground underline underline-offset-2 hover:text-foreground">
            or upload a PDF
            <input
              type="file"
              accept="application/pdf"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) onParse({ file });
              }}
            />
          </label>
        </>
      )}
    </div>
  );
}
