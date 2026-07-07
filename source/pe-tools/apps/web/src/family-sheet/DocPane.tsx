import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";

import type { SourceRef } from "@pe/agent-contracts";

import type { GroundingView } from "#/family-sheet/store";

const PAGE_GAP = 24;

/** Vertical stack tops for each grounding page, in native page coords. */
function usePageTops(grounding: GroundingView | null) {
  return useMemo(() => {
    const tops = new Map<number, number>();
    let y = 0;
    for (const p of grounding?.pages ?? []) {
      tops.set(p.page, y);
      y += p.height + PAGE_GAP;
    }
    return { tops, totalH: y };
  }, [grounding]);
}

/**
 * The right pane: the parsed spec sheet with a camera that flies to the
 * source geometry of the focused cell's proposal. Pages stacked at native
 * coords, transform on a canvas div, corner reticle sizes divided by scale so
 * they stay constant screen-size.
 *
 * `source` null → no focus: frame the whole first page. `measured` decides
 * solid (measured geometry) vs dashed (estimated column) reticle.
 */
export function DocPane({
  grounding,
  source,
  value,
  measuredHint,
}: {
  grounding: GroundingView | null;
  source: SourceRef | null;
  value?: string | null;
  measuredHint?: string | null;
}) {
  const paneRef = useRef<HTMLDivElement>(null);
  const [pane, setPane] = useState({ vw: 0, vh: 0 });
  const { tops, totalH } = usePageTops(grounding);

  const measure = useCallback(() => {
    const el = paneRef.current;
    if (!el) return;
    setPane((prev) =>
      prev.vw === el.clientWidth && prev.vh === el.clientHeight
        ? prev
        : { vw: el.clientWidth, vh: el.clientHeight },
    );
  }, []);

  // Observe size, and re-measure on window resize as a fallback for headless
  // contexts where ResizeObserver can be quiet.
  useLayoutEffect(() => {
    measure();
    const el = paneRef.current;
    if (!el) return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [measure]);

  // Re-measure right before we need the camera, so a focus that arrives before
  // the observer settles still frames correctly.
  useLayoutEffect(measure, [source, measure]);

  const target = useMemo(
    () => (grounding && source ? grounding.targetFor(source) : null),
    [grounding, source],
  );

  if (!grounding || grounding.pages.length === 0) {
    return (
      <div className="grid h-full place-items-center border-l border-[var(--line)] bg-[color-mix(in_srgb,var(--basalt)_88%,var(--pe-blue))] text-xs text-muted-foreground">
        no spec sheet parsed
      </div>
    );
  }

  // camera: frame the target box (or whole first page when nothing focused).
  // pad generously so the surrounding row context stays visible (frame ≥ 110pt).
  let cam = { tx: 0, ty: 0, scale: 1 };
  if (pane.vw > 0) {
    if (target) {
      const frameH = Math.max(3.6 * target.bbox.h, 110);
      const frame = {
        x: target.bbox.x - 16,
        y: target.bbox.y + target.bbox.h / 2 - frameH / 2,
        w: target.bbox.w + 32,
        h: frameH,
      };
      const pageTop = tops.get(target.page) ?? 0;
      const scale = Math.min(pane.vw / frame.w, pane.vh / frame.h, 2.2);
      cam = {
        scale,
        tx: pane.vw / 2 - (frame.x + frame.w / 2) * scale,
        ty: pane.vh / 2 - (pageTop + frame.y + frame.h / 2) * scale,
      };
    } else {
      // whole first page zoomed to fit
      const first = grounding.pages[0];
      const scale = Math.min(pane.vw / first.width, pane.vh / first.height, 1.2);
      cam = {
        scale,
        tx: pane.vw / 2 - (first.width / 2) * scale,
        ty: 24,
      };
    }
  }

  const measured = target?.measured ?? false;
  const reticle = measured ? "var(--pe-green)" : "var(--cat-blue)";
  const brk = 12 / cam.scale; // corner-bracket arm length, constant screen-size
  const stroke = 1.75 / cam.scale;

  return (
    <div
      ref={paneRef}
      className="relative h-full overflow-hidden border-l border-[var(--line)] bg-[color-mix(in_srgb,var(--basalt)_88%,var(--pe-blue))]"
    >
      <div
        className="absolute left-0 top-0"
        style={{
          height: totalH,
          transform: `translate(${cam.tx}px, ${cam.ty}px) scale(${cam.scale})`,
          transformOrigin: "top left",
          transition: "transform 0.65s cubic-bezier(0.3, 0.7, 0.2, 1)",
        }}
      >
        {grounding.pages.map((p) => (
          <div
            key={p.page}
            className="absolute bg-white shadow-2xl"
            style={{ top: tops.get(p.page), left: 0, width: p.width, height: p.height }}
          >
            <grounding.PageView page={p.page} />
          </div>
        ))}

        {target && (
          <div
            key={`${target.page}:${target.bbox.x}:${target.bbox.y}`}
            className="absolute animate-in fade-in duration-300"
            style={{ left: 0, top: tops.get(target.page) }}
          >
            {/* fill + border box: solid = measured geometry, dashed = estimated */}
            <div
              className="absolute rounded-[2px]"
              style={{
                left: target.bbox.x,
                top: target.bbox.y,
                width: target.bbox.w,
                height: target.bbox.h,
                border: measured ? `${stroke}px solid ${reticle}` : `${stroke}px dashed ${reticle}`,
                background: `color-mix(in srgb, ${reticle} 9%, transparent)`,
              }}
            />
            {/* corner brackets — constant screen-size (arm length ÷ scale) */}
            {corners(target.bbox, brk).map((c, i) => (
              <div
                key={i}
                className="absolute"
                style={{
                  left: c.x,
                  top: c.y,
                  width: brk,
                  height: brk,
                  borderTop: c.top ? `${stroke * 1.2}px solid ${reticle}` : undefined,
                  borderBottom: c.top ? undefined : `${stroke * 1.2}px solid ${reticle}`,
                  borderLeft: c.left ? `${stroke * 1.2}px solid ${reticle}` : undefined,
                  borderRight: c.left ? undefined : `${stroke * 1.2}px solid ${reticle}`,
                }}
              />
            ))}
          </div>
        )}
      </div>

      {/* provenance readout */}
      {target ? (
        <div className="absolute inset-x-4 bottom-4 rounded-lg border border-[var(--line)] bg-card/95 px-3 py-2 shadow-xl backdrop-blur">
          <div className="flex items-center justify-between gap-2">
            <span className="truncate font-mono text-[10px] text-muted-foreground">
              p.{target.page} · {source?.blockId}
            </span>
            <span
              className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium"
              style={
                measured
                  ? { background: "var(--pea-tint)", color: "var(--cat-green)" }
                  : {
                      background: "color-mix(in srgb, var(--cat-blue) 14%, transparent)",
                      color: "var(--cat-blue)",
                    }
              }
            >
              {measured ? "cell measured" : "column estimated"}
            </span>
          </div>
          {value ? (
            <div className="mt-1 truncate text-sm font-semibold tabular-nums text-foreground">
              {value}
            </div>
          ) : null}
          {measuredHint ? (
            <div className="mt-0.5 text-[11px] text-muted-foreground">{measuredHint}</div>
          ) : null}
        </div>
      ) : (
        <div className="absolute inset-x-4 bottom-4 text-center text-[11px] text-white/50">
          hover a proposed cell to ground it here
        </div>
      )}
    </div>
  );
}

/** Four corner-bracket anchor points for a bbox, each an L drawn with 2 borders. */
function corners(b: { x: number; y: number; w: number; h: number }, len: number) {
  return [
    { x: b.x, y: b.y, top: true, left: true }, // top-left
    { x: b.x + b.w - len, y: b.y, top: true, left: false }, // top-right
    { x: b.x, y: b.y + b.h - len, top: false, left: true }, // bottom-left
    { x: b.x + b.w - len, y: b.y + b.h - len, top: false, left: false }, // bottom-right
  ];
}
