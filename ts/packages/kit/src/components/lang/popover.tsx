import { Popover as Primitive } from "@base-ui/react/popover";
import { cn } from "../../lib/utils";

export const floatingSurface =
  "max-h-(--available-height) overflow-y-auto overscroll-contain t-small text-ink float-surface outline-none";
export type FloatingPosition = Pick<
  Primitive.Positioner.Props,
  "side" | "align" | "sideOffset" | "alignOffset"
>;

export const Popover = Primitive.Root;
export function PopoverTrigger({
  className,
  kind,
  ...props
}: Primitive.Trigger.Props & { kind?: "quiet" | "framed" }) {
  return (
    <Primitive.Trigger
      data-kind={kind}
      className={(state) =>
        cn(
          "dl-button",
          kind === "framed" && "dl-control",
          typeof className === "function" ? className(state) : className,
        )
      }
      {...props}
    />
  );
}
export const PopoverClose = Primitive.Close;
export const PopoverTitle = Primitive.Title;
export const PopoverDescription = Primitive.Description;

export type PopoverContentProps = Omit<Primitive.Popup.Props, "className"> &
  FloatingPosition & {
    className?: string;
    anchor?: Primitive.Positioner.Props["anchor"];
    collisionAvoidance?: Primitive.Positioner.Props["collisionAvoidance"];
    collisionPadding?: Primitive.Positioner.Props["collisionPadding"];
    positionerClassName?: string;
    /** Keep the popup mounted while closed (a menu whose state outlives its opening). */
    keepMounted?: boolean;
    /** The subject's box (I5): the popup opens on the anchor's side away from it and never flips
     *  back over it. Needs an element `anchor`; the side follows the anchor's centre against the
     *  box's centre, on the axis where they lie further apart. */
    avoid?: DOMRect | null;
  };

type Side = NonNullable<FloatingPosition["side"]>;
/** The anchor side that faces away from the subject box. ponytail: centre against centre, no
 *  popup size; measure the popup when a subject sits beside a large popover. */
export function sideAwayFrom(anchor: DOMRect, subject: DOMRect): Side {
  const dx = anchor.left + anchor.width / 2 - (subject.left + subject.width / 2);
  const dy = anchor.top + anchor.height / 2 - (subject.top + subject.height / 2);
  return Math.abs(dy) >= Math.abs(dx) ? (dy < 0 ? "top" : "bottom") : dx < 0 ? "left" : "right";
}

const anchorRect = (anchor: PopoverContentProps["anchor"]): DOMRect | null => {
  const element =
    anchor instanceof Element
      ? anchor
      : anchor && typeof anchor === "object" && "current" in anchor
        ? anchor.current
        : null;
  return element instanceof Element ? element.getBoundingClientRect() : null;
};

/** Portal owns lazy mounting; closed children do not render or run effects. */
export function PopoverContent({
  side = "bottom",
  align = "start",
  sideOffset = 6,
  alignOffset = 0,
  anchor,
  collisionAvoidance,
  collisionPadding = 8,
  positionerClassName,
  className,
  keepMounted,
  avoid,
  ...props
}: PopoverContentProps) {
  const from = avoid ? anchorRect(anchor) : null;
  const away = avoid && from ? sideAwayFrom(from, avoid) : null;
  return (
    <Primitive.Portal keepMounted={keepMounted}>
      <Primitive.Positioner
        anchor={anchor}
        side={away ?? side}
        align={align}
        sideOffset={sideOffset}
        alignOffset={alignOffset}
        collisionPadding={collisionPadding}
        collisionAvoidance={away ? { side: "none", align: "shift" } : collisionAvoidance}
        className={cn("isolate z-popup", positionerClassName)}
      >
        <Primitive.Popup
          data-surface="artifact"
          data-slot="popover-content"
          className={cn(floatingSurface, "w-80 max-w-(--available-width) p-3", className)}
          {...props}
        />
      </Primitive.Positioner>
    </Primitive.Portal>
  );
}
