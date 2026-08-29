import { Switch as SwitchPrimitive } from "@base-ui/react/switch";

import { tv, type VariantProps } from "#/lib/tv";

export const switchRecipe = tv({
  slots: {
    root: "peer group/switch relative inline-flex shrink-0 items-center rounded-full border border-transparent transition-all outline-none after:absolute after:-inset-x-3 after:-inset-y-2 focus-visible:border-line-2 focus-visible:ring-2 focus-visible:ring-line-2/30 aria-invalid:border-caution aria-invalid:ring-2 aria-invalid:ring-caution/20 dark:aria-invalid:border-caution/50 dark:aria-invalid:ring-caution/40 data-checked:bg-ink data-unchecked:bg-line dark:data-unchecked:bg-line/80 data-disabled:cursor-not-allowed data-disabled:opacity-50",
    thumb:
      "pointer-events-none block rounded-full bg-page ring-0 transition-transform dark:data-unchecked:bg-ink",
  },
  variants: {
    size: {
      sm: {
        root: "h-[14px] w-[24px]",
        thumb: "size-3 data-checked:translate-x-[calc(100%-2px)] data-unchecked:translate-x-0",
      },
      default: {
        root: "h-[16.6px] w-[28px]",
        thumb: "size-3.5 data-checked:translate-x-[calc(100%-2px)] data-unchecked:translate-x-0",
      },
    },
  },
  defaultVariants: { size: "default" },
});

function Switch({
  size = "default",
  ...props
}: Omit<SwitchPrimitive.Root.Props, "className"> & VariantProps<typeof switchRecipe>) {
  const { root, thumb } = switchRecipe({ size });
  return (
    <SwitchPrimitive.Root data-slot="switch" data-size={size} className={root()} {...props}>
      <SwitchPrimitive.Thumb data-slot="switch-thumb" className={thumb()} />
    </SwitchPrimitive.Root>
  );
}

export { Switch };
