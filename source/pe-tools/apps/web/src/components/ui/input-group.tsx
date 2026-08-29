import * as React from "react";

import { Press, type PressProps } from "#/components/lang/press";
import { Input } from "#/components/ui/input";
import { Textarea } from "#/components/ui/textarea";
import { tv, type VariantProps } from "#/lib/tv";

export const inputGroupRecipe = tv({
  slots: {
    root: "group/input-group relative flex h-7 w-full min-w-0 items-center rounded-md border border-line bg-line/20 transition-colors outline-none in-data-[slot=combobox-content]:focus-within:border-inherit in-data-[slot=combobox-content]:focus-within:ring-0 has-data-[align=block-end]:rounded-md has-data-[align=block-start]:rounded-md has-[[data-slot=input-group-control]:focus-visible]:border-line-2 has-[[data-slot][aria-invalid=true]]:border-caution has-[[data-slot][aria-invalid=true]]:ring-2 has-[[data-slot][aria-invalid=true]]:ring-caution/20 has-[textarea]:rounded-md has-[>[data-align=block-end]]:h-auto has-[>[data-align=block-end]]:flex-col has-[>[data-align=block-start]]:h-auto has-[>[data-align=block-start]]:flex-col has-[>textarea]:h-auto dark:bg-line/30 dark:has-[[data-slot][aria-invalid=true]]:ring-caution/40 has-[>[data-align=block-end]]:[&>input]:pt-3 has-[>[data-align=block-start]]:[&>input]:pb-3 has-[>[data-align=inline-end]]:[&>input]:pr-1.5 has-[>[data-align=inline-start]]:[&>input]:pl-1.5",
    addon:
      "flex h-auto cursor-text items-center justify-center gap-1 py-2 t-value font-medium text-ink-2 select-none group-data-[disabled=true]/input-group:opacity-50 **:data-[slot=kbd]:rounded-[calc(var(--radius-sm)-2px)] **:data-[slot=kbd]:bg-ink-2/10 **:data-[slot=kbd]:px-1 **:data-[slot=kbd]:t-caption [&>svg:not([class*='size-'])]:size-3.5",
    text: "flex items-center gap-2 t-value text-ink-2 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4",
    input:
      "flex-1 rounded-none border-0 bg-transparent shadow-none ring-0 focus-visible:ring-0 aria-invalid:ring-0 dark:bg-transparent",
    textarea:
      "flex-1 resize-none rounded-none border-0 bg-transparent py-2 shadow-none ring-0 focus-visible:ring-0 aria-invalid:ring-0 dark:bg-transparent",
  },
  variants: {
    align: {
      "inline-start": {
        addon: "order-first pl-2 has-[>button]:ml-[-0.275rem] has-[>kbd]:ml-[-0.275rem]",
      },
      "inline-end": {
        addon: "order-last pr-2 has-[>button]:mr-[-0.275rem] has-[>kbd]:mr-[-0.275rem]",
      },
      "block-start": {
        addon:
          "order-first w-full justify-start px-2 pt-2 group-has-[>input]/input-group:pt-2 [.border-b]:pb-2",
      },
      "block-end": {
        addon:
          "order-last w-full justify-start px-2 pb-2 group-has-[>input]/input-group:pb-2 [.border-t]:pt-2",
      },
    },
    size: {
      xs: {},
      sm: {},
      "icon-xs": {},
      "icon-sm": {},
    },
  },
  defaultVariants: { align: "inline-start", size: "xs" },
});

function InputGroup({ className, ...props }: React.ComponentProps<"div">) {
  const { root } = inputGroupRecipe();
  return <div data-slot="input-group" role="group" className={root({ className })} {...props} />;
}

function InputGroupAddon({
  className,
  align = "inline-start",
  ...props
}: React.ComponentProps<"div"> & Pick<VariantProps<typeof inputGroupRecipe>, "align">) {
  const { addon } = inputGroupRecipe({ align });
  return (
    <div
      role="group"
      data-slot="input-group-addon"
      data-align={align}
      className={addon({ className })}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest("button")) {
          return;
        }
        e.currentTarget.parentElement?.querySelector("input")?.focus();
      }}
      {...props}
    />
  );
}

/** Every consumer asked for the ghost treatment, so it is the only one and `variant` is gone. */
function InputGroupButton({
  size = "xs",
  ...props
}: Omit<PressProps, "size"> & Pick<VariantProps<typeof inputGroupRecipe>, "size">) {
  const pressSize = {
    xs: "caption",
    sm: "label",
    "icon-xs": "icon",
    "icon-sm": "icon",
  }[size] as "caption" | "label" | "icon";
  return <Press data-size={size} size={pressSize} tone="neutral" {...props} />;
}

function InputGroupText({ className, ...props }: React.ComponentProps<"span">) {
  const { text } = inputGroupRecipe();
  return <span className={text({ className })} {...props} />;
}

function InputGroupInput({ className, ...props }: React.ComponentProps<"input">) {
  const { input } = inputGroupRecipe();
  return <Input data-slot="input-group-control" className={input({ className })} {...props} />;
}

function InputGroupTextarea({ className, ...props }: React.ComponentProps<"textarea">) {
  const { textarea } = inputGroupRecipe();
  return (
    <Textarea data-slot="input-group-control" className={textarea({ className })} {...props} />
  );
}

export {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupText,
  InputGroupInput,
  InputGroupTextarea,
};
