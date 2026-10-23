import { useRef } from "react";
import { Popover as Primitive } from "@base-ui/react/popover";
import { Popover, PopoverTrigger, PopoverContent, type PopoverContentProps } from "./popover";

// PreviewCard intentionally hides its body from keyboard and assistive technology.
// Interactive previews use Popover's hover path and retain its click/keyboard path.
/** A press on a trigger that hover just opened keeps it open: the pointer's click confirms the
 * hover, it never toggles the card shut under the user. A second press closes it. */
export function HoverCard({ onOpenChange, ...props }: Primitive.Root.Props) {
  const hovered = useRef(false);
  return (
    <Popover
      {...props}
      onOpenChange={(open, details) => {
        if (!open && details.reason === "trigger-press" && hovered.current) {
          hovered.current = false;
          details.cancel();
          return;
        }
        hovered.current = open && details.reason === "trigger-hover";
        onOpenChange?.(open, details);
      }}
    />
  );
}
export function HoverCardTrigger({
  className,
  kind,
  ...props
}: Primitive.Trigger.Props & { kind?: "quiet" | "framed" }) {
  return (
    <PopoverTrigger
      className={className}
      kind={kind}
      openOnHover
      delay={500}
      closeDelay={200}
      {...props}
    />
  );
}
export function HoverCardContent(props: PopoverContentProps) {
  return (
    <PopoverContent
      initialFocus={(event) => event === "keyboard"}
      data-slot="hover-card-content"
      {...props}
    />
  );
}
