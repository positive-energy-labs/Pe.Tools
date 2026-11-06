import { createElement, lazy, Suspense, type ComponentType } from "react";

/** Keep the authored module DOM-free for host admission and load drawing only on demand. */
export function draw<Context>(load: () => Promise<{ default: ComponentType<{ ctx: Context }> }>) {
  const Component = lazy(load);
  const Drawing = ({ ctx }: { ctx: Context }) => createElement(Suspense, { fallback: "Loading drawing" }, createElement(Component, { ctx }));
  return (ctx: Context) => createElement(Drawing, { ctx });
}
