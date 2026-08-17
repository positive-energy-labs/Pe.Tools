import type * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "#/lib/utils";

// One badge for every pill/chip/tag. Semantic variants + the viz ladder for TAXONOMY spends
// (colour-by-kind, label carries the meaning). Variant names keep their series identity from
// the cat-* era; the classes resolve straight onto --viz-1..6.
const badgeVariants = cva(
  "inline-flex w-fit shrink-0 items-center gap-1 rounded-md border px-1.5 py-0.5 text-[0.7rem] font-medium whitespace-nowrap [&>svg]:pointer-events-none [&>svg]:size-3",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary/10 text-primary",
        secondary: "border-transparent bg-secondary text-secondary-foreground",
        outline: "border-border text-muted-foreground",
        destructive: "border-transparent bg-destructive/10 text-destructive",
        blue: "border-viz-1/25 bg-viz-1/12 text-viz-1",
        green: "border-viz-2/25 bg-viz-2/12 text-viz-2",
        slate: "border-viz-3/25 bg-viz-3/12 text-viz-3",
        lichen: "border-viz-4/25 bg-viz-4/12 text-viz-4",
        clay: "border-viz-5/25 bg-viz-5/12 text-viz-5",
        kiln: "border-viz-6/25 bg-viz-6/12 text-viz-6",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

function Badge({
  className,
  variant,
  ...props
}: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return (
    <span data-slot="badge" className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}

export { Badge, badgeVariants };
