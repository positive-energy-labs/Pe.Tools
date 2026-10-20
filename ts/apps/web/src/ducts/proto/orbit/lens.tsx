/**
 * THROWAWAY (protoui round 1): what the orbit camera adds to DuctDrawing, in one hook so the
 * drawing's own edits stay a few tagged lines. The lens has two kinds: `spot` keeps a circle around
 * the pointer at full weight and the rest at 20%; `run` keeps the runs through the selection at
 * full weight and the rest at 20% (with nothing selected it is off). Also: the selection pivot,
 * `F` to frame, double-click to select and frame, and the globe in the top-right corner.
 */
import { type ReactNode, useEffect, useId, useMemo, useRef } from "react";

import type { Bounds2, Viewport2 } from "#/lib/affine-frame";
import { Switcher } from "#/components/lang/switcher";
import type { LensMode, Orbit } from "./camera";
import { Globe } from "./globe";

const FADE = 0.2;
const SPOT = 0.35;

/** The spotlight mask: full weight inside a soft circle that follows the pointer, 20% outside. */
function SpotMask({ id, host, size }: { id: string; host: HTMLElement; size: Viewport2 }) {
  const circle = useRef<SVGCircleElement>(null);
  useEffect(() => {
    // Moved by attribute, not state: the drawing never re-renders for the pointer.
    const move = (event: PointerEvent) => {
      const rect = host.getBoundingClientRect();
      circle.current?.setAttribute("cx", String(event.clientX - rect.left));
      circle.current?.setAttribute("cy", String(event.clientY - rect.top));
    };
    host.addEventListener("pointermove", move);
    return () => host.removeEventListener("pointermove", move);
  }, [host]);
  return (
    <defs>
      <radialGradient id={`${id}-soft`}>
        <stop offset="0.8" stopColor="white" />
        <stop offset="1" stopColor="white" stopOpacity={FADE} />
      </radialGradient>
      <mask id={id} maskUnits="userSpaceOnUse" x={0} y={0} width={size.width} height={size.height}>
        <rect width={size.width} height={size.height} fill="white" fillOpacity={FADE} />
        <circle
          ref={circle}
          cx={size.width / 2}
          cy={size.height / 2}
          r={SPOT * Math.min(size.width, size.height)}
          fill={`url(#${id}-soft)`}
        />
      </mask>
    </defs>
  );
}

const LENSES: readonly { value: LensMode; label: string; title: string }[] = [
  { value: "off", label: "off", title: "no lens: everything at full weight" },
  {
    value: "spot",
    label: "spot",
    title: "spotlight: a circle around the pointer at full weight, the rest at 20%",
  },
  {
    value: "run",
    label: "run",
    title: "run: the runs through the selection at full weight, the rest at 20%; off with nothing selected",
  },
];

function OrbitOverlay({ orbit }: { orbit: Orbit }) {
  const stop = (event: { stopPropagation: () => void }) => event.stopPropagation();
  return (
    <div
      data-orbit=""
      className="absolute top-2 right-2 flex flex-col items-end gap-1"
      onPointerDown={stop}
      onClick={stop}
      onDoubleClick={stop}
    >
      <Globe orbit={orbit} />
      <Switcher ariaLabel="lens" value={orbit.lens} onChange={orbit.setLens} options={LENSES} />
    </div>
  );
}

const editable = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));

/** Everything the orbit adds to the drawing; every field is inert when `orbit` is null. */
export function useOrbitDrawing(
  orbit: Orbit | null,
  {
    selected,
    host,
    size,
    fit,
    onSelect,
  }: {
    selected: ReadonlySet<number>;
    host: HTMLElement | null;
    size: Viewport2 | null;
    fit: (box: Bounds2) => void;
    onSelect: (id: number | null) => void;
  },
) {
  const id = `orbit-spot-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const latest = useRef({ orbit, selected });
  latest.current = { orbit, selected };
  const key = [...selected].sort((a, b) => a - b).join(",");
  const on = orbit != null;

  useEffect(() => {
    latest.current.orbit?.follow(latest.current.selected);
  }, [key, on]);

  const fitKey = orbit?.fitTo?.key;
  useEffect(() => {
    const box = latest.current.orbit?.fitTo?.box;
    if (box) fit(box);
    // `fit` closes over the size; a new frame request is the only trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey]);

  useEffect(() => {
    if (!on) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== "f" || event.ctrlKey || event.metaKey || event.altKey) return;
      if (editable(event.target)) return;
      latest.current.orbit?.frame(latest.current.selected);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [on]);

  const lit = useMemo(() => {
    if (orbit?.lens !== "run" || selected.size === 0) return null;
    const ids = new Set(selected);
    for (const path of orbit.runs)
      if (path.some((element) => selected.has(element))) for (const element of path) ids.add(element);
    return ids;
  }, [orbit?.lens, orbit?.runs, selected]);

  const spot = orbit?.lens === "spot" && host && size;
  return {
    /** The opacity of an element under the run lens; undefined at full weight. */
    fade: (element: number | null | undefined) =>
      lit && (element == null || !lit.has(element)) ? FADE : undefined,
    /** Whole-context fade under the run lens. */
    fadeAll: lit ? FADE : undefined,
    /** Wraps the drawing's SVG children in the spotlight mask. */
    wrap: (children: ReactNode) =>
      spot ? (
        <>
          <SpotMask id={id} host={host} size={size} />
          <g mask={`url(#${id})`}>{children}</g>
        </>
      ) : (
        children
      ),
    overlay: orbit ? <OrbitOverlay orbit={orbit} /> : null,
    onDoubleClick: orbit
      ? (event: { target: EventTarget }) => {
          const hit =
            event.target instanceof Element
              ? event.target.closest("[data-segment],[data-node-id],[data-riser]")
              : null;
          const raw =
            hit?.getAttribute("data-segment") ??
            hit?.getAttribute("data-node-id") ??
            hit?.getAttribute("data-riser");
          if (raw == null) return;
          const element = Number(raw);
          onSelect(element);
          orbit.frame(selected.has(element) ? selected : new Set([element]));
        }
      : undefined,
  };
}
