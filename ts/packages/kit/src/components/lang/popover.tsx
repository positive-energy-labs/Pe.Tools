import { Popover as Primitive } from "@base-ui/react/popover";
import { cn } from "../../lib/utils";

export const floatingSurface =
  "max-h-(--available-height) overflow-y-auto overscroll-contain t-small text-ink float-surface outline-none";
export type FloatingPosition = Pick<
  Primitive.Positioner.Props,
  "side" | "align" | "sideOffset" | "alignOffset"
>;

export const Popover = Primitive.Root;
export function PopoverTrigger(props: Primitive.Trigger.Props) {
  return <Primitive.Trigger className="dl-button" {...props} />;
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
  ...props
}: PopoverContentProps) {
  return (
    <Primitive.Portal>
      <Primitive.Positioner
        anchor={anchor}
        side={side}
        align={align}
        sideOffset={sideOffset}
        alignOffset={alignOffset}
        collisionPadding={collisionPadding}
        collisionAvoidance={collisionAvoidance}
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
