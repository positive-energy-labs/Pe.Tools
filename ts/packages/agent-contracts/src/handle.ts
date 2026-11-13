/**
 * Handles (ADR 0042): the one minted name for a command or a read. Frozen before wave 0 of kernel
 * crusade 2 (docs/features/routes/CONTRACTS.md, "Handles, reads, bindings, projection"). The shapes
 * are final; `handle()` reads K1's generated table, K3 fills `contract()`.
 */
import { z } from "zod";
import { hostOpCatalog } from "@pe/host-contracts/catalog";
import { nativeRequestSchema, nativeResponseSchema } from "@pe/host-contracts/native-schemas";
import type { hostOpSafety } from "@pe/host-contracts/generated";
import type {
  HostOperationKey,
  OpRequestOf,
  OpResponseOf,
} from "@pe/host-contracts/operation-types";
import type { PeRouteInput, PeRouteOutput } from "@pe/host-contracts/pe-api";
import type { CatalogAxes } from "./catalog.ts";
import { commandTable, type CommandKey } from "./command-axes.ts";
import { nativeEntry, type httpRoutes } from "./pe-api.ts";
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
export type InputOf<H> = H extends CommandHandle<string, infer I> ? I : never;

type Commands = typeof hostActions;
type Routes = typeof httpRoutes;
type Row<K extends CommandKey> = (typeof commandTable)[K];
/** The generated table (K1) names every key: semantic commands, raw native commands, pe-api routes. */
export type { CommandKey };
/** A semantic command's own schema first, then the native DTO, then the pe-api route. */
export type CommandInput<K extends CommandKey> = K extends keyof Commands
  ? z.input<Commands[K]["input"]>
  : K extends HostOperationKey
    ? OpRequestOf<K>
    : K extends keyof Routes
      ? PeRouteInput<Routes, K>
      : unknown;
export type CommandOutput<K extends CommandKey> = K extends keyof Commands
  ? Commands[K] extends { result: z.ZodType }
    ? z.output<Commands[K]["result"]>
    : unknown
  : K extends HostOperationKey
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
export function handle<K extends CommandKey>(
  key: K,
): CommandHandle<K, CommandInput<K>, CommandOutput<K>, CommandEffect<K>> &
  Planned<K, CommandInput<K>> {
  type Minted = ReturnType<typeof handle<K>>;
  const made = commandHandles.get(key);
  if (made) return made as Minted;
  if (!Object.hasOwn(commandTable, key)) throw Error(`No command or route: ${key}`);
  const row: { effect: string; via: CommandHandle["via"]; plan?: string } = commandTable[key];
  if (!(effects as readonly string[]).includes(row.effect))
    throw Error(`${key} declares no Effect`);
  const result = mint<CommandHandle>({
    key,
    effect: row.effect as Effect,
    via: row.via,
    ...(row.plan
      ? { plan: handle(row.plan as CommandKey) as CommandHandle<string, unknown, unknown, "Read" | "TransactRead"> }
      : {}),
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
const nativeHandles = new Map<string, ReadHandle>();
/** A catalog Read as a handle; refuses every other key, as the host's native door does. */
export function native<K extends CatalogReadKey>(
  key: K,
): ReadHandle<K, OpRequestOf<K>, OpResponseOf<K>> {
  type Minted = ReadHandle<K, OpRequestOf<K>, OpResponseOf<K>>;
  const made = nativeHandles.get(key);
  if (made) return made as unknown as Minted;
  const op = hostOpCatalog.find((op) => op.key === key);
  if (
    !op ||
    op.intent !== "Read" ||
    !(op.effect === "Read" || (op.effect === "TransactRead" && op.rollsBack))
  )
    throw Error(`Not a catalog Read: ${key}`);
  const { subject, touches, effect, cost, cardinality, rollsBack } = nativeEntry(op);
  const data = nativeResponseSchema(key);
  const result = mint<Minted>({
    key,
    input: nativeRequestSchema(key),
    data,
    output: publicationSchema(data) as z.ZodType<Publication<OpResponseOf<K>>>,
    axes: { subject, touches, effect, cost, cardinality, ...(rollsBack ? { rollsBack } : {}) },
    keyedBy: {},
  });
  nativeHandles.set(key, result as unknown as ReadHandle);
  return result;
}

const highest = <T extends string>(order: readonly string[], values: readonly T[], floor: T) =>
  values.reduce((a, b) => (order.indexOf(b) > order.indexOf(a) ? b : a), floor);
/** A route read's contract: schemas the browser and the host share, axes joined from what it uses. */
export function contract<K extends string, I, D>(
  key: K,
  def: {
    input: z.ZodType<I>;
    data: z.ZodType<D>;
    uses: readonly (ReadHandle<string, any, any> | CatalogReadKey)[];
    keyedBy?: Readonly<Record<string, RowKey>>;
    demand?: "mount" | "explicit";
  },
): ReadHandle<K, I, D> {
  const uses = def.uses.map((use) => (typeof use === "string" ? native(use).axes : use.axes));
  const touches = [...new Set(uses.flatMap((axes) => axes.touches))];
  return mint<ReadHandle<K, I, D>>({
    key,
    input: def.input,
    data: def.data,
    output: publicationSchema(def.data) as z.ZodType<Publication<D>>,
    // A read that uses nothing native keeps the axes `valueRead` gave every host read.
    axes: {
      subject: uses[0]?.subject ?? "Document",
      touches: touches.length ? touches : ["Metadata"],
      effect: highest(effects, uses.map((axes) => axes.effect), "Read"),
      cost: highest(costs, uses.map((axes) => axes.cost), "Cheap"),
      cardinality: "One",
      ...(uses.some((axes) => axes.rollsBack) ? { rollsBack: true } : {}),
    },
    keyedBy: def.keyedBy ?? {},
    ...(def.demand ? { demand: def.demand } : {}),
  });
}
