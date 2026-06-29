import { lazy, type ComponentType, type LazyExoticComponent } from "react";
import type { ResolvedFieldRendererProps } from "./shared";

const rendererRegistry: Record<
  string,
  LazyExoticComponent<ComponentType<ResolvedFieldRendererProps>>
> = {
  table: lazy(() => import("./table-field").then((module) => ({ default: module.TableField }))),
};

export function resolveCustomRenderer(
  renderer: string | undefined,
): LazyExoticComponent<ComponentType<ResolvedFieldRendererProps>> | undefined {
  if (!renderer) {
    return undefined;
  }

  return rendererRegistry[renderer.toLowerCase()];
}
