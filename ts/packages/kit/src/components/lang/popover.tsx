import { PopoverContent, type PopoverContentProps } from "./popover-internal";
export {
  Popover,
  PopoverTrigger,
  PopoverClose,
  PopoverTitle,
  PopoverDescription,
  SubjectBox,
  usePopoverSide,
  sideAwayFrom,
} from "./popover-internal";

/** Subject overlays inherit placement; a route cannot pin them over their subject. */
export type SubjectPopoverContentProps = Omit<PopoverContentProps, "side" | "align">;
export function SubjectPopoverContent(props: SubjectPopoverContentProps) {
  return <PopoverContent {...props} />;
}
