import { z } from "zod";
import { listSearchSchema } from "../../../agent-contracts/src/list-search.ts";
import {
  field,
  route as declareRoute,
  type Specification,
  type QueryFields,
  type DrawContext,
  type Fields,
  type ReadData,
  type VerbHandle,
} from "./typed-route.ts";
import type { CommandHandle } from "@pe/agent-contracts/handle";
import type { HostRead } from "./host-read.ts";
export * from "./typed-route.ts";
/** A picture is declared with these; the pose fields (`picturePose`) come with `./typed-route`. */
export type { Mark, PictureScope, PictureSlot } from "@pe/agent-contracts/slots";

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
export type ContextOf<
  F extends Fields,
  R = never,
  W = never,
  E = never,
  /** The verbs the body asks for (`Verbs<run ids, plan ids>`); the route must declare each. */
  V extends Readonly<Record<string, VerbHandle>> = {},
> = DrawContext<
  R extends HostRead ? ReadData<R> : never,
  F,
  WorkOf<W>,
  E extends z.ZodType ? z.output<E> : never,
  V
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
  const V extends Readonly<Record<string, CommandHandle>> = {},
>(spec: Specification<D, F, W, Edit, Reads, SubjectRead, Q, V>) {
  const panes = Object.fromEntries(
    Object.entries(spec.panes).map(([id, pane]) => [id, { ...pane, read: pane.read ?? spec.core }]),
  ) as typeof spec.panes;
  return declareRoute({ ...spec, panes });
}

