import { createElement, lazy, Suspense, type ComponentType, type ReactNode } from "react";
import { fillBody, scrollBody, type Body, type BodyKind } from "./body";

type Context<C> = C extends (props: { ctx: infer T }) => ReactNode ? T : never;

/** Keep the authored module DOM-free for host admission and load drawing only on demand. The kind
 * is the pane's declared `body` (route/body.ts); the drawing's element is branded with it. */
export function draw<B extends BodyKind, M, K extends keyof M>(
  kind: B,
  load: () => Promise<M>,
  name: K & (Context<M[K]> extends never ? never : K),
) {
  const Component = lazy(() =>
    load().then((module) => ({ default: module[name] as ComponentType<{ ctx: Context<M[K]> }> })),
  );
  const Drawing = ({ ctx }: { ctx: Context<M[K]> }) =>
    createElement(Suspense, { fallback: "Loading drawing" }, createElement(Component, { ctx }));
  const brand = (kind === "fill" ? fillBody : scrollBody) as (node: ReactNode) => Body<B>;
  return (ctx: Context<M[K]>) => brand(createElement(Drawing, { ctx }));
}
