import { createHash } from "node:crypto";
import { z } from "zod";
import {
  canonicalRouteInput as canonicalJson,
  workKey,
  workKeySchema,
  type WorkKey,
} from "@pe/agent-contracts";
import { documentRefSchema } from "@pe/agent-contracts/target";
import type { SettingTierRead } from "@pe/agent-contracts/tiered-setting";
import type { ReadHandle } from "@pe/agent-contracts/handle";
import {
  bodyOf,
  firm as firmFile,
  settingsFile,
  firmOwner,
  leaf,
  nativeRead,
  resolveFirm,
  workScope,
  type CatalogReadKey,
  type FirmValue,
  type Leaf,
  type NativeArgs,
  type NativeValue,
  type Read,
} from "./door.ts";
// The Pod-facing half (read, leaf, workScope, nativeRead, the firm layer) is the effect-free door.
export * from "./door.ts";

export const fingerprint = (data: unknown) =>
  createHash("sha256")
    .update(canonicalJson([data]))
    .digest("hex");
/** Values have wire semantics. Classes, cycles and non-finite numbers cannot hide behind JSON. */
const wireValue = <T>(value: T): T => {
  const ancestors = new Set<object>();
  const check = (item: unknown, optional = false): void => {
    if (item === undefined && optional) return;
    if (item === null || typeof item === "string" || typeof item === "boolean") return;
    if (typeof item === "number" && Number.isFinite(item)) return;
    if (typeof item !== "object" || item === null) throw Error("Read input or output is not JSON");
    if (ancestors.has(item)) throw Error("Read input or output is cyclic");
    if (
      !Array.isArray(item) &&
      Object.getPrototypeOf(item) !== Object.prototype &&
      Object.getPrototypeOf(item) !== null
    )
      throw Error("Read input or output contains a non-JSON object");
    ancestors.add(item);
    if (Array.isArray(item)) for (const child of item) check(child);
    else for (const child of Object.values(item)) check(child, true);
    ancestors.delete(item);
  };
  check(value);
  return JSON.parse(JSON.stringify(value));
};
const schemaIds = new WeakMap<z.ZodType, string>();
export const schemaId = (schema: z.ZodType) => {
  let id = schemaIds.get(schema);
  if (!id) {
    id = fingerprint(
      z.toJSONSchema(schema, {
        unrepresentable: "any",
        override({ zodSchema, jsonSchema }) {
          const def = zodSchema._zod.def;
          // Undefined can occur inside generated optional DTO fields. Preserve its schema identity;
          // wireValue still rejects every non-JSON runtime value before it can become data.
          jsonSchema["x-pe-zod-type"] = def.type;
          const functions = (value: object) =>
            Object.values(value)
              .filter((value) => typeof value === "function")
              .map(String);
          jsonSchema["x-pe-functions"] = functions(def);
          if ("checks" in def && def.checks)
            jsonSchema["x-pe-checks"] = def.checks.map((check) => functions(check._zod.def));
        },
      }),
    );
    schemaIds.set(schema, id);
  }
  return id;
};
export const immutable = <T>(value: T): T => {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) immutable(child);
    Object.freeze(value);
  }
  return value;
};
export interface Trace {
  readonly recipe: string;
  readonly name: string;
  readonly args: unknown;
  readonly outcome: "answered" | "refused";
  readonly hash?: string;
  readonly error?: string;
}
export interface Coverage {
  readonly requested: readonly string[];
  readonly covered: readonly string[];
  readonly unknown: readonly string[];
  readonly refused: readonly { keys: readonly string[]; reason: string }[];
}
export interface Value<T> {
  readonly data: T;
  readonly evaluation: string;
  readonly inputs: string;
  readonly works: readonly WorkKey[];
  readonly trace: readonly Trace[];
  readonly coverage: Coverage;
  readonly origin: unknown;
  readonly freshness: "current" | "refresh-needed";
}
export interface InputPort {
  readonly evaluation: string;
  readonly origin: unknown;
  /** `signal` is the read's own lifetime: aborted when its last subscriber released. Never a write's or a restoration's. */
  readonly take: (
    name: string,
    args: unknown,
    context?: ReadContext,
    signal?: AbortSignal,
  ) => Promise<unknown>;
  /** Synchronous event revision: also fences a change while final validation is awaiting I/O. */
  readonly revision: (name: string, args: unknown) => number;
}
export class RefreshNeeded extends Error {
  constructor(
    message: string,
    readonly input?: string,
  ) {
    super(message);
  }
}
export class RefusedPartition extends Error {}
/** A lasting refusal's reason reaches the pane, so it names the input in words, never its args as JSON. */
const moved = (name: string, args: unknown, when = "while this was being read") =>
  `The ${name === "resource" && typeof args === "object" && args && "kind" in args ? String(args.kind) : name} input changed ${when}.`;
export interface ReadContext {
  /** By handle: the registry resolves the body by key. By body or leaf until the route reads are converted (k2/read-sweep). */
  read<I, D>(h: ReadHandle<string, I, D>, args: I): Promise<D>;
  read<I, O>(read: Read<I, O> | Leaf<I, O>, args: I): Promise<O>;
  /** Work by key, or a target document's Work for `owner` given its document ref (a Pod's door: no module import). */
  work(owner: string, scope: unknown): Promise<unknown>;
  /** The one native door: any catalog Read, typed and decoded by the host's generated catalog. */
  native<K extends CatalogReadKey>(key: K, args: NativeArgs<K>): Promise<NativeValue<K>>;
  /** The read side of the store: each is a recorded, invalidated input, never a plain file read. */
  readonly files: {
    /** The firm file layer (ADR 0026): the firm's per-owner `<owner>.json` decoded by `schema`, else `seed` with why. */
    firm<T>(owner: string, schema: z.ZodType<T>, seed: T): Promise<FirmValue<T>>;
    /** Every home tier's per-owner settings file for the target model (ADR 0037 rule 8), most specific first. */
    tiers(
      owner: string,
      target: z.output<typeof documentRefSchema> | null,
    ): Promise<SettingTierRead[]>;
  };
  collect<K, I, O>(
    keys: readonly K[],
    options: {
      read: Read<I, O> | Leaf<I, O>;
      args: (keys: readonly K[]) => I;
      batch: number;
      key?: (key: K) => string;
      covered: (value: O) => readonly K[];
    },
  ): Promise<readonly O[]>;
  compute<I, O>(schema: z.ZodType<O>, inputs: I, pure: (inputs: I) => O): O;
}
export const workInput = leaf(
  "work",
  z.object({ owner: z.string(), scope: z.unknown() }),
  z.unknown(),
);

/** A recipe executes once per evaluation; input starts are owned by the real input services. */
export async function evaluate<I, O>(
  definition: Read<I, O>,
  input: I,
  port: InputPort,
): Promise<Value<O>> {
  const memo = new Map<string, Promise<unknown>>();
  let closed = false;
  const trace: Trace[] = [];
  const works = new Map<string, WorkKey>();
  const checks = new Map<
    string,
    { definition: Leaf<unknown, unknown>; args: unknown; hash: string; revision: number }
  >();
  const requested = new Set<string>(),
    covered = new Set<string>(),
    refused: { keys: string[]; reason: string }[] = [];
  const reason = (error: unknown) => (error instanceof Error ? error.message : String(error));
  const ctx: ReadContext = {
    read: <A, B>(
      named: Read<A, B> | Leaf<A, B> | ReadHandle<string, A, B>,
      input: A,
    ): Promise<B> => {
      if (closed) return Promise.reject(Error("This evaluation is closed"));
      let definition: Read<A, B> | Leaf<A, B>;
      try {
        definition = "key" in named ? bodyOf(named) : named;
      } catch (error) {
        return Promise.reject(error);
      }
      const args = immutable(wireValue(definition.input.parse(input)));
      if ("leaf" in definition && definition.name === workInput.name) {
        const { owner, scope } = workInput.input.parse(args);
        const member = workKeySchema.parse({ ...workKeySchema.parse(scope), route: owner });
        works.set(workKey(member), member);
      }
      const recipe = fingerprint([
        definition.name,
        args,
        "leaf" in definition ? "input" : definition.run.toString(),
        schemaId(definition.input),
        schemaId(definition.output),
      ]);
      const previous = memo.get(recipe);
      if (previous) return previous as Promise<B>;
      if (memo.size >= 512) return Promise.reject(Error("Read graph exceeds 512 recipes"));
      const revision = "leaf" in definition ? port.revision(definition.name, args) : 0;
      const pending = Promise.resolve().then(async () => {
        try {
          const raw =
            "leaf" in definition
              ? await port.take(definition.name, args, ctx)
              : await definition.run(ctx, args);
          const data = immutable(wireValue(definition.output.parse(raw)));
          const hash = fingerprint(
            "leaf" in definition && definition.content ? definition.content(data, args) : data,
          );
          trace.push({ recipe, name: definition.name, args, outcome: "answered", hash });
          if ("leaf" in definition) {
            if (port.revision(definition.name, args) !== revision)
              throw new RefreshNeeded(moved(definition.name, args), definition.name);
            if (definition.validate) checks.set(recipe, { definition, args, hash, revision });
          }
          return data;
        } catch (error) {
          trace.push({
            recipe,
            name: definition.name,
            args,
            outcome: "refused",
            error: reason(error),
          });
          throw error;
        }
      });
      memo.set(recipe, pending);
      return pending;
    },
    work: async (owner, scope) => {
      const document = documentRefSchema.safeParse(scope);
      const key = document.success
        ? { ...(await ctx.read(workScope, document.data)), route: owner }
        : scope;
      const member = workKeySchema.parse({ ...workKeySchema.parse(key), route: owner });
      return ctx.read(workInput, { owner, scope: member });
    },
    native: (key, args) => ctx.read(nativeRead(key), args),
    files: {
      firm: async (owner, schema, seed) =>
        resolveFirm(await ctx.read(firmFile, firmOwner.parse(owner)), schema, seed),
      tiers: (owner, target) => ctx.read(settingsFile, { owner: firmOwner.parse(owner), target }),
    },
    collect: async (keys, options) => {
      if (!Number.isSafeInteger(options.batch) || options.batch < 1)
        throw Error("Batch must be a positive integer");
      const results = [];
      for (let start = 0; start < keys.length; start += options.batch) {
        const partition = keys.slice(start, start + options.batch);
        const names = partition.map(options.key ?? String);
        names.forEach((key) => requested.add(key));
        try {
          const result = await ctx.read(options.read, options.args(partition));
          results.push(result);
          const actual = options.covered(result).map(options.key ?? String);
          if (actual.some((key) => !names.includes(key)))
            throw Error("A batch claimed keys outside its partition");
          actual.forEach((key) => covered.add(key));
        } catch (error) {
          // Only explicit native refusals are coverage. Unknown/failed/missing inputs abort the read.
          if (!(error instanceof RefusedPartition)) throw error;
          refused.push({ keys: names, reason: reason(error) });
        }
      }
      return results;
    },
    compute: (schema, inputs, pure) => {
      if (closed) throw Error("This evaluation is closed");
      const recipe = fingerprint(["compute", schemaId(schema), pure.toString(), inputs]);
      const data = immutable(wireValue(schema.parse(pure(immutable(inputs)))));
      trace.push({
        recipe,
        name: "compute",
        args: { inputs: fingerprint(inputs) },
        outcome: "answered",
        hash: fingerprint(data),
      });
      return data;
    },
  };
  let data: O;
  try {
    data = await ctx.read(definition, input);
  } finally {
    // Started reads belong to this evaluation even when an author forgot to await one.
    let settled = -1;
    while (settled !== memo.size) {
      settled = memo.size;
      await Promise.allSettled([...memo.values()]);
    }
    closed = true;
  }
  for (const check of [...checks.values()].sort(
    (a, b) => Number(!!a.definition.fence) - Number(!!b.definition.fence),
  )) {
    const current = check.definition.output.parse(
      await port.take(check.definition.name, check.args),
    );
    const hash = fingerprint(
      check.definition.content ? check.definition.content(current, check.args) : current,
    );
    trace.push({
      recipe: fingerprint([check.definition.name, check.args, "validation"]),
      name: check.definition.name,
      args: check.args,
      outcome: "answered",
      hash,
    });
    if (hash !== check.hash)
      throw new RefreshNeeded(moved(check.definition.name, check.args), check.definition.name);
  }
  for (const check of checks.values())
    if (port.revision(check.definition.name, check.args) !== check.revision)
      throw new RefreshNeeded(
        moved(check.definition.name, check.args, "before this could be shown"),
        check.definition.name,
      );
  const dependencies = trace.sort(
    (a, b) => a.recipe.localeCompare(b.recipe) || a.outcome.localeCompare(b.outcome),
  );
  const value: Value<O> = {
    data,
    // Connection/recording identity belongs in inputs, not sealed-input freshness (ADR 0033).
    // Caller admission and Work revision remain enforced by the write seal at Apply.
    evaluation: fingerprint([dependencies, data]),
    inputs: port.evaluation,
    works: [...works.values()].sort((a, b) => workKey(a).localeCompare(workKey(b))),
    trace: dependencies,
    coverage: {
      requested: [...requested].sort(),
      covered: [...covered].sort(),
      refused,
      unknown: [...requested]
        .filter((key) => !covered.has(key) && !refused.some((part) => part.keys.includes(key)))
        .sort(),
    },
    origin: port.origin,
    freshness: "current",
  };
  if (Buffer.byteLength(JSON.stringify(value)) > 32 * 1024 * 1024)
    throw Error("Read Value exceeds the 32 MiB bound; data was not clipped");
  return immutable(value);
}
