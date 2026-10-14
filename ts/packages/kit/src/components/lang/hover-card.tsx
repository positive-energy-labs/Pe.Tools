import { cn } from "../../lib/utils";
import { Popover as Primitive } from "@base-ui/react/popover";
import { PopoverContent, type PopoverContentProps } from "./popover";

// PreviewCard intentionally hides its body from keyboard and assistive technology.
// Interactive previews use Popover's hover path and retain its click/keyboard path.
export const HoverCard = Primitive.Root;
export function HoverCardTrigger({ className, ...props }: Primitive.Trigger.Props) {
  return (
    <Primitive.Trigger
      className={(state) =>
        cn("dl-button", typeof className === "function" ? className(state) : className)
      }
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
