import { Popover, PopoverTrigger } from "./popover";
import { PopoverContent } from "./popover-internal";
import {
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject,
} from "react";

import { KeyScope, ScopeKeys, type Chord } from "@pe/kit/keys";

import { useTeach } from "./use-teach";

export const PANE_OBSTACLES =
  "[data-slot='pane-legend'], [data-picture-readout], [data-slot='pane-work'], [data-slot='pane-resize'], [data-slot='pane-resize-grip']";

type Corner = "tl" | "tr" | "bl" | "br";

export interface FloaterSpec {
  key: string;
  kind: "picture" | "legend";
  label: string;
  chord?: Chord;
  says?: string;
  place: Corner;
  size?: { width: number; height: number };
  open: boolean;
  onOpenChange(open: boolean): void;
  render(): ReactNode;
}

const inset = (corner: Corner, gap: string) => ({
  [corner[0] === "t" ? "top" : "bottom"]: gap,
  [corner[1] === "l" ? "left" : "right"]: gap,
});

const opposite = { tl: "br", tr: "bl", bl: "tr", br: "tl" } as const;

function cornerRect(field: DOMRect, own: DOMRect, gutter: number, c: Corner) {
  const x = c[1] === "l" ? field.left + gutter : field.right - gutter - own.width;
  const y = c[0] === "t" ? field.top + gutter : field.bottom - gutter - own.height;
  return new DOMRect(x, y, own.width, own.height);
}

type At = {
  corner: Corner;
  dy: number;
  folded: boolean;
};

const MOVED = "pe:floater-moved";

function useYield(ref: RefObject<HTMLDivElement | null>, place: Corner, slide = 0) {
  const [at, setAt] = useState<At>({ corner: place, dy: 0, folded: false });
  useLayoutEffect(() => {
    const own = ref.current;
    const field = own?.parentElement;
    const settle = (next: At) =>
      setAt((was) => {
        if ((Object.keys(next) as (keyof At)[]).every((k) => was[k] === next[k])) return was;
        requestAnimationFrame(() => field?.dispatchEvent(new Event(MOVED)));
        return next;
      });
    if (!own || !field) return;
    const run = () => {
      const f = field.getBoundingClientRect();
      const o = own.getBoundingClientRect();
      const folded = getComputedStyle(own).getPropertyValue("--floater-folded").trim() === "1";
      const gutter = parseFloat(getComputedStyle(own).getPropertyValue("--gutter")) || 0;
      const furniture = field.closest("[data-slot='pane-split']") ?? field;
      const fixed = [...furniture.querySelectorAll(PANE_OBSTACLES)]
        .filter((el) => !el.closest("[data-slot='floater']"))
        .map((el) => el.getBoundingClientRect());
      const others = [...field.querySelectorAll(":scope > [data-slot='floater']")]
        .filter((el) => el.compareDocumentPosition(own) & Node.DOCUMENT_POSITION_FOLLOWING)
        .map((el) => el.getBoundingClientRect())
        .concat(fixed);
      const corner = folded ? "br" : place;
      const r = cornerRect(f, o, gutter, corner);
      const offsets = others.map((x) =>
        corner[0] === "t" ? x.bottom + gutter - r.top : x.top - gutter - r.bottom,
      );
      const dy = [slide, 0, ...offsets].find((dy) => {
        const b = new DOMRect(r.x, r.y + dy, r.width, r.height);
        return (
          b.left >= f.left &&
          b.top >= f.top &&
          b.right <= f.right &&
          b.bottom <= f.bottom &&
          !others.some(
            (x) => b.left < x.right && x.left < b.right && b.top < x.bottom && x.top < b.bottom,
          )
        );
      });
      // No clear slot: stay at the corner. A field too small for its floaters folds them to
      // chips (the fold rule); a floater never vanishes.
      settle({ corner, dy: dy ?? 0, folded });
    };
    const moved = () => requestAnimationFrame(run);
    field.addEventListener(MOVED, moved);
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(run);
    const obstacles = () => {
      observer?.disconnect();
      observer?.observe(field);
      field
        .querySelectorAll(`${PANE_OBSTACLES}, :scope > [data-slot='floater']`)
        .forEach((el) => observer?.observe(el));
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
  }, [ref, place, slide]);
  return at;
}

const MIN = { width: 64, height: 40 };
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const CURSOR = { tl: "nwse", br: "nwse", tr: "nesw", bl: "nesw" } as const;
function drag(
  event: ReactPointerEvent<HTMLElement>,
  own: HTMLElement,
  move: (dx: number, dy: number, field: DOMRect, rect: DOMRect) => void,
  commit?: () => void,
) {
  if (event.button !== 0) return;
  event.stopPropagation();
  const field = own.parentElement!.getBoundingClientRect();
  const rect = own.getBoundingClientRect();
  const [x, y] = [event.clientX, event.clientY];
  const target = event.currentTarget;
  target.setPointerCapture(event.pointerId);
  const controller = new AbortController();
  const stop = (e: PointerEvent) => {
    e.stopPropagation();
    controller.abort();
    if (e.type === "pointerup") commit?.();
  };
  target.addEventListener(
    "pointermove",
    (e: PointerEvent) => {
      e.stopPropagation();
      move(e.clientX - x, e.clientY - y, field, rect);
    },
    { signal: controller.signal },
  );
  target.addEventListener("pointerup", stop, { signal: controller.signal });
  target.addEventListener("pointercancel", stop, { signal: controller.signal });
  event.preventDefault();
}

type FloaterSurfaceSpec = Omit<FloaterSpec, "onOpenChange"> &
  Partial<Pick<FloaterSpec, "onOpenChange">>;

export function Floater({ spec }: { spec: FloaterSurfaceSpec }) {
  useTeach({
    kind: "views",
    label: spec.label,
    options: [
      { key: spec.key, label: spec.label, says: spec.says, active: spec.open, place: spec.place },
    ],
  });
  const ref = useRef<HTMLDivElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const [slide, setSlide] = useState(0);
  const [box, setBox] = useState(spec.size);
  const storageKey = () =>
    `pe:floater:${location.pathname}:${ref.current?.closest("[data-pane-id]")?.getAttribute("data-pane-id") ?? ""}:${spec.key}`;
  useLayoutEffect(() => {
    try {
      const saved = JSON.parse(window.localStorage.getItem(storageKey()) ?? "null");
      if (saved && [saved.width, saved.height].every((n) => Number.isFinite(n) && n > 0))
        setBox({ width: saved.width, height: saved.height });
    } catch {
      /* Storage is optional; furniture remains usable. */
    }
  }, [spec.key]);
  const at = useYield(ref, spec.place, slide);
  const { folded } = at;
  const sized = box && { ...box, "--floater-content-w": "100%", "--floater-content-h": "100%" };
  const sliding = (e: ReactPointerEvent<HTMLElement>) => {
    drag(e, ref.current!, (_dx, dy, f, r) => {
      const g = parseFloat(getComputedStyle(ref.current!).getPropertyValue("--gutter")) || 0;
      setSlide(at.dy + clamp(dy, f.top + g - r.top, f.bottom - g - r.bottom));
    });
  };
  const resizing = (e: ReactPointerEvent<HTMLElement>) => {
    const [h, v] = [at.corner[1] === "r" ? -1 : 1, at.corner[0] === "t" ? 1 : -1];
    let chosen = box;
    drag(
      e,
      ref.current!,
      (dx, dy, f, r) => {
        const g = parseFloat(getComputedStyle(ref.current!).getPropertyValue("--gutter")) || 0;
        chosen = {
          width: clamp(r.width + h * dx, Math.min(MIN.width, f.width - 2 * g), f.width - 2 * g),
          height: clamp(
            r.height + v * dy,
            Math.min(MIN.height, f.height - 2 * g),
            f.height - 2 * g,
          ),
        };
        setBox(chosen);
      },
      () => {
        try {
          window.localStorage.setItem(storageKey(), JSON.stringify(chosen));
        } catch {
          /* Best effort. */
        }
      },
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
        data-floater-kind={spec.kind}
        data-place={at.corner}
        data-folded={folded ? "" : undefined}
        data-surface="artifact"
        className="absolute z-popup shadow-float p-1"
        style={{
          ...inset(at.corner, "var(--gutter)"),
          ...sized,
          maxWidth: "calc(100% - 2 * var(--gutter))",
          maxHeight: "calc(100% - 2 * var(--gutter))",
          translate: at.dy ? `0 ${at.dy}px` : undefined,
        }}
      >
        {spec.onOpenChange && (
          <ScopeKeys
            keys={[
              {
                hotkey: "Escape",
                label: `close ${spec.label}`,
                says: `Close the ${spec.label} floater and return to the pane.`,
                callback: () => {
                  ref.current
                    ?.closest<HTMLElement>("[data-slot='pane']")
                    ?.focus({ preventScroll: true });
                  spec.onOpenChange?.(false);
                },
              },
            ]}
          />
        )}
        {folded ? (
          <Popover>
            <PopoverTrigger className="dl-button dl-control" aria-label={spec.label}>
              {spec.label}
            </PopoverTrigger>
            <PopoverContent
              ref={popup}
              style={sized}
              aria-label={spec.label}
              data-floater-popup=""
              data-floater-kind={spec.kind}
              collisionBoundary={ref.current?.parentElement ?? undefined}
              collisionAvoidance={{ side: "flip", align: "shift" }}
              initialFocus={(type) => (type === "keyboard" ? popup.current : false)}
            >
              <div data-slot="floater-content">{spec.render()}</div>
            </PopoverContent>
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
        {spec.kind === "picture" && (
          <div
            data-slot="floater-resize"
            aria-label={`resize ${spec.label}`}
            className={`absolute z-10 size-2.5 touch-none border-line-2 ${at.corner[1] === "r" ? "border-l" : "border-r"} ${at.corner[0] === "t" ? "border-b" : "border-t"}`}
            style={{
              ...inset(opposite[at.corner], "0px"),
              cursor: `${CURSOR[at.corner]}-resize`,
            }}
            onPointerDown={resizing}
          />
        )}
      </div>
    </KeyScope>
  );
}
