import type * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "#/lib/utils";

// One badge for every pill/chip/tag. Semantic variants + the categorical data palette,
// so status chips and family-matrix kind/scope badges stop being hand-rolled four ways.
const badgeVariants = cva(
  "inline-flex w-fit shrink-0 items-center gap-1 rounded-md border px-1.5 py-0.5 text-[0.7rem] font-medium whitespace-nowrap [&>svg]:pointer-events-none [&>svg]:size-3",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary/10 text-primary",
        secondary: "border-transparent bg-secondary text-secondary-foreground",
        outline: "border-border text-muted-foreground",
        destructive: "border-transparent bg-destructive/10 text-destructive",
        blue: "border-cat-blue/25 bg-cat-blue/12 text-cat-blue",
        green: "border-cat-green/25 bg-cat-green/12 text-cat-green",
        slate: "border-cat-slate/25 bg-cat-slate/12 text-cat-slate",
        lichen: "border-cat-lichen/25 bg-cat-lichen/12 text-cat-lichen",
        clay: "border-cat-clay/25 bg-cat-clay/12 text-cat-clay",
        kiln: "border-cat-kiln/25 bg-cat-kiln/12 text-cat-kiln",
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
