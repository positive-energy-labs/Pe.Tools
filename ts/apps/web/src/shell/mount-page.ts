import {
  canonicalRouteInput,
  graphFieldPolicy,
  type RouteGraph,
  type FieldDecl,
  type FieldRole,
} from "@pe/agent-contracts";
import type { UrlPage } from "../route/url";
import type { GraphLayoutState } from "../../../../packages/kit/src/components/lang/graph-layout";

/** Layout is device state. Invalid or unavailable storage never prevents a route from opening. */
export function readLayoutState(key: string): GraphLayoutState {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(key) ?? "{}");
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
    return Object.fromEntries(
      Object.entries(raw).flatMap(([id, value]) => {
        if (!value || typeof value !== "object" || Array.isArray(value)) return [];
        const { folded, sizes } = value as { folded?: unknown; sizes?: unknown };
        return [
          [
            id,
            {
              ...(typeof folded === "boolean" && { folded }),
              ...(sizes !== null &&
                typeof sizes === "object" &&
                !Array.isArray(sizes) && {
                  sizes: Object.fromEntries(
                    Object.entries(sizes).filter(
                      ([, size]) => typeof size === "number" && Number.isFinite(size) && size > 0,
                    ),
                  ),
                }),
            },
          ],
        ];
      }),
    );
  } catch {
    return {};
  }
}

export function writeLayoutState(key: string, state: GraphLayoutState): void {
  try {
    localStorage.setItem(key, JSON.stringify(state));
  } catch {
    /* Storage may be disabled. */
  }
}

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
        if (raw === undefined && id in rest) return [id, rest[id]];
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
