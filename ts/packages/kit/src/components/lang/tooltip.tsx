import { HOVER_GRACE, useHoverGrace } from "./hover-grace";
import { reachProps } from "./reach";
import {
  createContext,
  isValidElement,
  useContext,
  useCallback,
  useEffect,
  useId,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react";
import { Tooltip as Primitive } from "@base-ui/react/tooltip";
import { cn } from "../../lib/utils";
import { floatingSurface, useSubjectPosition, type FloatingPosition } from "./popover-internal";

const Description = createContext<{ id: string; open: boolean; anchor: Element | null } | null>(
  null,
);

// After a press, a hint waits for the pointer to move: content that lands under a still pointer
// (a list that shrank after a pick) never pops its hint unasked. A layout-only mousemove carries
// no movement, so it does not count.
let still = false;
if (typeof window !== "undefined") {
  window.addEventListener("pointerdown", () => (still = true), true);
  window.addEventListener(
    "pointermove",
    (event) => {
      if (event.movementX || event.movementY) still = false;
    },
    true,
  );
}

/** A short hint composed onto its existing element, without adding layout or a native title. */
export function TooltipHint(props: {
  content?: ReactNode;
  children: ReactNode;
  side?: ComponentProps<typeof TooltipContent>["side"];
  /** Keep the tooltip mounted (closed) while `content` is empty, so content that arrives on
   *  pointer entry (a row's measured cut) opens it instead of remounting the element. */
  keep?: boolean;
}) {
  const { content, children, side, keep = false } = props;
  if (!("content" in props))
    return (
      <Tooltip>
        <TooltipTrigger
          type="button"
          {...reachProps()}
          aria-label="What is this?"
          className="veil grid size-5 cursor-help place-items-center rounded-control t-small face-mono text-ink-2"
        >
          ?
        </TooltipTrigger>
        <TooltipContent side={side ?? "bottom"} align="start">
          {children}
        </TooltipContent>
      </Tooltip>
    );
  if (!isValidElement<{ id?: string; tabIndex?: number }>(children)) return null;
  const empty = content == null || content === "" || content === false;
  if (empty && !keep) return children;
  return (
    <Tooltip open={empty ? false : undefined}>
      <TooltipTrigger
        render={children}
        className=""
        id={children.props.id}
        tabIndex={children.props.tabIndex}
        // A hint is always readable, not only on hover: what `title` gave assistive tech, and the
        // hook a test locates a row by.
        aria-description={typeof content === "string" ? content : undefined}
      />
      {empty ? null : <TooltipContent side={side}>{content}</TooltipContent>}
    </Tooltip>
  );
}

export function Tooltip({
  open: controlled,
  defaultOpen = false,
  onOpenChange,
  ...props
}: Primitive.Root.Props) {
  const parent = useContext(Description);
  const id = useId();
  const [anchor, setAnchor] = useState<Element | null>(null);
  const [uncontrolled, setOpen] = useState(defaultOpen);
  const open = controlled ?? uncontrolled;
  const root = (
    <Description.Provider value={{ id, open, anchor }}>
      <Primitive.Root
        {...props}
        open={open}
        onOpenChange={(next, event) => {
          if (next && still && event.reason === "trigger-hover") event.cancel();
          onOpenChange?.(next, event);
          if (!event.isCanceled) {
            setAnchor(event.trigger ?? null);
            setOpen(next);
          }
        }}
      />
    </Description.Provider>
  );
  // A hint nested in open evidence (a footnote, a menu item over a hinted row) keeps its own
  // warm-up group: the shared group would dismiss the evidence the moment the hint opens.
  return parent ? <Primitive.Provider delay={0}>{root}</Primitive.Provider> : root;
}

export function TooltipTrigger(props: Primitive.Trigger.Props) {
  const description = useContext(Description);
  return (
    <Primitive.Trigger
      className="dl-button"
      {...props}
      closeDelay={HOVER_GRACE}
      aria-describedby={
        [props["aria-describedby"], description?.open ? description.id : undefined]
          .filter(Boolean)
          .join(" ") || undefined
      }
    />
  );
}

/** Mount once around the app. Adjacent hints share the warm-up window. */
export function TooltipProvider({ delay = 350, ...props }: Primitive.Provider.Props) {
  return <Primitive.Provider delay={delay} {...props} />;
}

export function TooltipContent({
  side = "top",
  align = "center",
  sideOffset = 6,
  alignOffset = 0,
  className,
  anchor,
  ...props
}: Omit<Primitive.Popup.Props, "className"> &
  FloatingPosition & { className?: string; anchor?: Element | null }) {
  const description = useContext(Description);
  const away = useSubjectPosition(anchor ?? description?.anchor ?? null);
  return (
    <Primitive.Portal>
      <Primitive.Positioner
        anchor={anchor}
        side={away?.side ?? side}
        collisionAvoidance={{ side: "flip", align: "shift", fallbackAxisSide: "start" }}
        align={align}
        sideOffset={
          typeof sideOffset === "function"
            ? (data) => sideOffset(data) + (away?.offset ?? 0)
            : sideOffset + (away?.offset ?? 0)
        }
        alignOffset={alignOffset}
        collisionPadding={8}
        className="isolate z-popup"
      >
        <Primitive.Popup
          id={description?.id}
          role="tooltip"
          data-surface="artifact"
          data-slot="tooltip-content"
          className={cn(floatingSurface, className)}
          {...props}
        />
      </Primitive.Positioner>
    </Primitive.Portal>
  );
}

/** A short hint on the containing SVG mark, including keyboard focus; no HTML inside SVG. */
export function SvgTip({ content }: { content: ReactNode }) {
  const [mark, setMark] = useState<SVGElement | null>(null);
  const [open, setOpen] = useState(false);
  const grace = useHoverGrace(setOpen);
  const attach = useCallback(
    (node: SVGMetadataElement | null) =>
      setMark(node?.parentElement instanceof SVGElement ? node.parentElement : null),
    [],
  );
  useEffect(() => {
    if (!mark) return;
    let timer: ReturnType<typeof setTimeout>;
    const enter = () => {
      grace.cancel();
      mark.setAttribute("data-reach", mark.matches(":focus") ? "focus" : "hover");
      timer = setTimeout(() => setOpen(true), 350);
    };
    const leave = () => {
      clearTimeout(timer);
      grace.leave(false);
      mark.setAttribute(
        "data-reach",
        mark.matches(":focus") ? "focus" : mark.matches(":hover") ? "hover" : "rest",
      );
    };
    const focus = () => {
      grace.cancel();
      mark.setAttribute("data-reach", "focus");
      setOpen(true);
    };
    const previous = ["data-svg-tip", "data-reach", "tabindex", "aria-description"].map(
      (name) => [name, mark.getAttribute(name)] as const,
    );
    mark.setAttribute("data-svg-tip", "");
    mark.setAttribute("data-reach", "rest");
    if (!mark.hasAttribute("tabindex")) mark.setAttribute("tabindex", "0");
    if (typeof content === "string") mark.setAttribute("aria-description", content);
    const events = {
      pointerenter: enter,
      pointerleave: leave,
      focus,
      blur: leave,
      pointerdown: leave,
    };
    Object.entries(events).forEach(([name, handler]) => mark.addEventListener(name, handler));
    return () => {
      clearTimeout(timer);
      grace.cancel();
      previous.forEach(([name, value]) =>
        value == null ? mark.removeAttribute(name) : mark.setAttribute(name, value),
      );
      Object.entries(events).forEach(([name, handler]) => mark.removeEventListener(name, handler));
    };
  }, [mark, content, grace]);
  return (
    <>
      <metadata ref={attach} />
      <Tooltip open={open} onOpenChange={setOpen}>
        <TooltipContent
          anchor={mark}
          onFocusCapture={grace.cancel}
          onBlurCapture={() => grace.leave(false)}
          onPointerEnter={grace.cancel}
          onPointerLeave={() => grace.leave(false)}
        >
          {content}
        </TooltipContent>
      </Tooltip>
    </>
  );
}
