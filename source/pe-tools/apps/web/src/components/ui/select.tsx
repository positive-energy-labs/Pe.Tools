import { Select as SelectPrimitive } from "@base-ui/react/select";
import { Check as RiCheckLine, ChevronDown as RiArrowDownSLine } from "lucide-react";

import { recipeClass, tv } from "#/lib/tv";

export const selectRecipe = tv({
  slots: {
    value: "truncate",
    trigger:
      "flex h-7 w-full items-center justify-between gap-2 rounded-md border border-line bg-transparent px-2 t-value whitespace-nowrap outline-none transition-colors hover:bg-line/50 focus-visible:border-line-2 focus-visible:ring-2 focus-visible:ring-line-2/30 disabled:pointer-events-none disabled:opacity-50 data-[popup-open]:bg-recess [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5",
    icon: "text-ink-2",
    positioner: "isolate z-popup outline-none",
    content:
      "z-popup max-h-(--available-height) min-w-(--anchor-width) origin-(--transform-origin) overflow-y-auto rounded-lg bg-artifact p-1 text-ink ring-1 ring-line outline-none data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
    item: "relative flex min-h-7 cursor-default items-center gap-2 rounded-md py-1 pr-8 pl-2 t-value outline-hidden select-none data-highlighted:bg-select data-highlighted:text-ink data-disabled:pointer-events-none data-disabled:opacity-50",
    indicator: "pointer-events-none absolute right-2 flex items-center justify-center",
    check: "size-3.5",
  },
});

function Select<Value>(props: SelectPrimitive.Root.Props<Value>) {
  return <SelectPrimitive.Root data-slot="select" {...props} />;
}

function SelectValue({ className, ...props }: SelectPrimitive.Value.Props) {
  const { value } = selectRecipe();
  return (
    <SelectPrimitive.Value
      data-slot="select-value"
      className={recipeClass(value, className)}
      {...props}
    />
  );
}

function SelectTrigger({ className, children, ...props }: SelectPrimitive.Trigger.Props) {
  const { trigger, icon } = selectRecipe();
  return (
    <SelectPrimitive.Trigger
      data-slot="select-trigger"
      className={recipeClass(trigger, className)}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon className={icon()}>
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
  const { positioner, content } = selectRecipe();
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Positioner className={positioner()} sideOffset={sideOffset}>
        <SelectPrimitive.Popup
          data-slot="select-content"
          className={recipeClass(content, className)}
          {...props}
        >
          {children}
        </SelectPrimitive.Popup>
      </SelectPrimitive.Positioner>
    </SelectPrimitive.Portal>
  );
}

function SelectItem({ className, children, ...props }: SelectPrimitive.Item.Props) {
  const { item, indicator, check } = selectRecipe();
  return (
    <SelectPrimitive.Item
      data-slot="select-item"
      className={recipeClass(item, className)}
      {...props}
    >
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
      <span className={indicator()}>
        <SelectPrimitive.ItemIndicator>
          <RiCheckLine className={check()} />
        </SelectPrimitive.ItemIndicator>
      </span>
    </SelectPrimitive.Item>
  );
}

export { Select, SelectValue, SelectTrigger, SelectContent, SelectItem };
