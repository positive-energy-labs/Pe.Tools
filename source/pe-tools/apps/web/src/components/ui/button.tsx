import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "#/lib/utils";

const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-md border border-transparent bg-clip-padding text-xs/relaxed font-medium whitespace-nowrap transition-all outline-none select-none focus-visible:border-line-2 focus-visible:ring-2 focus-visible:ring-line-2/30 active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-alarm aria-invalid:ring-2 aria-invalid:ring-alarm/20 dark:aria-invalid:border-alarm/50 dark:aria-invalid:ring-alarm/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-commit text-on-commit hover:bg-commit/80",
        outline:
          "border-line hover:bg-line/50 hover:text-ink aria-expanded:bg-recess aria-expanded:text-ink dark:bg-line/30",
        secondary:
          "bg-recess text-ink hover:bg-[color-mix(in_oklch,var(--pe-recess),var(--pe-ink)_5%)] aria-expanded:bg-recess aria-expanded:text-ink",
        ghost:
          "hover:bg-recess hover:text-ink aria-expanded:bg-recess aria-expanded:text-ink dark:hover:bg-recess/50",
        destructive:
          "bg-alarm/10 text-alarm hover:bg-alarm/20 focus-visible:border-alarm/40 focus-visible:ring-alarm/20 dark:bg-alarm/20 dark:hover:bg-alarm/30 dark:focus-visible:ring-alarm/40",
        link: "text-commit underline-offset-4 hover:underline",
      },
      size: {
        default:
          "h-7 gap-1 px-2 text-xs/relaxed has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3.5",
        xs: "h-5 gap-1 rounded-sm px-2 text-[0.625rem] has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-2.5",
        sm: "h-6 gap-1 px-2 text-xs/relaxed has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3",
        lg: "h-8 gap-1 px-2.5 text-xs/relaxed has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2 [&_svg:not([class*='size-'])]:size-4",
        icon: "size-7 [&_svg:not([class*='size-'])]:size-3.5",
        "icon-xs": "size-5 rounded-sm [&_svg:not([class*='size-'])]:size-2.5",
        "icon-sm": "size-6 [&_svg:not([class*='size-'])]:size-3",
        "icon-lg": "size-8 [&_svg:not([class*='size-'])]:size-4",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

function Button({
  className,
  variant = "default",
  size = "default",
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
