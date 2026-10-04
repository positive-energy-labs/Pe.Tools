import type * as React from "react";
import { useRender } from "@base-ui/react/use-render";

import { tv } from "#/lib/tv";

export const cardRecipe = tv({
  slots: { root: "flex flex-col gap-3 rounded-lg border border-line p-5 text-ink" },
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
      "data-surface": "artifact",
    },
  });
}

export { Card };
