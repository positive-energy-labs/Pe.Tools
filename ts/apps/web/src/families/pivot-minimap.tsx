import { useEffect, useRef, useState, type RefObject } from "react";

import { filledValue, type PivotRow } from "#/families/pivot-rules";
import type { TypeRow } from "#/families/matrix-columns";
import { Press } from "#/components/lang/press";

/** A fixed, uniformly scaled thumbnail. Scroll updates touch only the viewport DOM box. */
export function PivotMinimap({
  rows,
  types,
  scroller,
  open,
  onOpenChange,
  identityWidth,
  typeWidth,
  rowHeight,
  headerHeight,
}: {
  rows: readonly PivotRow[];
  types: readonly TypeRow[];
  scroller: RefObject<HTMLDivElement | null>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  identityWidth: number;
  typeWidth: number;
  rowHeight: number;
  headerHeight: number;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 200, h: 120, scale: 0.05 });
  useEffect(() => {
    if (!open || typeof ResizeObserver === "undefined") return;
    const el = scroller.current;
    if (!el) return;
    const measure = () => {
      if (el.scrollWidth <= 0 || el.scrollHeight <= 0) return;
      const scale = Math.min(260 / el.scrollWidth, 260 / el.scrollHeight);
      const w = Math.round(el.scrollWidth * scale);
      const h = Math.round(el.scrollHeight * scale);
      setSize((current) =>
        current.w === w && current.h === h && current.scale === scale ? current : { w, h, scale },
      );
    };
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    const content = el.firstElementChild;
    if (content) observer.observe(content);
    return () => observer.disconnect();
  }, [scroller, open]);
  useEffect(() => {
    if (!open) return;
    const el = scroller.current;
    if (!el) return;
    if (el.scrollWidth <= 0 || el.scrollHeight <= 0) return;
    const scale = Math.min(260 / el.scrollWidth, 260 / el.scrollHeight);
    const w = Math.round(el.scrollWidth * scale);
    const h = Math.round(el.scrollHeight * scale);
    if (size.w !== w || size.h !== h || size.scale !== scale) {
      setSize({ w, h, scale });
      return;
    }
    // Draw after React commits canvas width/height; assigning those attributes clears the canvas.
    const paper = canvas.current;
    const context = paper?.getContext("2d");
    if (!context || !paper) return;
    const palette = getComputedStyle(paper);
    context.clearRect(0, 0, w, h);
    context.fillStyle = palette.getPropertyValue("--pe-recess").trim();
    context.fillRect(0, 0, identityWidth * scale, h);
    context.fillRect(0, 0, w, headerHeight * scale);
    rows.forEach((row, y) =>
      types.forEach((type, x) => {
        const scope = type.scopes[row.key];
        if (!scope || scope === "Unresolved") return;
        context.fillStyle = palette
          .getPropertyValue(filledValue(type.values[row.key]) ? "--pe-ink" : "--pe-line-2")
          .trim();
        context.fillRect(
          (identityWidth + x * typeWidth) * scale,
          (headerHeight + y * rowHeight) * scale,
          Math.max(0.2, typeWidth * scale),
          Math.max(0.2, rowHeight * scale),
        );
      }),
    );
  }, [rows, types, scroller, open, identityWidth, typeWidth, rowHeight, headerHeight, size]);
  useEffect(() => {
    if (!open) return;
    const el = scroller.current;
    if (!el) return;
    let frame = 0;
    const drawViewport = () => {
      frame = 0;
      const box = viewport.current;
      if (!box) return;
      box.style.top = `${el.scrollTop * size.scale}px`;
      box.style.left = `${el.scrollLeft * size.scale}px`;
      box.style.height = `${Math.max(4, el.clientHeight * size.scale)}px`;
      box.style.width = `${Math.max(4, el.clientWidth * size.scale)}px`;
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(drawViewport);
    };
    drawViewport();
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [scroller, size, open]);
  if (!open) return null;
  return (
    <div
      className="z-popup border shadow-float"
      data-surface="artifact"
      style={{
        position: "fixed",
        right: 24,
        bottom: 48,
        padding: 4,
        willChange: "transform",
      }}
    >
      <div className="flex items-center justify-between t-small text-ink-2">
        <span>
          {rows.length} × {types.length}
        </span>
        <Press
          type="button"
          size="caption"
          onClick={() => onOpenChange(false)}
          title="hide the minimap"
        >
          ×
        </Press>
      </div>
      <div style={{ position: "relative", width: size.w, height: size.h }}>
        <canvas
          ref={canvas}
          width={size.w}
          height={size.h}
          aria-label="pivot thumbnail; click to scroll"
          data-surface="artifact"
          style={{ display: "block", cursor: "crosshair" }}
          onClick={(event) => {
            const el = scroller.current;
            if (!el) return;
            const box = event.currentTarget.getBoundingClientRect();
            el.scrollTo({
              top: (event.clientY - box.top) / size.scale - el.clientHeight / 2,
              left: (event.clientX - box.left) / size.scale - el.clientWidth / 2,
            });
          }}
        />
        <div
          ref={viewport}
          data-tone="alarm"
          style={{ position: "absolute", pointerEvents: "none", border: "1px solid currentColor" }}
        />
      </div>
    </div>
  );
}
