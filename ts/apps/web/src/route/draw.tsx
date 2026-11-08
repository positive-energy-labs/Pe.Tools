import { createElement, lazy, Suspense, type ComponentType, type ReactNode } from "react";

type Context<C> = C extends (props: { ctx: infer T }) => ReactNode ? T : never;

/** Keep the authored module DOM-free for host admission and load drawing only on demand. */
export function draw<M, K extends keyof M>(
  load: () => Promise<M>,
  name: K & (Context<M[K]> extends never ? never : K),
) {
  const Component = lazy(() =>
    load().then((module) => ({ default: module[name] as ComponentType<{ ctx: Context<M[K]> }> })),
  );
  const Drawing = ({ ctx }: { ctx: Context<M[K]> }) =>
    createElement(Suspense, { fallback: "Loading drawing" }, createElement(Component, { ctx }));
  return (ctx: Context<M[K]>) => createElement(Drawing, { ctx });
}
