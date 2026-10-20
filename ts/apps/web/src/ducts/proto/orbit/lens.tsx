/**
 * THROWAWAY (protoui round 2): what the orbit camera adds to DuctDrawing, in one hook so the
 * drawing's own edits stay a few tagged lines. The lens is one toggle, `run`, default off: with it
 * on, the runs through the selection stay at full weight and the rest drop to 20%; a hover from
 * outside the drawing (a run, a leg, an inbox row: `useHoverSet`) wins while it lasts. A selection
 * on no run (or none) falls back to the group's critical run, and with none of those the lens draws
 * nothing (counsel's choice, re-openable). Also: the selection pivot, `F` to frame, Esc to clear,
 * double-click to select and frame, and the globe in the top-right corner.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { Bounds2 } from "#/lib/affine-frame";
import { Button } from "@pe/kit/lang/button";
import type { Orbit } from "./camera";
import { Globe } from "./globe";

const FADE = 0.2;

/** A hover from outside the drawing: one element id, a set of them, or nothing. */
export type HoverTarget = number | Iterable<number> | null;

const EMPTY: ReadonlySet<number> = new Set();
const setOf = (target: HoverTarget): ReadonlySet<number> =>
  target == null ? EMPTY : typeof target === "number" ? new Set([target]) : new Set(target);

/**
 * proto: orbit — the hover a sidebar lights. Hold it beside the drawing: pass `hovered` to
 * `DuctsSpatial`/`Spatial` and call `hover(ids)` from a row's onMouseEnter (`hover(null)` on
 * leave). `hover(id)` keeps the single-id form; `hover([...run.path])` lights a whole run.
 * Under the run lens the drawing dims everything outside `hovered` while it is non-empty.
 */
export function useHoverSet(): {
  hovered: ReadonlySet<number>;
  hover: (target: HoverTarget) => void;
} {
  const [hovered, setHovered] = useState<ReadonlySet<number>>(EMPTY);
  const hover = useCallback((target: HoverTarget) => setHovered(setOf(target)), []);
  return { hovered, hover };
}

function OrbitOverlay({ orbit }: { orbit: Orbit }) {
  const stop = (event: { stopPropagation: () => void }) => event.stopPropagation();
  const on = orbit.lens === "run";
  return (
    <div
      data-orbit=""
      className="absolute top-2 right-2 flex select-none flex-col items-end gap-1"
      onPointerDown={stop}
      onClick={stop}
      onDoubleClick={stop}
    >
      <Globe orbit={orbit} />
      <Button
        type="button"
        kind="framed"
        pressed={on}
        label="run lens: the runs through the selection (or the hovered set) at full weight, the rest at 20%"
        onClick={() => orbit.setLens(on ? "off" : "run")}
      >
        run lens {on ? "on" : "off"}
      </Button>
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
    lit: hoveredSet,
    critical,
    fit,
    onSelect,
  }: {
    selected: ReadonlySet<number>;
    /** The hover set from outside the drawing; it wins over the selection's runs while non-empty. */
    lit: ReadonlySet<number> | undefined;
    /** The group's critical run, the lens's fallback when the selection touches no run. */
    critical: ReadonlySet<number> | undefined;
    fit: (box: Bounds2) => void;
    onSelect: (id: number | null) => void;
  },
) {
  const latest = useRef({ orbit, selected, onSelect });
  latest.current = { orbit, selected, onSelect };
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
      if (event.ctrlKey || event.metaKey || event.altKey || editable(event.target)) return;
      // Esc clears the selection unless something nearer (a popover, a menu) consumed it first.
      if (event.key === "Escape" && !event.defaultPrevented && latest.current.selected.size)
        latest.current.onSelect(null);
      if (event.key.toLowerCase() === "f") latest.current.orbit?.frame(latest.current.selected);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [on]);

  const lit = useMemo(() => {
    if (orbit?.lens !== "run") return null;
    if (hoveredSet?.size) return hoveredSet;
    const ids = new Set<number>();
    for (const path of orbit.runs)
      if (path.some((element) => selected.has(element))) for (const element of path) ids.add(element);
    if (ids.size) return new Set([...selected, ...ids]);
    return critical?.size ? critical : null;
  }, [orbit?.lens, orbit?.runs, selected, hoveredSet, critical]);

  return {
    /** The opacity of an element under the run lens; undefined at full weight. */
    fade: (element: number | null | undefined) =>
      lit && (element == null || !lit.has(element)) ? FADE : undefined,
    /** Whole-context fade under the run lens. */
    fadeAll: lit ? FADE : undefined,
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
