import {
  createContext,
  isValidElement,
  useContext,
  useId,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react";
import { Tooltip as Primitive } from "@base-ui/react/tooltip";
import { cn } from "../../lib/utils";
import { floatingSurface, type FloatingPosition } from "./popover";

const Description = createContext<{ id: string; open: boolean } | null>(null);

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
          aria-label="What is this?"
          className="veil grid size-5 cursor-help place-items-center rounded-control t-small face-mono text-ink-2 hover:text-ink"
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
  const id = useId();
  const [uncontrolled, setOpen] = useState(defaultOpen);
  const open = controlled ?? uncontrolled;
  return (
    <Description.Provider value={{ id, open }}>
      <Primitive.Root
        {...props}
        open={open}
        onOpenChange={(next, event) => {
          if (next && still && event.reason === "trigger-hover") event.cancel();
          onOpenChange?.(next, event);
          if (!event.isCanceled) setOpen(next);
        }}
      />
    </Description.Provider>
  );
}

export function TooltipTrigger(props: Primitive.Trigger.Props) {
  const description = useContext(Description);
  return (
    <Primitive.Trigger
      className="dl-button"
      {...props}
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
  ...props
}: Omit<Primitive.Popup.Props, "className"> & FloatingPosition & { className?: string }) {
  const description = useContext(Description);
  return (
    <Primitive.Portal>
      <Primitive.Positioner
        side={side}
        align={align}
        sideOffset={sideOffset}
        alignOffset={alignOffset}
        collisionPadding={8}
        className="isolate z-popup"
      >
        <Primitive.Popup
          id={description?.id}
          role="tooltip"
          data-surface="artifact"
          data-slot="tooltip-content"
          className={cn(
            floatingSurface,
            "max-w-[min(24rem,var(--available-width))] px-2 py-1",
            className,
          )}
          {...props}
        />
      </Primitive.Positioner>
    </Primitive.Portal>
  );
}
