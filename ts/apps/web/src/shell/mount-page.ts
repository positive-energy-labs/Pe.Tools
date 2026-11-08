import {
  canonicalRouteInput,
  decodePageField,
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
  } catch (error) {
    console.warn("ts/apps/web/src/shell/mount-page.ts: fallback after failure", error);
    /* Storage may be disabled. */
  }
}

// TODO: docs/features/routes/LEDGER.md#s4-page-drive ? drive bare/empty URL, Back/Forward and Place reload in the browser.
/**
 * `rest` is each field's resting value when its schema has no default (the mount's initialPage);
 * S4 presence rule supersedes omission of explicit defaults: they must override Place memory.
 * Middleware still leaves a bare route bare.
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
        const { present, decoded } = decodePageField(field, search, id);
        if (!present && id in rest) return [id, rest[id]];
        return [id, decoded.success ? decoded.data : field.schema.parse(undefined)];
      }),
    ) as Partial<P>;
  const write = (page: Partial<P>) =>
    Object.fromEntries(
      fields.filter(([id]) => id in page).map(([id, field]) => [id, field.codec.encode(page[id])]),
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
    middlewares: [
      ({ search, next }) => {
        const out = { ...next(search) };
        const page = read(out);
        for (const [id, field] of fields) {
          if (!(id in out)) continue;
          if (!decodePageField(field, out, id).decoded.success) continue;
          const value = write(page)[id];
          out[id] =
            typeof page[id] === "number" || typeof page[id] === "boolean" ? page[id] : value;
        }
        return out;
      },
    ],
  };
}

