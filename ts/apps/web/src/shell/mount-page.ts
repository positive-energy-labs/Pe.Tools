import {
  canonicalRouteInput,
  graphFieldPolicy,
  type RouteGraph,
  type FieldDecl,
  type FieldRole,
} from "@pe/agent-contracts";
import type { UrlPage } from "../route/url";

/** Graph fields supply every codec and history policy; useUrlPage owns router sequencing. */
/**
 * `rest` is each field's resting value when its schema has no default (the mount's initialPage);
 * a field at rest is absent from the URL, so a shared link carries only what the user changed.
 */
export function graphUrlPage<P, W>(graph: RouteGraph<P, W>, rest: Partial<P> = {}): UrlPage<P> {
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
        // The router JSON-parses search values, so `?level=30` arrives as a number and `?on=true`
        // as a boolean; a scalar re-enters the one string grammar. Objects and arrays never do.
        const scalar =
          typeof raw === "string" || typeof raw === "number" || typeof raw === "boolean";
        const decoded = typed.success
          ? typed
          : scalar
            ? field.schema.safeParse(field.codec.decode(String(raw)))
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
          const resting = initial.success ? initial.data : rest[id as keyof P];
          return [
            id,
            (initial.success || id in rest) &&
            canonicalRouteInput(resting) === canonicalRouteInput(value)
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
