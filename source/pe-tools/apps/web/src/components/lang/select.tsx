import { Select as SelectPrimitive } from "@base-ui/react/select";
import { Check as RiCheckLine, ChevronDown as RiArrowDownSLine } from "lucide-react";

import { tv } from "#/lib/tv";

export const selectRecipe = tv({
  slots: {
    value: "truncate",
    trigger:
      "flex h-(--control-h) w-full items-center justify-between gap-2 rounded-md border border-line bg-transparent px-2 t-small whitespace-nowrap outline-none transition-colors hover:bg-line/50 focus-visible:border-line-2 focus-visible:ring-2 focus-visible:ring-line-2/30 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5",
    icon: "text-ink-2",
    positioner: "isolate z-popup outline-none",
    content:
      "z-popup max-h-(--available-height) w-(--anchor-width) max-w-(--available-width) overflow-y-auto rounded-lg p-1 text-ink ring-1 ring-line outline-none",
    item: "relative flex min-h-(--item-h) cursor-default items-center gap-2 rounded-md py-1 pr-8 pl-2 t-small outline-hidden select-none data-highlighted:text-ink data-disabled:pointer-events-none data-disabled:opacity-50",
    indicator: "pointer-events-none absolute right-2 flex items-center justify-center",
    check: "size-3.5",
  },
});

function Select<Value>(props: SelectPrimitive.Root.Props<Value>) {
  return <SelectPrimitive.Root data-slot="select" {...props} />;
}

function SelectValue(props: Omit<SelectPrimitive.Value.Props, "className">) {
  const { value } = selectRecipe();
  return <SelectPrimitive.Value data-slot="select-value" className={value()} {...props} />;
}

function SelectTrigger({ children, ...props }: Omit<SelectPrimitive.Trigger.Props, "className">) {
  const { trigger, icon } = selectRecipe();
  return (
    <SelectPrimitive.Trigger data-slot="select-trigger" className={trigger()} {...props}>
      {children}
      <SelectPrimitive.Icon className={icon()}>
        <RiArrowDownSLine />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  );
}

function SelectContent({
  children,
  sideOffset = 6,
  ...props
}: Omit<SelectPrimitive.Popup.Props, "className"> &
  Pick<SelectPrimitive.Positioner.Props, "sideOffset">) {
  const { positioner, content } = selectRecipe();
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Positioner
        side="bottom"
        align="start"
        sideOffset={sideOffset}
        alignItemWithTrigger={false}
        className={positioner()}
      >
        <SelectPrimitive.Popup
          data-slot="select-content"
          className={content()}
          {...props}
          data-surface="artifact"
        >
          {children}
        </SelectPrimitive.Popup>
      </SelectPrimitive.Positioner>
    </SelectPrimitive.Portal>
  );
}

function SelectItem({ children, ...props }: Omit<SelectPrimitive.Item.Props, "className">) {
  const { item, indicator, check } = selectRecipe();
  return (
    <SelectPrimitive.Item data-slot="select-item" className={item()} {...props}>
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
