import { z } from "zod";
import { listSearchSchema } from "../../../../packages/agent-contracts/src/list-search.ts";
import {
  field,
  route as declareRoute,
  type Specification,
  type QueryFields,
  type DrawContext,
  type Fields,
  type ReadData,
} from "./typed-route";
import type { HostRead } from "./host-read";
export * from "./typed-route";

/** Mechanical Page policy; names and their product meaning remain at the call site. */
export const listFields = <const P extends string>(prefix: P) =>
  ({
    [`${prefix}Search`]: searchField(),
    [`${prefix}Sort`]: sortField(),
  }) as { [K in `${P}Search`]: ReturnType<typeof searchField> } & {
    [K in `${P}Sort`]: ReturnType<typeof sortField>;
  };
const searchField = () => field(listSearchSchema, { keywords: "", pills: [], v: 1 }, "query");
const sortField = () => field(z.enum(["", "name"]), "", "query");
export const stageField = <const S extends readonly [string, ...string[]]>(stages: S) =>
  field(z.enum(stages), stages[0], "stage", "push");
export const paneLayout = (id: string) => ({ kind: "pane" as const, id });
export const read = <R extends HostRead, P>(
  handle: R,
  args: (page: P) => unknown = () => ({}),
) => ({ ...handle, args });
type WorkOf<T> = T extends { schema: infer S extends z.ZodType }
  ? z.output<S>
  : T extends z.ZodType
    ? z.output<T>
    : never;
/** Infer from independent declarations: drawing imports cannot form a module inference cycle. */
export type ContextOf<F extends Fields, R = never, W = never, E = never> = DrawContext<
  R extends HostRead ? ReadData<R> : never,
  F,
  WorkOf<W>,
  E extends z.ZodType ? z.output<E> : never
>;

/** A pane draws the core Value unless it explicitly names another read. */
export function route<
  D,
  const F extends Fields,
  W extends z.ZodObject,
  Edit extends z.ZodType,
  const Reads extends Readonly<Record<string, HostRead>>,
  SubjectRead extends HostRead,
  const Q extends QueryFields = {},
>(spec: Specification<D, F, W, Edit, Reads, SubjectRead, Q>) {
  const panes = Object.fromEntries(
    Object.entries(spec.panes).map(([id, pane]) => [id, { ...pane, read: pane.read ?? spec.core }]),
  ) as typeof spec.panes;
  return declareRoute({ ...spec, panes });
}

/** Reuse a declared field group's schemas, defaults and history policy; the route picks its keys. */
export function poseFields<
  const F extends Record<string, { schema: z.ZodType; url?: "push" | "replace" }>,
  const K extends keyof F,
>(group: F, keys: readonly K[]) {
  return Object.fromEntries(
    keys.map((key) => [
      key,
      field(group[key].schema, group[key].schema.parse(undefined), "pose", group[key].url),
    ]),
  ) as {
    [P in K]: {
      schema: F[P]["schema"];
      initial: z.output<F[P]["schema"]>;
      role: "pose";
      url: "push" | "replace";
    };
  };
}
