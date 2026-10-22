/**
 * A floater is a corner surface over a pane's body (ledger 2026-10-21): the pane's strip toggles it,
 * the pane draws it over the body's corner, and it is a key scope of its own, so a minimap's keys
 * bind only while focus is inside it. Esc inside it closes it and hands focus back to the pane.
 * A floater whose corner would cover the body's `pane-legend` moves to the nearest place that covers
 * neither the legend nor another floater: a corner, else stacked past the floater holding one;
 * none free, it keeps its own.
 */
import { useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";

import { KeyScope, useScopeKeys, type Chord } from "@pe/kit/keys";

type Corner = "tl" | "tr" | "bl" | "br";

export interface FloaterSpec {
  key: string;
  label: string;
  chord?: Chord;
  says?: string;
  place: Corner;
  size?: { width: number; height: number };
  open: boolean;
  onOpenChange(open: boolean): void;
  render(): ReactNode;
}

const PLACE = {
  tl: "top-(--gutter) left-(--gutter)",
  tr: "top-(--gutter) right-(--gutter)",
  bl: "bottom-(--gutter) left-(--gutter)",
  br: "bottom-(--gutter) right-(--gutter)",
} as const;

/** Nearest first: across, then up or down, then the diagonal. */
const flip = (c: Corner, v: boolean, h: boolean) =>
  `${v ? (c[0] === "t" ? "b" : "t") : c[0]}${h ? (c[1] === "l" ? "r" : "l") : c[1]}` as Corner;
const nearest = (c: Corner) => [c, flip(c, false, true), flip(c, true, false), flip(c, true, true)];

const meets = (a: DOMRect, b: DOMRect) =>
  a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

/** Where the floater would sit in a corner of the field, `gutter` in from its edges. */
function cornerRect(field: DOMRect, own: DOMRect, gutter: number, c: Corner) {
  const x = c[1] === "l" ? field.left + gutter : field.right - gutter - own.width;
  const y = c[0] === "t" ? field.top + gutter : field.bottom - gutter - own.height;
  return new DOMRect(x, y, own.width, own.height);
}

interface At {
  corner: Corner;
  /** Px down (+) or up (-) from the corner, past a floater already there. */
  dy: number;
}

function useYield(ref: RefObject<HTMLDivElement | null>, place: Corner) {
  const [at, setAt] = useState<At>({ corner: place, dy: 0 });
  useLayoutEffect(() => {
    const own = ref.current;
    const field = own?.parentElement;
    const legend = field?.querySelector("[data-slot='pane-legend']");
    const settle = (next: At) =>
      setAt((was) => (was.corner === next.corner && was.dy === next.dy ? was : next));
    if (!own || !field || !legend) return settle({ corner: place, dy: 0 });
    const run = () => {
      const f = field.getBoundingClientRect();
      const o = own.getBoundingClientRect();
      const l = legend.getBoundingClientRect();
      const gutter = parseFloat(getComputedStyle(own).getPropertyValue("--gutter")) || 0;
      if (!meets(cornerRect(f, o, gutter, place), l)) return settle({ corner: place, dy: 0 });
      const others = [...field.querySelectorAll(":scope > [data-slot='floater']")]
        .filter((el) => el !== own)
        .map((el) => el.getBoundingClientRect());
      const free = nearest(place)
        .flatMap((corner) => {
          const r = cornerRect(f, o, gutter, corner);
          const past = others.map((x) =>
            corner[0] === "t" ? x.bottom + gutter - r.top : x.top - gutter - r.bottom,
          );
          return [0, ...past].map((dy) => ({
            corner,
            dy,
            r: new DOMRect(r.x, r.y + dy, r.width, r.height),
          }));
        })
        .find(
          ({ r }) =>
            r.top >= f.top &&
            r.bottom <= f.bottom &&
            !meets(r, l) &&
            !others.some((x) => meets(r, x)),
        );
      settle(free ? { corner: free.corner, dy: free.dy } : { corner: place, dy: 0 });
    };
    run();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(run);
    observer.observe(field);
    observer.observe(legend);
    return () => observer.disconnect();
  }, [ref, place]);
  return at;
}

export function Floater({ spec }: { spec: FloaterSpec }) {
  const ref = useRef<HTMLDivElement>(null);
  const at = useYield(ref, spec.place);
  return (
    <KeyScope id={`floater:${spec.key}`} element={ref}>
      <div
        ref={ref}
        role="region"
        aria-label={spec.label}
        tabIndex={-1}
        data-slot="floater"
        data-floater={spec.key}
        data-place={at.corner}
        data-surface="artifact"
        className={`absolute z-popup shadow-float p-1 ${PLACE[at.corner]}`}
        style={{ ...spec.size, translate: at.dy ? `0 ${at.dy}px` : undefined }}
      >
        <FloaterKeys spec={spec} element={ref} />
        {spec.render()}
      </div>
    </KeyScope>
  );
}

function FloaterKeys({
  spec,
  element,
}: {
  spec: FloaterSpec;
  element: RefObject<HTMLDivElement | null>;
}) {
  useScopeKeys([
    {
      hotkey: "Escape",
      label: `close ${spec.label}`,
      says: `Close the ${spec.label} floater and return to the pane.`,
      callback: () => {
        element.current?.closest<HTMLElement>("[data-slot='pane']")?.focus();
        spec.onOpenChange(false);
      },
    },
  ]);
  return null;
}
