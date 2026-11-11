import { z } from "zod";
import {
  type CellsDecl,
  type RouteGraph,
  type RouteFingerprint,
} from "@pe/agent-contracts";
import type { TypedRoute } from "./typed-route";
export type WorkAdmission = { routeKey: string; fingerprint: RouteFingerprint };
/** The typed Work declaration is also the chat head's cell contract. */
export interface DiscoveredWork<W = any> {
  route: string;
  schema: z.ZodType<W>;
  cells: readonly CellsDecl<W>[];
  workFields: RouteGraph<any, W>["workFields"];
  admission?: WorkAdmission;
  memberKey?: true;
}
export interface RegisteredRoute {
  manifest: TypedRoute["data"];
  typed: TypedRoute;
  work?: DiscoveredWork;
  hosted(props: {
    thread: string;
    visible: boolean;
    target?: string;
    work?: string;
  }): import("react").ReactNode;
}
export type DiscoveredRoute = RegisteredRoute;
/** Typed Work describes its cell containers once; the chat head consumes the same schema. */
export function typedWorkCells(
  module: import("./typed-route").TypedRoute,
): readonly CellsDecl<any>[] {
  const work = module.spec.edits?.work;
  if (!work) return [];
  const unwrap = (schema: z.ZodType): z.ZodType =>
    "unwrap" in schema ? unwrap((schema as z.ZodOptional<z.ZodType>).unwrap()) : schema;
  const cell = (schema: z.ZodType) => {
    const value = unwrap(schema);
    return value instanceof z.ZodObject && Object.hasOwn(value.shape, "edit");
  };
  const focus = module.spec.fields.focus;
  return Object.entries(work.schema.shape).flatMap(([key, schema]): CellsDecl<any>[] => {
    const value = unwrap(schema as z.ZodType);
    // A family is a record of cells, or a fixed-key object of them (/ducts `criteria`: one cell per criterion and side).
    const fixed = value instanceof z.ZodObject && !cell(value) && Object.keys(value.shape).length > 0 &&
      Object.values(value.shape).every((s) => cell(s as z.ZodType));
    const segment = (value instanceof z.ZodRecord && cell(value.valueType as z.ZodType)) || fixed ? key : null;
    if (segment === null && !cell(value)) return [];
    return [
      {
        segment,
        ...(segment === null ? { key } : {}),
        groupOf: (id: string) => [id],
        noun: key,
        ...(focus
          ? {
              focus: (id: string): Record<string, string> =>
                focus.schema.safeParse(id).success ? { focus: id } : {},
            }
          : {}),
      },
    ];
  });
}

/** Verified typed modules are the only executable discovery registrations. */
export function createRouteDiscovery() {
  const registered = new Map<string, RegisteredRoute>();
  const listeners = new Set<() => void>();
  let revision = 0;
  const changed = () => {
    revision++;
    listeners.forEach((notify) => notify());
  };
  const entries = () => [...registered.values()];
  return Object.freeze({
    register(entry: RegisteredRoute) {
      const key = entry.typed.spec.key;
      if (key !== entry.manifest.key)
        throw Error("Registered declaration differs from its typed module");
      if (registered.has(key)) throw Error(`Route ${key} already registered`);
      registered.set(key, entry);
      changed();
      return () => {
        if (registered.get(key) !== entry) return;
        registered.delete(key);
        changed();
      };
    },
    typed: (key: string) => registered.get(key)?.typed ?? null,
    declaration: (key: string) => registered.get(key)?.typed.data ?? null,
    byAddress: (address: string) => entries().find((entry) => entry.typed.data.address === address),
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    revision: () => revision,
    entries,
    keys: () => [...registered.keys()],
    get: (key: string) => registered.get(key),
    /** The one route that declares this action; a kernel action several routes carry (findings.write) names none. */
    actionRoute(key: string) {
      const owners = entries().filter(({ typed }) =>
        Object.values(typed.spec.commands).some((verb) =>
          verb.entry === key || ("plan" in verb && verb.plan === key),
        ),
      );
      return owners.length === 1 ? owners[0]!.manifest.key : null;
    },
  });
}
/** Navigation and drawings share this one registry, independent of builtin source closures. */
export const publicRoutes = createRouteDiscovery();
