/**
 * The Pod-facing read door (`@pe/host/read-graph`): what a Pod's host read imports by value.
 * Effect-free, the way `@pe/agent-contracts/subject-ref` is: a Pod artifact bundles only what it
 * imports, and the builder refuses an unpinned shared runtime (effect). Imports only zod and
 * effect-free subpaths; `tests/read-graph-door.test.ts` pins them. The evaluator imports from
 * here, never the reverse (the one edge back is the `ReadContext` type, erased).
 */
import { z } from "zod";
import { documentRefSchema, executionTargetSchema } from "@pe/agent-contracts/target";
import { workKeySchema } from "@pe/agent-contracts/route-state";
import { nativeOutputAssets, nativeOutputSchema, type NativeReadOutput } from "@pe/agent-contracts/native-output-read";
import { hostOpCatalog } from "@pe/host-contracts/catalog";
import { nativeRequestSchema } from "@pe/host-contracts/native-schemas";
import type { hostOpSafety } from "@pe/host-contracts/generated";
import type { HostOperationKey, OpRequestOf } from "@pe/host-contracts/operation-types";
import type { ReadContext } from "./evaluator.ts";
export type { ReadContext } from "./evaluator.ts";

export interface Read<I, O> {
  readonly name: string;
  readonly input: z.ZodType<I>;
  readonly output: z.ZodType<O>;
  readonly run: (ctx: ReadContext, args: I) => Promise<O> | O;
}
export const read = <I, O>(name: string, definition: Omit<Read<I, O>, "name">): Read<I, O> =>
  Object.freeze({ name, ...definition });
export interface Leaf<I, O> {
  readonly name: string;
  readonly input: z.ZodType<I>;
  readonly output: z.ZodType<O>;
  readonly leaf: true;
  /** Re-read this input before publication. Native bodies use their document mark instead. */
  readonly validate: boolean;
  readonly fence?: boolean;
  /** Content identity may exclude sampling telemetry; the full evidence still reaches the pane. */
  content?(value: O, args: I): unknown;
}
export const leaf = <I, O>(
  name: string,
  input: z.ZodType<I>,
  output: z.ZodType<O>,
  validate = true,
): Leaf<I, O> => Object.freeze({ name, input, output, leaf: true, validate });
/** Standard tracked Work inputs, shared by every host route. */
export const workScope=leaf("work-scope",documentRefSchema,workKeySchema,false);
export const workValue=z.object({doc:z.unknown(),revision:z.number()}).passthrough().nullable();
export const documentMark = {
  ...leaf(
    "document-mark",
    documentRefSchema,
    z.object({
      observedSince: z.number(),
      changedAt: z.number().nullable(),
      generation: z.number().int().nonnegative(),
    }),
  ),
  fence: true,
};
export const assetFile = leaf(
  "file:capture",
  z.string().regex(/^[0-9a-f]{64}$/),
  z.string().regex(/^[0-9a-f]{64}$/),
  false,
);
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
const role = z.enum(["acquire", "validate", "join", "beyond", "none"]);
export const nativeArgs = z.object({
  key: z.string(),
  request: z.unknown(),
  target: executionTargetSchema,
  version: z.string().optional(),
  // Retained ducts bodies name their role; every other read leaves it out.
  role: role.optional(),
});
export type NativeArgs<K extends HostOperationKey> = {
  request: OpRequestOf<K>;
  target: z.output<typeof executionTargetSchema>;
  version?: string;
  role?: z.output<typeof role>;
};
export type NativeValue<K extends HostOperationKey> = {
  body: NativeReadOutput<K>;
  version: string | null;
};
const nativeLeaf = leaf(
  "native",
  nativeArgs,
  z.object({ body: z.unknown(), version: z.string().nullable() }),
  false,
);
const natives = new Map<string, unknown>();
/** Refuses every key that is not a catalog Read, at the door and again at the port's native take. */
export function nativeRead<K extends HostOperationKey>(
  key: K,
): Read<NativeArgs<K>, NativeValue<K>> {
  if (natives.has(key)) return natives.get(key) as Read<NativeArgs<K>, NativeValue<K>>;
  const operation = hostOpCatalog.find((op) => op.key === key);
  if (
    !operation ||
    operation.intent !== "Read" ||
    !(operation.effect === "Read" || (operation.effect === "TransactRead" && operation.rollsBack))
  )
    throw Error(`Input is not a catalog Read/Read: ${key}`);
  const input = nativeArgs.omit({ key: true }).extend({ request: nativeRequestSchema(key) });
  const output = z.object({ body: nativeOutputSchema(key), version: z.string().nullable() });
  const handle = read(`input.native.${key}`, {
    input,
    output,
    async run(ctx, args) {
      const target = args.target;
      if (target.kind === "document") await ctx.read(documentMark, target.ref);
      const value = output.parse(await ctx.read(nativeLeaf, { ...args, key }));
      for (const sha of nativeOutputAssets(key, value.body)) await ctx.read(assetFile, sha);
      return value;
    },
  });
  natives.set(key, handle);
  return handle as Read<NativeArgs<K>, NativeValue<K>>;
}
/** A firm owner names one file under the firm root; no separators, so no path escapes it. */
export const firmOwner = z.string().regex(/^[a-z0-9][a-z0-9.-]*$/i);
/** No shared root (slice 2b, ADR 0035 rule 11): the firm file has no home, so its read refuses. */
const noSharedRoot = z.strictObject({ refused: z.literal("no-shared-root") });
/** The file as read: absent (no json), unreadable or malformed (error), its parsed JSON, or refused. */
export const firmFileSchema = z.union([
  z.strictObject({
    path: z.string(),
    json: z.unknown().optional(),
    error: z.string().optional(),
  }),
  noSharedRoot,
]);
export type FirmFile = z.output<typeof firmFileSchema>;
/** The decoded layer, or the refusal: a reader that runs anyway runs on its named seed and says so. */
export type FirmValue<T> =
  | {
      firm: T;
      path: string;
      /** False when the seed stands in; `error` says why when the file exists and was not used. */
      present: boolean;
      error?: string;
    }
  | z.output<typeof noSharedRoot>;
/** The firm file layer (ADR 0026): `Firm/<owner>.json` as read, before `resolveFirm` decodes it. */
export const firm = leaf("file:firm", firmOwner, firmFileSchema);
/** Each value carries its source: the firm file when it decodes, else the engine default (seed). */
export function resolveFirm<T>(file: FirmFile, schema: z.ZodType<T>, seed: T): FirmValue<T> {
  if ("refused" in file) return file;
  const fallback = (error?: string) => ({
    firm: seed,
    path: file.path,
    present: false,
    ...(error === undefined ? {} : { error }),
  });
  if (file.error !== undefined) return fallback(file.error);
  if (!("json" in file)) return fallback();
  const parsed = schema.safeParse(file.json);
  return parsed.success
    ? { firm: parsed.data, path: file.path, present: true }
    : fallback(parsed.error.message);
}
