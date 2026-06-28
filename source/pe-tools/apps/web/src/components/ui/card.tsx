import type * as React from "react";
import { useRender } from "@base-ui/react/use-render";

import { cn } from "#/lib/utils";

// One bordered surface. Replaces the rounded-{lg,xl,2xl} panel markup re-derived per page.
// `render` makes it polymorphic (base-ui pattern) so a card can BE a link/button without
// re-typing the surface classes — e.g. <Card render={<Link to="…" />}>.
function Card({
  className,
  render,
  ...props
}: React.ComponentProps<"div"> & { render?: useRender.RenderProp }) {
  return useRender({
    render: render ?? <div />,
    defaultTagName: "div",
    props: {
      "data-slot": "card",
      className: cn(
        "rounded-xl border border-border bg-card text-card-foreground shadow-sm",
        className,
      ),
      ...props,
    },
  });
}

function CardHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-header"
      className={cn(
        "flex flex-col gap-3 p-5 sm:flex-row sm:items-start sm:justify-between",
        className,
      )}
      {...props}
    />
  );
}

function CardTitle({ className, ...props }: React.ComponentProps<"h3">) {
  return (
    <h3
      data-slot="card-title"
      className={cn("text-sm font-semibold text-foreground", className)}
      {...props}
    />
  );
}

function CardDescription({ className, ...props }: React.ComponentProps<"p">) {
  return (
    <p
      data-slot="card-description"
      className={cn("text-xs text-muted-foreground", className)}
      {...props}
    />
  );
}

function CardAction({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div data-slot="card-action" className={cn("flex flex-wrap gap-2", className)} {...props} />
  );
}

function CardContent({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="card-content" className={cn("p-5 pt-0", className)} {...props} />;
}

function CardFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-footer"
      className={cn("flex items-center gap-2 p-5 pt-0", className)}
      {...props}
    />
  );
}

export { Card, CardHeader, CardTitle, CardDescription, CardAction, CardContent, CardFooter };
