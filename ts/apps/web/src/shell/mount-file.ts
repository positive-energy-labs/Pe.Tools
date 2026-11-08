import type {RouteGraph} from "@pe/agent-contracts";
import {graphUrlPage} from "./mount-page";
import {
  createRoute,
  type RouteComponent,
  type ResolveFullPath,
  type ResolveId,
} from "@tanstack/react-router";
import { Route as rootRoute } from "../routes/__root";
import { routeSearch } from "#/shell/owner";
import { fixtureName } from "./fixture";

type GraphSearch<P> = ReturnType<typeof routeSearch> & Partial<P> & { fixture?: string };
export type CodeRoute<P, Path extends string> = ReturnType<
  typeof createRoute<
    unknown,
    typeof rootRoute,
    Path,
    ResolveFullPath<typeof rootRoute, Path>,
    string,
    ResolveId<typeof rootRoute, string, Path>,
    (search: Record<string, unknown>) => GraphSearch<P>
  >
>;

/** A code route under the app root (S0c proved coexistence); the file-route generator stays untouched. */
export function codeRoute<P, W, const Path extends string>(
  graph: RouteGraph<P, W>,
  initialPage: Partial<P> | undefined,
  component: RouteComponent,
  path: Path,
): CodeRoute<P, Path> {
  const url = graphUrlPage(graph, initialPage);
  return createRoute({
    getParentRoute: () => rootRoute,
    path,
    // Type only the keys the URL carries: returning every field makes the router redirect to a
    // URL that spells out each default. Absent fields rest at their defaults in the mount.
    validateSearch: (search: Record<string, unknown>): GraphSearch<P> => {
      const typed = url.read(search) as Record<string, unknown>;
      const present = Object.fromEntries(
        Object.entries(typed).filter(([id]) => id in search),
      ) as Partial<P>;
      return {
        ...routeSearch(search),
        ...present,
        ...(graph.subjectField && graph.subjectField.field in search
          ? { [graph.subjectField.field]: search[graph.subjectField.field] }
          : {}),
        ...(fixtureName(search) !== null ? { fixture: fixtureName(search)! } : {}),
      };
    },
    search: { middlewares: [...url.middlewares] },
    component,
  });
}
