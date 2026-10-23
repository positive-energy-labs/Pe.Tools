import { declutter } from "./declutter";
import { Popover, PopoverTrigger, SubjectPopoverContent } from "./popover";
/**
 * Floaters yield in DOM order and announce each move; parallel siblings otherwise take one slot.
 * They may overlap neighbouring panes, but avoid the field's legends, readouts and earlier floaters.
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

export const PANE_OBSTACLES =
  "[data-slot='pane-legend'], [data-picture-readout], [data-slot='pane-work']";

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

/** Where the floater would sit in a corner of the field, `gutter` in from its edges. */
function cornerRect(field: DOMRect, own: DOMRect, gutter: number, c: Corner) {
  const x = c[1] === "l" ? field.left + gutter : field.right - gutter - own.width;
  const y = c[0] === "t" ? field.top + gutter : field.bottom - gutter - own.height;
  return new DOMRect(x, y, own.width, own.height);
}

type At = { corner: Corner; dy: number; folded: boolean; width?: number; height?: number };

const MOVED = "pe:floater-moved";

function useYield(
  ref: RefObject<HTMLDivElement | null>,
  place: Corner,
  preferred?: FloaterSpec["size"],
) {
  const [at, setAt] = useState<At>({ corner: place, dy: 0, folded: false, ...preferred });
  useLayoutEffect(() => {
    const own = ref.current;
    const field = own?.parentElement;
    const settle = (next: At) =>
      setAt((was) => {
        if (
          was.corner === next.corner &&
          was.dy === next.dy &&
          was.folded === next.folded &&
          was.width === next.width &&
          was.height === next.height
        )
          return was;
        requestAnimationFrame(() => field?.dispatchEvent(new Event(MOVED)));
        return next;
      });
    if (!own || !field) return;
    const run = () => {
      const f = field.getBoundingClientRect();
      const o = own.getBoundingClientRect();
      const folded = getComputedStyle(own).getPropertyValue("--floater-folded").trim() === "1";
      const ratio =
        preferred && f.width > 0 && f.height > 0
          ? Math.min(
              1,
              Math.max(MIN.width, f.width * CAP.width) / preferred.width,
              Math.max(MIN.height, f.height * CAP.height) / preferred.height,
            )
          : 1;
      const shown = preferred && {
        width: preferred.width * ratio,
        height: preferred.height * ratio,
      };
      const gutter = parseFloat(getComputedStyle(own).getPropertyValue("--gutter")) || 0;
      const fixed = [...field.querySelectorAll(PANE_OBSTACLES)]
        .filter((el) => !el.closest("[data-slot='floater']"))
        .map((el) => el.getBoundingClientRect());
      const others = [...field.querySelectorAll(":scope > [data-slot='floater']")]
        .filter((el) => el.compareDocumentPosition(own) & Node.DOCUMENT_POSITION_FOLLOWING)
        .map((el) => el.getBoundingClientRect())
        .concat(fixed);
      const candidates = (folded ? ["br" as const] : nearest(place)).flatMap((corner) => {
        const r = cornerRect(f, o, gutter, corner);
        const past = others.map((x) =>
          corner[0] === "t" ? x.bottom + gutter - r.top : x.top - gutter - r.bottom,
        );
        return [0, ...past].map((dy) => ({
          x: r.x,
          y: r.y + dy,
          width: r.width,
          height: r.height,
          value: { corner, dy, folded, ...shown },
        }));
      });
      const [slot] = declutter(
        [{ ...candidates[0]!, candidates: candidates.slice(1) }],
        { x: f.x, y: f.y, width: f.width, height: f.height },
        others.map((r) => ({ x: r.x, y: r.y, width: r.width, height: r.height })),
      );
      settle(slot?.value ?? { corner: place, dy: 0, folded, ...shown });
    };
    run();
    const moved = () => requestAnimationFrame(run);
    field.addEventListener(MOVED, moved);
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(run);
    observer?.observe(field);
    observer?.observe(own);
    const obstacles = () => {
      field.querySelectorAll(PANE_OBSTACLES).forEach((el) => observer?.observe(el));
      run();
    };
    const children = new MutationObserver(obstacles);
    children.observe(field, { childList: true });
    obstacles();
    return () => {
      children.disconnect();
      observer?.disconnect();
      field.removeEventListener(MOVED, moved);
    };
  }, [ref, place, preferred?.width, preferred?.height]);
  return at;
}

const MIN = { width: 64, height: 40 };
/** Responsive caps: a share of the field, including when its pane shrinks after a resize. */
const CAP = { width: 0.4, height: 0.7 };
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

type FloaterSurfaceSpec = Omit<FloaterSpec, "onOpenChange"> &
  Partial<Pick<FloaterSpec, "onOpenChange">>;

export function Floater({ spec }: { spec: FloaterSurfaceSpec }) {
  const ref = useRef<HTMLDivElement>(null);
  const [slide, setSlide] = useState(0);
  const [box, setBox] = useState(spec.size);
  const at = useYield(ref, spec.place, box);
  const { folded, width, height } = at;
  const shown = box && { width, height };
  useLayoutEffect(() => {
    ref.current?.parentElement?.dispatchEvent(new Event(MOVED));
  }, [slide]);
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
    const [h, v] = [at.corner[1] === "r" ? -1 : 1, at.corner[0] === "t" ? 1 : -1];
    drag(e, ref.current!, (dx, dy, f, r) =>
      setBox({
        width: clamp(r.width + h * dx, MIN.width, Math.max(MIN.width, f.width * CAP.width)),
        height: clamp(r.height + v * dy, MIN.height, Math.max(MIN.height, f.height * CAP.height)),
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
        onPointerDownCapture={(event) => {
          const control = (event.target as HTMLElement).closest(
            "a,button,input,select,textarea,[contenteditable='true'],[tabindex]",
          );
          if (!control || control === event.currentTarget)
            event.currentTarget.focus({ preventScroll: true });
        }}
        data-slot="floater"
        data-floater={spec.key}
        data-place={at.corner}
        data-folded={folded ? "" : undefined}
        data-surface="artifact"
        className={`absolute z-popup shadow-float p-1 ${PLACE[at.corner]}`}
        style={{
          ...shown,
          maxWidth: `max(${MIN.width}px, ${CAP.width * 100}%)`,
          maxHeight: `max(${MIN.height}px, ${CAP.height * 100}%)`,
          ["--floater-w" as string]: shown && `${shown.width}px`,
          ["--floater-h" as string]: shown && `${shown.height}px`,
          ["--floater-content-w" as string]: shown && "100%",
          ["--floater-content-h" as string]: shown && "100%",
          translate: at.dy + slide ? `0 ${at.dy + slide}px` : undefined,
        }}
      >
        {spec.onOpenChange ? <FloaterKeys spec={spec} element={ref} /> : null}
        {folded ? (
          <Popover>
            <PopoverTrigger className="dl-button dl-control" aria-label={spec.label}>
              {spec.label}
            </PopoverTrigger>
            <SubjectPopoverContent
              aria-label={spec.label}
              style={
                box
                  ? {
                      ["--floater-w" as string]: `${box.width}px`,
                      ["--floater-h" as string]: `${box.height}px`,
                    }
                  : undefined
              }
            >
              <div data-slot="floater-content">{spec.render()}</div>
            </SubjectPopoverContent>
          </Popover>
        ) : (
          <div data-slot="floater-content">{spec.render()}</div>
        )}
        <div
          data-slot="floater-grip"
          aria-label={`move ${spec.label}`}
          className="group absolute inset-x-0 -top-1 z-10 h-2.5 cursor-grab touch-none active:cursor-grabbing"
          onPointerDown={sliding}
        >
          <span className="pointer-events-none absolute left-1/2 top-1/2 h-px w-6 -translate-x-1/2 bg-line-2 transition-colors duration-control group-hover:bg-ink-2 group-active:bg-ink motion-reduce:transition-none" />
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
  spec: FloaterSurfaceSpec;
  element: RefObject<HTMLDivElement | null>;
}) {
  useScopeKeys([
    {
      hotkey: "Escape",
      label: `close ${spec.label}`,
      says: `Close the ${spec.label} floater and return to the pane.`,
      callback: () => {
        element.current?.closest<HTMLElement>("[data-slot='pane']")?.focus({ preventScroll: true });
        spec.onOpenChange?.(false);
      },
    },
  ]);
  return null;
}
