import type { ReactNode } from "react";
import { Tooltip as Primitive } from "@base-ui/react/tooltip";

import { tv, type VariantProps } from "#/lib/tv";

export const tooltipRecipe = tv({
  slots: {
    trigger: "inline-flex items-center justify-center transition-colors",
    positioner: "isolate z-popup outline-none",
    popup:
      "max-h-(--available-height) max-w-[min(24rem,var(--available-width))] overflow-y-auto overscroll-contain rounded-lg bg-artifact px-3 py-2 t-label text-ink-2 ring-1 ring-line",
  },
  variants: {
    kind: {
      icon: { trigger: "size-5 cursor-help rounded-sm" },
      label: { trigger: "px-1.5 py-0.5" },
    },
    size: {
      default: {},
      compact: { trigger: "px-1 py-0" },
    },
  },
  defaultVariants: { kind: "label", size: "default" },
});

export function UiTooltipProvider({ children }: { children: ReactNode }) {
  return <Primitive.Provider delay={150}>{children}</Primitive.Provider>;
}

function TooltipTrigger({
  kind,
  size,
  ...props
}: Omit<Primitive.Trigger.Props, "className"> & VariantProps<typeof tooltipRecipe>) {
  const { trigger } = tooltipRecipe({ kind, size });
  return <Primitive.Trigger className={trigger()} {...props} />;
}

function TooltipPositioner(props: Omit<Primitive.Positioner.Props, "className">) {
  const { positioner } = tooltipRecipe();
  return <Primitive.Positioner className={positioner()} {...props} />;
}

function TooltipPopup(props: Omit<Primitive.Popup.Props, "className">) {
  const { popup } = tooltipRecipe();
  return <Primitive.Popup className={popup()} {...props} />;
}

export const Tooltip = {
  Root: Primitive.Root,
  Trigger: TooltipTrigger,
  Portal: Primitive.Portal,
  Positioner: TooltipPositioner,
  Popup: TooltipPopup,
};
