/**
 * A floater is a corner surface over a pane's body (ledger 2026-10-21): the pane's strip toggles it,
 * the pane draws it over the body's corner, and it is a key scope of its own, so a minimap's keys
 * bind only while focus is inside it. Esc inside it closes it and hands focus back to the pane.
 * A floater whose corner would cover the body's `pane-legend` or a docked surface (`pane-dock`, the
 * picture's readout) moves to the nearest place that covers none of them nor another floater: a
 * corner, else stacked past the floater or dock holding one; none free, it keeps its own.
 * Floaters yield in DOM order: each avoids the ones before it, and a move is announced so the
 * ones after it look again once it has painted (siblings solving in parallel took one slot). The person slides it along the edge it sits on by its top grip and
 * resizes it from the inner corner within responsive caps (the smallest is our
 * way of hiding it). A floater may overlap the neighbouring panes' edges; that is wanted.
 */
import {
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject,
} from "react";

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

const MOVED = "pe:floater-moved";

function useYield(ref: RefObject<HTMLDivElement | null>, place: Corner) {
  const [at, setAt] = useState<At>({ corner: place, dy: 0 });
  useLayoutEffect(() => {
    const own = ref.current;
    const field = own?.parentElement;
    const legend = field?.querySelector("[data-slot='pane-legend']");
    const settle = (next: At) =>
      setAt((was) => {
        if (was.corner === next.corner && was.dy === next.dy) return was;
        requestAnimationFrame(() => field?.dispatchEvent(new Event(MOVED)));
        return next;
      });
    if (!own || !field || !legend) return settle({ corner: place, dy: 0 });
    const run = () => {
      const f = field.getBoundingClientRect();
      const o = own.getBoundingClientRect();
      const l = legend.getBoundingClientRect();
      const gutter = parseFloat(getComputedStyle(own).getPropertyValue("--gutter")) || 0;
      const docks = [...field.querySelectorAll("[data-slot='pane-dock']")].map((el) =>
        el.getBoundingClientRect(),
      );
      const home = cornerRect(f, o, gutter, place);
      if (!meets(home, l) && !docks.some((d) => meets(home, d)))
        return settle({ corner: place, dy: 0 });
      const others = [...field.querySelectorAll(":scope > [data-slot='floater']")]
        .filter((el) => el.compareDocumentPosition(own) & Node.DOCUMENT_POSITION_FOLLOWING)
        .map((el) => el.getBoundingClientRect())
        .concat(docks);
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
    const moved = () => requestAnimationFrame(run);
    field.addEventListener(MOVED, moved);
    if (typeof ResizeObserver === "undefined") return () => field.removeEventListener(MOVED, moved);
    const observer = new ResizeObserver(run);
    observer.observe(field);
    observer.observe(legend);
    field.querySelectorAll("[data-slot='pane-dock']").forEach((el) => observer.observe(el));
    return () => {
      observer.disconnect();
      field.removeEventListener(MOVED, moved);
    };
  }, [ref, place]);
  return at;
}

const MIN = { width: 64, height: 40 };
/** Responsive caps: a share of the field the floater sits in, never below its default size. */
const CAP = { width: 0.6, height: 0.7 };
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const CURSOR = { tl: "nwse", br: "nwse", tr: "nesw", bl: "nesw" } as const;
const HANDLE = {
  tl: "bottom-0 right-0",
  tr: "bottom-0 left-0",
  bl: "top-0 right-0",
  br: "top-0 left-0",
} as const;

/** Drag from a handle: `move(dx, dy)` against where the press began, with the pane and floater rects then. */
function drag(
  event: ReactPointerEvent<HTMLElement>,
  own: HTMLElement,
  move: (dx: number, dy: number, field: DOMRect, rect: DOMRect) => void,
) {
  if (event.button !== 0) return;
  event.stopPropagation();
  const field = own.parentElement!.getBoundingClientRect();
  const rect = own.getBoundingClientRect();
  const [x, y] = [event.clientX, event.clientY];
  const target = event.currentTarget;
  target.setPointerCapture(event.pointerId);
  const onMove = (e: PointerEvent) => {
    e.stopPropagation();
    move(e.clientX - x, e.clientY - y, field, rect);
  };
  const stop = (e: PointerEvent) => {
    e.stopPropagation();
    target.removeEventListener("pointermove", onMove);
    target.removeEventListener("pointerup", stop);
    target.removeEventListener("pointercancel", stop);
  };
  target.addEventListener("pointermove", onMove);
  target.addEventListener("pointerup", stop);
  target.addEventListener("pointercancel", stop);
  event.preventDefault();
}

export function Floater({ spec }: { spec: FloaterSpec }) {
  const ref = useRef<HTMLDivElement>(null);
  const at = useYield(ref, spec.place);
  const [slide, setSlide] = useState(0);
  const [box, setBox] = useState(spec.size);
  const defaultSize = useRef(spec.size);
  const gutter = () => parseFloat(getComputedStyle(ref.current!).getPropertyValue("--gutter")) || 0;
  const startSlide = useRef(0);
  const sliding = (e: ReactPointerEvent<HTMLElement>) => {
    startSlide.current = slide;
    drag(e, ref.current!, (_dx, dy, f, r) => {
      const g = gutter();
      setSlide(startSlide.current + clamp(dy, f.top + g - r.top, f.bottom - g - r.bottom));
    });
  };
  const resizing = (e: ReactPointerEvent<HTMLElement>) => {
    // Measure at the first resize so content loaded after mount supplies its current size.
    defaultSize.current ??= ref.current!.getBoundingClientRect();
    const initial = defaultSize.current;
    const [h, v] = [at.corner[1] === "r" ? -1 : 1, at.corner[0] === "t" ? 1 : -1];
    drag(e, ref.current!, (dx, dy, f, r) =>
      setBox({
        width: clamp(r.width + h * dx, MIN.width, Math.max(initial.width, f.width * CAP.width)),
        height: clamp(
          r.height + v * dy,
          MIN.height,
          Math.max(initial.height, f.height * CAP.height),
        ),
      }),
    );
  };
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
        style={{
          ...box,
          ["--floater-w" as string]: box && `${box.width}px`,
          ["--floater-h" as string]: box && `${box.height}px`,
          ["--floater-content-w" as string]: box && "100%",
          ["--floater-content-h" as string]: box && "100%",
          translate: at.dy + slide ? `0 ${at.dy + slide}px` : undefined,
        }}
      >
        <FloaterKeys spec={spec} element={ref} />
        {spec.render()}
        <div
          data-slot="floater-grip"
          aria-label={`move ${spec.label}`}
          className="group absolute inset-x-0 -top-1 z-10 h-2.5 cursor-grab touch-none active:cursor-grabbing"
          onPointerDown={sliding}
        >
          <span className="pointer-events-none absolute left-1/2 top-1/2 h-px w-6 -translate-x-1/2 bg-line-2 transition-[width,background-color] duration-control group-hover:w-10 group-hover:bg-ink-2 group-active:bg-ink motion-reduce:transition-none" />
        </div>
        <div
          data-slot="floater-resize"
          aria-label={`resize ${spec.label}`}
          className={`absolute z-10 size-2.5 touch-none ${HANDLE[at.corner]}`}
          style={{ cursor: `${CURSOR[at.corner]}-resize` }}
          onPointerDown={resizing}
        />
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
