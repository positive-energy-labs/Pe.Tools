import { Switch as SwitchPrimitive } from "@base-ui/react/switch";

import { cn } from "#/lib/utils";

function Switch({
  className,
  size = "default",
  ...props
}: SwitchPrimitive.Root.Props & { size?: "sm" | "default" }) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      data-size={size}
      className={cn(
        "peer group/switch relative inline-flex shrink-0 items-center rounded-full border border-transparent transition-all outline-none after:absolute after:-inset-x-3 after:-inset-y-2 focus-visible:border-line-2 focus-visible:ring-2 focus-visible:ring-line-2/30 aria-invalid:border-caution aria-invalid:ring-2 aria-invalid:ring-caution/20 data-[size=default]:h-[16.6px] data-[size=default]:w-[28px] data-[size=sm]:h-[14px] data-[size=sm]:w-[24px] dark:aria-invalid:border-caution/50 dark:aria-invalid:ring-caution/40 data-checked:bg-ink data-unchecked:bg-line dark:data-unchecked:bg-line/80 data-disabled:cursor-not-allowed data-disabled:opacity-50",
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className="pointer-events-none block rounded-full bg-page ring-0 transition-transform group-data-[size=default]/switch:size-3.5 group-data-[size=sm]/switch:size-3 group-data-[size=default]/switch:data-checked:translate-x-[calc(100%-2px)] group-data-[size=sm]/switch:data-checked:translate-x-[calc(100%-2px)] group-data-[size=default]/switch:data-unchecked:translate-x-0 group-data-[size=sm]/switch:data-unchecked:translate-x-0 dark:data-unchecked:bg-ink"
      />
    </SwitchPrimitive.Root>
  );
}

export { Switch };
