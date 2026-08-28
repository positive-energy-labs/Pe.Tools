import { Select as SelectPrimitive } from "@base-ui/react/select";
import { Check as RiCheckLine, ChevronDown as RiArrowDownSLine } from "lucide-react";

import { cn } from "#/lib/utils";
import { POPUP_SURFACE_CLASS } from "./popup";

function Select<Value>(props: SelectPrimitive.Root.Props<Value>) {
  return <SelectPrimitive.Root data-slot="select" {...props} />;
}

function SelectValue({ className, ...props }: SelectPrimitive.Value.Props) {
  return (
    <SelectPrimitive.Value
      data-slot="select-value"
      className={cn("truncate", className)}
      {...props}
    />
  );
}

function SelectTrigger({ className, children, ...props }: SelectPrimitive.Trigger.Props) {
  return (
    <SelectPrimitive.Trigger
      data-slot="select-trigger"
      className={cn(
        "flex h-7 w-full items-center justify-between gap-2 rounded-md border border-line bg-transparent px-2 text-xs whitespace-nowrap outline-none transition-colors duration-(--motion) hover:bg-line/50 focus-visible:border-line-2 focus-visible:ring-2 focus-visible:ring-line-2/30 disabled:pointer-events-none disabled:opacity-50 data-[popup-open]:bg-recess [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5",
        className,
      )}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon className="text-ink-2">
        <RiArrowDownSLine />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  );
}

function SelectContent({
  className,
  children,
  sideOffset = 4,
  ...props
}: SelectPrimitive.Popup.Props & Pick<SelectPrimitive.Positioner.Props, "sideOffset">) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Positioner className="isolate z-modal outline-none" sideOffset={sideOffset}>
        <SelectPrimitive.Popup
          data-slot="select-content"
          className={cn(
            `z-modal max-h-(--available-height) min-w-(--anchor-width) origin-(--transform-origin) overflow-y-auto p-1 outline-none ${POPUP_SURFACE_CLASS} data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95`,
            className,
          )}
          {...props}
        >
          {children}
        </SelectPrimitive.Popup>
      </SelectPrimitive.Positioner>
    </SelectPrimitive.Portal>
  );
}

function SelectItem({ className, children, ...props }: SelectPrimitive.Item.Props) {
  return (
    <SelectPrimitive.Item
      data-slot="select-item"
      className={cn(
        "relative flex min-h-7 cursor-default items-center gap-2 rounded-md py-1 pr-8 pl-2 text-xs/relaxed outline-hidden select-none data-highlighted:bg-select data-highlighted:text-ink data-disabled:pointer-events-none data-disabled:opacity-50",
        className,
      )}
      {...props}
    >
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
      <span className="pointer-events-none absolute right-2 flex items-center justify-center">
        <SelectPrimitive.ItemIndicator>
          <RiCheckLine className="size-3.5" />
        </SelectPrimitive.ItemIndicator>
      </span>
    </SelectPrimitive.Item>
  );
}

export { Select, SelectValue, SelectTrigger, SelectContent, SelectItem };
