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
} from "@pe/host-contracts/operation-types";
import { nativeAxes, type CatalogAxes } from "./catalog.ts";
import type { SubjectKeyKind } from "./subject-ref.ts";
import { publicationSchema, type Publication } from "./value.ts";

import { effects, mint, type minted } from "./command-handle.ts";
export * from "./command-handle.ts";
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
const costs = ["Cheap", "Bounded", "Expensive", "Mutation"] as const;
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
// The mint alone restores a cached handle's keyed DTO types; storage keeps no unkeyed schema type.
const nativeHandles = new Map<CatalogReadKey, object>();
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
  if (made) return made as Minted;
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
    output: publicationSchema(data) as z.ZodType<Publication<NativeValue<K>>>,
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
  const def = schema._zod.def as {
    type: string;
    shape?: Record<string, z.ZodType>;
    innerType?: z.ZodType;
    left?: z.ZodType;
    right?: z.ZodType;
    options?: readonly z.ZodType[];
  };
  if (def.innerType) return rows(def.innerType, path);
  if (def.left && def.right) return rows(def.left, path) || rows(def.right, path);
  if (def.options) return def.options.some((option) => rows(option, path));
  const [head, ...rest] = path;
  if (head === undefined) return def.type === "array" || def.type === "record";
  const child = def.shape?.[head];
  return !!child && rows(child, rest);
}
const used = new WeakMap<ReadHandle<string, any, any>, readonly string[]>();
/** The keys a contract said it uses; the host joins them to bodies when the read registers. */
export const usesOf = (h: ReadHandle<string, any, any>): readonly string[] => used.get(h) ?? [];
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
    uses: readonly (ReadHandle<string, any, any> | CatalogReadKey)[];
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
    output: publicationSchema(def.data) as z.ZodType<Publication<D>>,
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
