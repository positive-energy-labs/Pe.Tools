/**
 * Handles (ADR 0042): the one minted name for a command or a read. Frozen before wave 0 of kernel
 * crusade 2 (docs/features/routes/CONTRACTS.md, "Handles, reads, bindings, projection"). The shapes
 * are final; `handle()` reads K1's generated table, K3 fills `contract()`.
 */
import { z } from "zod";
import { hostOpCatalog } from "@pe/host-contracts/catalog";
import type { hostOpSafety } from "@pe/host-contracts/generated";
import { nativeReadInput, nativeReadValue, type NativeArgs, type NativeValue } from "./native-output-read.ts";
import type {
  HostOperationKey,
  OpKey,
  OpRequestOf,
  OpResponseOf,
} from "@pe/host-contracts/operation-types";
import type { PeRouteInput, PeRouteOutput } from "@pe/host-contracts/pe-api";
import { nativeAxes, type CatalogAxes } from "./catalog.ts";
import { commandTable, type CommandKey } from "./command-axes.ts";
import type { httpRoutes } from "./pe-api.ts";
import type { hostActions } from "./semantic-actions.ts";
import type { SubjectKeyKind } from "./subject-ref.ts";
import { publicationSchema, type Publication } from "./value.ts";

export type Effect = "Read" | "TransactRead" | "SessionWrite" | "WorkWrite" | "ModelWrite";
declare const minted: unique symbol;
export interface CommandHandle<
  K extends string = string,
  I = unknown,
  O = unknown,
  E extends Effect = Effect,
> {
  readonly [minted]: true;
  readonly key: K;
  readonly effect: E;
  readonly plan?: CommandHandle<string, I, unknown, "Read" | "TransactRead">;
  /** K6: the door picks the transport from this. */
  readonly via: "command" | { route: string };
  /** Type only: no schema reaches the browser through a command handle. */
  readonly _input?: I;
  readonly _output?: O;
}
export type RowKey = { kind: SubjectKeyKind; sub?: "port" | "field" };
export interface ReadHandle<K extends string = string, I = unknown, D = unknown> {
  readonly [minted]: true;
  readonly key: K;
  readonly input: z.ZodType<I>;
  /** Not in the frozen text: the host's `body()` decodes a body's result with it. */
  readonly data: z.ZodType<D>;
  readonly output: z.ZodType<Publication<D>>;
  /** Joined from `uses`: effect max, cost max, touches union. */
  readonly axes: CatalogAxes;
  /** Dotted collection path to its row key; an unnamed collection is unkeyed. */
  readonly keyedBy: Readonly<Record<string, RowKey>>;
  readonly demand?: "mount" | "explicit";
}
/** A read handle with its input and data erased: what a registry or a `uses` list holds. */
export type AnyReadHandle = Pick<ReadHandle, typeof minted | "key" | "axes">;
export type InputOf<H> = H extends CommandHandle<string, infer I> ? I : never;

type Commands = typeof hostActions;
type Routes = typeof httpRoutes;
type Row<K extends CommandKey> = (typeof commandTable)[K];
/** The generated table (K1) names every key: semantic commands, raw native commands, pe-api routes. */
export type { CommandKey };
/** A semantic command's own schema first, then the native DTO, then the pe-api route. */
export type CommandInput<K extends CommandKey> = K extends keyof Commands
  ? z.input<Commands[K]["input"]>
  : K extends OpKey
    ? OpRequestOf<K>
    : K extends keyof Routes
      ? PeRouteInput<Routes, K>
      : unknown;
export type CommandOutput<K extends CommandKey> = K extends keyof Commands
  ? Commands[K] extends { result: z.ZodType }
    ? z.output<Commands[K]["result"]>
    : unknown
  : K extends OpKey
    ? OpResponseOf<K>
    : K extends keyof Routes
      ? PeRouteOutput<Routes, K>
      : unknown;
export type CommandEffect<K extends CommandKey> = Extract<Row<K>["effect"], Effect>;
/** A sealed write's plan is required on its handle, so a verb declaration can demand `present`. */
type Planned<K extends CommandKey, I> = Row<K> extends { plan: string }
  ? { readonly plan: CommandHandle<string, I, unknown, "Read" | "TransactRead"> }
  : unknown;

const effects = ["Read", "TransactRead", "SessionWrite", "WorkWrite", "ModelWrite"] as const;
const costs = ["Cheap", "Bounded", "Expensive", "Mutation"] as const;
const mint = <H>(shape: Omit<H, typeof minted>) => Object.freeze(shape) as H;
const commandHandles = new Map<string, CommandHandle>();
const isPlan = (command: CommandHandle): command is CommandHandle<string, unknown, unknown, "Read" | "TransactRead"> =>
  command.effect === "Read" || command.effect === "TransactRead";
export function handle<K extends CommandKey>(
  key: K,
): CommandHandle<K, CommandInput<K>, CommandOutput<K>, CommandEffect<K>> &
  Planned<K, CommandInput<K>> {
  type Minted = ReturnType<typeof handle<K>>;
  const made = commandHandles.get(key);
  if (made) return made as Minted;
  if (!Object.hasOwn(commandTable, key)) throw Error(`No command or route: ${key}`);
  const row = commandTable[key];
  const plan = "plan" in row ? handle(row.plan) : undefined;
  if (plan && !isPlan(plan)) throw Error(`${key} declares a plan that writes`);
  const result = mint<CommandHandle>({
    key,
    effect: row.effect,
    via: row.via,
    ...(plan ? { plan } : {}),
  });
  commandHandles.set(key, result);
  return result as Minted;
}

type Safety = typeof hostOpSafety;
/** Read intent, and Read effect or a rolled-back TransactRead: the keys a read may take. */
export type CatalogReadKey = {
  [K in keyof Safety]: Safety[K] extends { intent: "Read" } & (
    | { effect: "Read" }
    | { effect: "TransactRead"; rollsBack: true }
  )
    ? K
    : never;
}[keyof Safety] &
  HostOperationKey;
// Only `native()` writes this table, under the handle's own key, so the key says which handle it is.
const nativeHandles = new Map<string, AnyReadHandle>();
const mintedFor = <K extends CatalogReadKey>(
  h: AnyReadHandle | undefined,
  key: K,
): h is ReadHandle<K, NativeArgs<K>, NativeValue<K>> => h?.key === key;
/**
 * A catalog Read as a handle; refuses every other key, as the host's native door does. Its input is
 * the native read's whole input (request, target, and a retained body's version and role) and its
 * data is `{ body, version }`, so `ctx.read(native(key), args)` is the one native door.
 */
export function native<K extends CatalogReadKey>(
  key: K,
): ReadHandle<K, NativeArgs<K>, NativeValue<K>> {
  type Minted = ReadHandle<K, NativeArgs<K>, NativeValue<K>>;
  const made = nativeHandles.get(key);
  if (mintedFor(made, key)) return made;
  const op = hostOpCatalog.find((op) => op.key === key);
  if (
    !op ||
    op.intent !== "Read" ||
    !(op.effect === "Read" || (op.effect === "TransactRead" && op.rollsBack))
  )
    throw Error(`Not a catalog Read: ${key}`);
  const { subject, touches, effect, cost, cardinality, rollsBack } = nativeAxes(op);
  const data = nativeReadValue(key);
  const result = mint<Minted>({
    key,
    input: nativeReadInput(key),
    data,
    output: publicationSchema(data),
    axes: { subject, touches, effect, cost, cardinality, ...(rollsBack ? { rollsBack } : {}) },
    keyedBy: {},
  });
  nativeHandles.set(key, result);
  return result;
}

const highest = <T extends string>(order: readonly string[], values: readonly T[], floor: T) =>
  values.reduce((a, b) => (order.indexOf(b) > order.indexOf(a) ? b : a), floor);
/** Whether a dotted path names a row collection (an array or a record) in a data schema. */
function rows(schema: z.ZodType, path: readonly string[]): boolean {
  // The public `def`, read member by member and checked: a wrapper has `innerType`, an intersection
  // `left` and `right`, a union `options`, an object `shape`. A member that is no schema is not followed.
  const def = schema.def;
  const part = (name: string): unknown => Reflect.get(def, name);
  const within = (child: unknown) => child instanceof z.ZodType && rows(child, path);
  if (part("innerType") !== undefined) return within(part("innerType"));
  if (part("left") !== undefined) return within(part("left")) || within(part("right"));
  const options = part("options");
  if (Array.isArray(options)) return options.some(within);
  const [head, ...rest] = path;
  if (head === undefined) return def.type === "array" || def.type === "record";
  const shape = part("shape");
  const child: unknown = typeof shape === "object" && shape !== null ? Reflect.get(shape, head) : undefined;
  return child instanceof z.ZodType && rows(child, rest);
}
const used = new WeakMap<AnyReadHandle, readonly string[]>();
/** The keys a contract said it uses; the host joins them to bodies when the read registers. */
export const usesOf = (h: AnyReadHandle): readonly string[] => used.get(h) ?? [];
/**
 * A route read's contract: schemas the browser and the host share, axes joined from what it uses.
 * `input` is the host's input, `target` included; the browser door supplies `target` from the mount.
 * Effect, cost and touches join. Subject and cardinality do not: a read with no document says so
 * with `subject`, and otherwise it is one value about the Document.
 */
export function contract<K extends string, I, D>(
  key: K,
  def: {
    input: z.ZodType<I>;
    data: z.ZodType<D>;
    uses: readonly (AnyReadHandle | CatalogReadKey)[];
    subject?: CatalogAxes["subject"];
    keyedBy?: Readonly<Record<string, RowKey>>;
    demand?: "mount" | "explicit";
  },
): ReadHandle<K, I, D> {
  const handles = def.uses.map((use) => (typeof use === "string" ? native(use) : use));
  const uses = handles.map((use) => use.axes);
  const touches = [...new Set(uses.flatMap((axes) => axes.touches))];
  for (const path of Object.keys(def.keyedBy ?? {}))
    if (!rows(def.data, path.split(".")))
      throw Error(`Read '${key}' keys '${path}', which is no row collection in its data`);
  const made = mint<ReadHandle<K, I, D>>({
    key,
    input: def.input,
    data: def.data,
    output: publicationSchema(def.data),
    // A read that uses nothing native keeps the axes `valueRead` gave every host read.
    axes: {
      subject: def.subject ?? "Document",
      touches: touches.length ? touches : ["Metadata"],
      effect: highest(effects, uses.map((axes) => axes.effect), "Read"),
      cost: highest(costs, uses.map((axes) => axes.cost), "Cheap"),
      cardinality: "One",
      ...(uses.some((axes) => axes.rollsBack) ? { rollsBack: true } : {}),
    },
    keyedBy: def.keyedBy ?? {},
    ...(def.demand ? { demand: def.demand } : {}),
  });
  used.set(made, handles.map((use) => use.key));
  return made;
}
