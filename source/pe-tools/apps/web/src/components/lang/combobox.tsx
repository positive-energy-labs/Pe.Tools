"use client";

import * as React from "react";
import { Combobox as Primitive } from "@base-ui/react/combobox";
import { Check, ChevronDown, X } from "lucide-react";

import { Press } from "#/components/lang/press";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "#/components/lang/input-group";
import { tv } from "#/lib/tv";

export const comboboxRecipe = tv({
  slots: {
    // The trigger is a ROW: label then chevron. It owns this even when it renders as another
    // element (base-ui's `render` replaces that element's className with the slot's).
    trigger: "inline-flex items-center gap-1 [&_svg:not([class*='size-'])]:size-3.5",
    list: "no-scrollbar max-h-[min(15.75rem,calc(var(--available-height)-2.25rem))] scroll-py-1 overflow-y-auto overscroll-contain p-1 data-empty:p-0",
    item: "relative flex min-h-(--item-h) w-full cursor-default items-center gap-2 rounded-md px-2 py-1 outline-hidden select-none data-highlighted:text-ink not-data-[variant=destructive]:data-highlighted:**:text-ink data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5",
    empty:
      "hidden w-full justify-center py-2 text-center text-ink-2 group-data-empty/combobox-content:flex",
    chips:
      "flex min-h-(--control-h) flex-wrap items-center gap-1 rounded-md border border-line bg-line/20 bg-clip-padding px-2 py-0.5 transition-colors focus-within:border-line-2 focus-within:ring-2 focus-within:ring-line-2/30 has-aria-invalid:border-caution has-aria-invalid:ring-2 has-aria-invalid:ring-caution has-data-[slot=combobox-chip]:px-1 dark:bg-line/30",
    chip: "flex h-[calc(--spacing(4.75))] w-fit items-center justify-center gap-1 rounded-[calc(var(--radius-sm)-2px)] bg-ink-2/10 px-1.5 font-medium whitespace-nowrap text-ink has-disabled:pointer-events-none has-disabled:cursor-not-allowed has-disabled:opacity-50 has-data-[slot=combobox-chip-remove]:pr-0",
    chipInput: "min-w-16 flex-1 outline-none",
  },
});

const ComboboxMultipleContext = React.createContext(false);

function Combobox<Value, Multiple extends boolean | undefined = false>(
  props: Primitive.Root.Props<Value, Multiple>,
) {
  return (
    <ComboboxMultipleContext.Provider value={props.multiple === true}>
      <Primitive.Root {...props} />
    </ComboboxMultipleContext.Provider>
  );
}

const ComboboxValue = (props: Omit<Primitive.Value.Props, "className">) => (
  <Primitive.Value data-slot="combobox-value" {...props} />
);

function ComboboxTrigger({
  children,
  fill,
  ...props
}: Omit<Primitive.Trigger.Props, "className"> & {
  /** Stretch to the anchor's width with the chevron pinned to the right edge. */
  fill?: boolean;
}) {
  const { trigger } = comboboxRecipe();
  return (
    <Primitive.Trigger
      data-slot="combobox-trigger"
      className={
        // A filling trigger reads as the CellSelect it sits above: mono, item height, the same
        // 4px inset, chevron on the right edge (dropdown parity, 2026-08-31).
        fill
          ? `${trigger()} flex h-(--item-h) w-full min-w-0 items-center justify-between gap-1 px-1 face-mono`
          : trigger()
      }
      {...props}
    >
      {children}
      <ChevronDown className="pointer-events-none size-3.5 shrink-0 text-ink-2" />
    </Primitive.Trigger>
  );
}

function ComboboxClear(props: Omit<Primitive.Clear.Props, "className">) {
  return (
    <Primitive.Clear
      data-slot="combobox-clear"
      render={<InputGroupButton size="icon-xs" />}
      {...props}
    >
      <X className="pointer-events-none" />
    </Primitive.Clear>
  );
}

function ComboboxInput({
  children,
  disabled = false,
  showTrigger = true,
  showClear = false,
  ...props
}: Omit<Primitive.Input.Props, "className"> & { showTrigger?: boolean; showClear?: boolean }) {
  return (
    <InputGroup>
      <Primitive.Input render={<InputGroupInput disabled={disabled} />} {...props} />
      <InputGroupAddon align="inline-end">
        {showTrigger && (
          <ComboboxTrigger
            data-slot="input-group-button"
            disabled={disabled}
            render={<InputGroupButton size="icon-xs" />}
          />
        )}
        {showClear && <ComboboxClear disabled={disabled} />}
      </InputGroupAddon>
      {children}
    </InputGroup>
  );
}

function ComboboxContent({
  side = "bottom",
  sideOffset = 6,
  align = "start",
  alignOffset = 0,
  anchor,
  ...props
}: Omit<Primitive.Popup.Props, "className"> &
  Pick<Primitive.Positioner.Props, "side" | "align" | "sideOffset" | "alignOffset" | "anchor">) {
  const multiple = React.useContext(ComboboxMultipleContext);
  return (
    <Primitive.Portal>
      <Primitive.Positioner
        side={side}
        sideOffset={sideOffset}
        align={align}
        alignOffset={alignOffset}
        anchor={anchor}
        className="isolate z-popup"
      >
        <Primitive.Popup
          data-slot="combobox-content"
          data-multiple={multiple}
          className="group/combobox-content relative max-h-(--available-height) w-(--anchor-width) max-w-(--available-width) min-w-40 overflow-hidden rounded-lg text-ink ring-1 ring-line data-[multiple=true]:min-w-(--anchor-width) *:data-[slot=input-group]:m-1 *:data-[slot=input-group]:mb-0 *:data-[slot=input-group]:h-(--control-h) *:data-[slot=input-group]:border-none *:data-[slot=input-group]:bg-line/20 *:data-[slot=input-group]:shadow-none"
          data-surface="artifact"
          {...props}
        />
      </Primitive.Positioner>
    </Primitive.Portal>
  );
}

function ComboboxList(props: Omit<Primitive.List.Props, "className">) {
  const { list } = comboboxRecipe();
  return <Primitive.List data-slot="combobox-list" className={list()} {...props} />;
}
function ComboboxItem({ children, ...props }: Omit<Primitive.Item.Props, "className">) {
  const { item } = comboboxRecipe();
  return (
    <Primitive.Item data-slot="combobox-item" className={item()} {...props}>
      {children}
      <Primitive.ItemIndicator
        render={
          <span className="pointer-events-none absolute right-2 flex items-center justify-center" />
        }
      >
        <Check className="pointer-events-none" />
      </Primitive.ItemIndicator>
    </Primitive.Item>
  );
}
function ComboboxEmpty(props: Omit<Primitive.Empty.Props, "className">) {
  const { empty } = comboboxRecipe();
  return <Primitive.Empty data-slot="combobox-empty" className={empty()} {...props} />;
}
function ComboboxChips(
  props: Omit<
    React.ComponentPropsWithRef<typeof Primitive.Chips> & Primitive.Chips.Props,
    "className"
  >,
) {
  const { chips } = comboboxRecipe();
  return <Primitive.Chips data-slot="combobox-chips" className={chips()} {...props} />;
}
function ComboboxChip({
  children,
  showRemove = true,
  face,
  ...props
}: Omit<Primitive.Chip.Props, "className"> & { showRemove?: boolean; face?: "mono" }) {
  const { chip } = comboboxRecipe();
  return (
    <Primitive.Chip
      data-slot="combobox-chip"
      className={`${chip()}${face === "mono" ? " face-mono" : ""}`}
      {...props}
    >
      {children}
      {showRemove && (
        <Primitive.ChipRemove
          render={<Press tone="neutral" size="icon" />}
          data-slot="combobox-chip-remove"
        >
          <X className="pointer-events-none" />
        </Primitive.ChipRemove>
      )}
    </Primitive.Chip>
  );
}
function ComboboxChipsInput({
  face,
  ...props
}: Omit<Primitive.Input.Props, "className"> & { face?: "mono" }) {
  const { chipInput } = comboboxRecipe();
  return (
    <Primitive.Input
      data-slot="combobox-chip-input"
      className={`${chipInput()}${face === "mono" ? " face-mono" : ""}`}
      {...props}
    />
  );
}
function useComboboxAnchor() {
  return React.useRef<HTMLDivElement | null>(null);
}

export {
  Combobox,
  ComboboxClear,
  ComboboxInput,
  ComboboxContent,
  ComboboxList,
  ComboboxItem,
  ComboboxEmpty,
  ComboboxChips,
  ComboboxChip,
  ComboboxChipsInput,
  ComboboxTrigger,
  ComboboxValue,
  useComboboxAnchor,
};
