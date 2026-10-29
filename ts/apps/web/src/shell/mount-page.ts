import {
  canonicalRouteInput,
  graphFieldPolicy,
  type RouteGraph,
  type FieldDecl,
  type FieldRole,
} from "@pe/agent-contracts";
import type { UrlPage } from "../route/url";

/** Graph fields supply every codec and history policy; useUrlPage owns router sequencing. */
export function graphUrlPage<P, W>(graph: RouteGraph<P, W>): UrlPage<P> {
  const entries = Object.entries(graph.fields) as [
    keyof P & string,
    FieldDecl & { role: FieldRole },
  ][];
  const fields = entries.filter(([, f]) => graphFieldPolicy(f).url !== false);
  const read = (search: Record<string, unknown>) =>
    Object.fromEntries(
      fields.map(([id, field]) => {
        const raw = search[id];
        const typed = field.schema.safeParse(raw);
        const decoded = typed.success
          ? typed
          : typeof raw === "string"
            ? field.schema.safeParse(field.codec.decode(raw))
            : typed;
        return [id, decoded.success ? decoded.data : field.schema.parse(undefined)];
      }),
    ) as Partial<P>;
  const write = (page: Partial<P>) =>
    Object.fromEntries(
      fields
        .filter(([id]) => id in page)
        .map(([id, field]) => {
          const value = page[id];
          const initial = field.schema.safeParse(undefined);
          return [
            id,
            initial.success && canonicalRouteInput(initial.data) === canonicalRouteInput(value)
              ? undefined
              : field.codec.encode(value),
          ];
        }),
    );
  return {
    keys: fields.map(([id]) => id),
    read,
    write,
    history: (before, after, override) => {
      const changed = fields.filter(
        ([id]) => canonicalRouteInput(before[id]) !== canonicalRouteInput(after[id]),
      );
      return !changed.length
        ? null
        : (override ??
            (changed.some(([, f]) => graphFieldPolicy(f).url === "push") ? "push" : "replace"));
    },
    middlewares: [],
  };
}
