import type * as React from "react";
import { useRender } from "@base-ui/react/use-render";

import { tv } from "#/lib/tv";

export const cardRecipe = tv({
  slots: {
    root: "flex flex-col gap-3 rounded-lg border border-line bg-artifact text-ink",
    header: "flex flex-col gap-3 p-5 sm:flex-row sm:items-start sm:justify-between",
    title: "t-title text-ink",
    description: "t-value text-ink-2",
    action: "flex flex-wrap gap-2",
    content: "p-5 pt-0",
    footer: "flex items-center gap-2 p-5 pt-0",
  },
});

// One bordered surface. Replaces the rounded-{lg,xl,2xl} panel markup re-derived per page.
// `render` makes it polymorphic (base-ui pattern) so a card can BE a link/button without
// re-typing the surface classes — e.g. <Card render={<Link to="…" />}>.
function Card({
  render,
  ...props
}: Omit<React.ComponentProps<"div">, "className"> & { render?: useRender.RenderProp }) {
  const { root } = cardRecipe();
  return useRender({
    render: render ?? <div />,
    defaultTagName: "div",
    props: {
      "data-slot": "card",
      className: root(),
      ...props,
    },
  });
}

function CardHeader(props: Omit<React.ComponentProps<"div">, "className">) {
  const { header } = cardRecipe();
  return <div data-slot="card-header" className={header()} {...props} />;
}

function CardTitle(props: Omit<React.ComponentProps<"h3">, "className">) {
  const { title } = cardRecipe();
  return <h3 data-slot="card-title" className={title()} {...props} />;
}

function CardDescription(props: Omit<React.ComponentProps<"p">, "className">) {
  const { description } = cardRecipe();
  return <p data-slot="card-description" className={description()} {...props} />;
}

function CardAction(props: Omit<React.ComponentProps<"div">, "className">) {
  const { action } = cardRecipe();
  return <div data-slot="card-action" className={action()} {...props} />;
}

function CardContent(props: Omit<React.ComponentProps<"div">, "className">) {
  const { content } = cardRecipe();
  return <div data-slot="card-content" className={content()} {...props} />;
}

function CardFooter(props: Omit<React.ComponentProps<"div">, "className">) {
  const { footer } = cardRecipe();
  return <div data-slot="card-footer" className={footer()} {...props} />;
}

export { Card, CardHeader, CardTitle, CardDescription, CardAction, CardContent, CardFooter };
