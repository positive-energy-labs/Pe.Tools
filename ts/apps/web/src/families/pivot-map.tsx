import { useCallback, useEffect, useState, type RefObject } from "react";
import { familyCellKey } from "@pe/agent-contracts";

import type { FloaterSpec } from "@pe/kit/lang/floater";
import { canvasColor, PlaneMinimap } from "@pe/kit/lang/minimap";
import type { TypeRow } from "./matrix-columns";
import type { PatchOverlay } from "./patch-overlay";
import { filledValue, type PivotRow } from "./pivot";
import { GRID, identityWidth } from "./pivot-grid";

export function usePivotMap(
  scroller: RefObject<HTMLDivElement | null>,
  rows: readonly PivotRow[],
  types: readonly TypeRow[],
  overlay: PatchOverlay,
): FloaterSpec {
  /** Null follows the field: the map shows only while the grid overflows its pane (N8 for a vast
   * field, L2 for a small one, which it would only cover). A toggle is the person's and wins. */
  const [chosen, onOpenChange] = useState<boolean | null>(null);
  const [field, setField] = useState({
    width: 1,
    height: 1,
    clientWidth: 0,
    clientHeight: 0,
    top: 0,
    left: 0,
  });
  useEffect(() => {
    const el = scroller.current;
    if (chosen === false || !el || typeof ResizeObserver === "undefined") return;
    let frame = 0;
    const measure = () => {
      frame = 0;
      setField({
        width: Math.max(1, el.scrollWidth),
        height: Math.max(1, el.scrollHeight),
        clientWidth: el.clientWidth,
        clientHeight: el.clientHeight,
        top: el.scrollTop,
        left: el.scrollLeft,
      });
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    measure();
    const observer = new ResizeObserver(schedule);
    observer.observe(el);
    if (el.firstElementChild) observer.observe(el.firstElementChild);
    el.addEventListener("scroll", schedule, { passive: true });
    return () => {
      observer.disconnect();
      el.removeEventListener("scroll", schedule);
      cancelAnimationFrame(frame);
    };
  }, [scroller, chosen, rows, types]);
  const open =
    chosen ?? (field.width > field.clientWidth + 1 || field.height > field.clientHeight + 1);
  const paint = useCallback(
    (ctx: CanvasRenderingContext2D, scale: number) => {
      const recess = canvasColor(ctx, "recess");
      const ink = canvasColor(ctx, "ink");
      const blank = canvasColor(ctx, "line-2");
      const proposed = canvasColor(ctx, "pea");
      const edit = canvasColor(ctx, "caution");
      ctx.fillStyle = recess;
      ctx.fillRect(0, 0, identityWidth * scale, field.height * scale);
      ctx.fillRect(0, 0, field.width * scale, GRID.header * scale);
      rows.forEach((row, y) =>
        types.forEach((type, x) => {
          const cell =
            overlay.cells[
              familyCellKey({
                familyName: type.familyName,
                typeName: type.typeName,
                parameter: row.name,
              })
            ];
          const scope = type.scopes[row.key];
          if (!cell && (!scope || scope === "Unresolved")) return;
          ctx.fillStyle = cell
            ? cell.edit
              ? edit
              : proposed
            : filledValue(type.values[row.key])
              ? ink
              : blank;
          const min = cell ? 0.6 : 0.2;
          ctx.fillRect(
            (identityWidth + x * GRID.type) * scale,
            (GRID.header + y * GRID.row) * scale,
            Math.max(min, GRID.type * scale),
            Math.max(min, GRID.row * scale),
          );
        }),
      );
    },
    [rows, types, overlay, field.width, field.height],
  );
  return {
    key: "map",
    kind: "picture" as const,
    label: "map",
    chord: "M",
    place: "br",
    open,
    onOpenChange,
    says: "Show the whole table; click or drag to scroll.",
    render: () => (
      <PlaneMinimap
        viewport={{ kind: "scroll", top: field.top, left: field.left }}
        onViewport={(next) => scroller.current?.scrollTo({ top: next.top, left: next.left })}
        extent={field}
        viewportSize={{ width: field.clientWidth, height: field.clientHeight }}
        paint={paint}
      />
    ),
  };
}
