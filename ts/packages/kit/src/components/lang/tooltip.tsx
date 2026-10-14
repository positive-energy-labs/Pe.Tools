import {
  createContext,
  useContext,
  useId,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import { Tooltip as Primitive } from "@base-ui/react/tooltip";
import { cn } from "../../lib/utils";
import { floatingSurface, type FloatingPosition } from "./popover";

const Description = createContext<{ id: string; open: boolean } | null>(null);

/** A short hint composed onto its existing element, without adding layout or a native title. */
export function TooltipHint({
  content,
  children,
}: {
  content: ReactNode;
  children: ReactElement<{ id?: string; tabIndex?: number }>;
}) {
  if (content == null || content === "" || content === false) return children;
  return (
    <Tooltip>
      <TooltipTrigger
        render={children}
        className=""
        id={children.props.id}
        tabIndex={children.props.tabIndex}
        // A hint is always readable, not only on hover: what `title` gave assistive tech, and the
        // hook a test locates a row by.
        aria-description={typeof content === "string" ? content : undefined}
      />
      <TooltipContent>{content}</TooltipContent>
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
