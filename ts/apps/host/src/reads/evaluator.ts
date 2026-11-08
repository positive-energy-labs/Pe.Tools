import { createHash } from "node:crypto";
import { z } from "zod";
import { documentRefSchema, workKeySchema, canonicalRouteInput as canonicalJson } from "@pe/agent-contracts";

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
const schemaId = (schema: z.ZodType) => {
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
  readonly trace: readonly Trace[];
  readonly coverage: Coverage;
  readonly origin: unknown;
  readonly freshness: "current" | "refresh-needed";
}
export interface InputPort {
  readonly evaluation: string;
  readonly origin: unknown;
  readonly take: (name: string, args: unknown, context?:ReadContext) => Promise<unknown>;
  /** Synchronous event revision: also fences a change while final validation is awaiting I/O. */
  readonly revision: (name: string, args: unknown) => number;
}
export class RefreshNeeded extends Error {}
export class RefusedPartition extends Error {}
const inputLabel = (name: string, args: unknown) => `${name} ${canonicalJson(args)}`;
export interface ReadContext {
  read<I, O>(read: Read<I, O> | Leaf<I, O>, args: I): Promise<O>;
  work(owner: string, scope: unknown): Promise<unknown>;
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
  const checks = new Map<
    string,
    { definition: Leaf<unknown, unknown>; args: unknown; hash: string; revision: number }
  >();
  const requested = new Set<string>(),
    covered = new Set<string>(),
    refused: { keys: string[]; reason: string }[] = [];
  const reason = (error: unknown) => (error instanceof Error ? error.message : String(error));
  const ctx: ReadContext = {
    read: <A, B>(definition: Read<A, B> | Leaf<A, B>, input: A): Promise<B> => {
      if (closed) return Promise.reject(Error("This evaluation is closed"));
      const args = immutable(wireValue(definition.input.parse(input)));
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
              ? await port.take(definition.name, args,ctx)
              : await definition.run(ctx, args);
          const data = immutable(wireValue(definition.output.parse(raw)));
          const hash = fingerprint(data);
          trace.push({ recipe, name: definition.name, args, outcome: "answered", hash });
          if ("leaf" in definition) {
            if (port.revision(definition.name, args) !== revision)
              throw new RefreshNeeded(`${inputLabel(definition.name, args)} changed while reading`);
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
    work: (owner, scope) => ctx.read(workInput, { owner, scope }),
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
    trace.push({
      recipe: fingerprint([check.definition.name, check.args, "validation"]),
      name: check.definition.name,
      args: check.args,
      outcome: "answered",
      hash: fingerprint(current),
    });
    if (fingerprint(current) !== check.hash)
      throw new RefreshNeeded(`${inputLabel(check.definition.name, check.args)} changed during evaluation`);
  }
  for (const check of checks.values())
    if (port.revision(check.definition.name, check.args) !== check.revision)
      throw new RefreshNeeded(`${inputLabel(check.definition.name, check.args)} invalidated before publication`);
  const dependencies = trace.sort(
    (a, b) => a.recipe.localeCompare(b.recipe) || a.outcome.localeCompare(b.outcome),
  );
  const value: Value<O> = {
    data,
    // Connection/recording identity belongs in inputs, not sealed-input freshness (ADR 0033).
    // Caller admission and Work revision remain enforced by the write seal at Apply.
    evaluation: fingerprint([dependencies, data]),
    inputs: port.evaluation,
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

export interface Publication<T> {
  readonly key: string;
  readonly generation: number;
  readonly version: number;
  readonly value: Value<T> | null;
  readonly state: "current" | "refresh-needed" | "superseded";
  readonly reason?: string;
}
type Dependency = Pick<Trace, "name" | "args">;
type Pending = { inputs: Dependency[]; superseded: boolean };
type Slot = { generation: number; key: string; published?: Publication<unknown>; attempt: number; pending?: Pending };
/** One entry per (read,args), one generation per client subscription; no client acknowledgement. */
export class Publications {
  private readonly slots = new Map<string, Slot>();
  private readonly retainedBytes = new Map<string, number>();
  private bytes = 0;
  private readonly keys = new Map<
    string,
    { version: number; flights: Map<string, Promise<Publication<unknown>>> }
  >();
  private readonly listeners = new Map<string, Set<() => void>>();
  private readonly flightInputs = new WeakMap<Promise<Publication<unknown>>, Pending>();
  constructor(
    private readonly capacity = 128,
    private readonly byteLimit = 128 * 1024 * 1024,
  ) {}
  observe(id: string, notify: (publication: Publication<unknown>) => void) {
    const listeners = this.listeners.get(id) ?? new Set<() => void>();
    const listener = () => {
      const value = this.slots.get(id)?.published;
      if (value) notify(value);
    };
    listeners.add(listener);
    this.listeners.set(id, listeners);
    listener();
    return () => {
      listeners.delete(listener);
      if (!listeners.size) this.listeners.delete(id);
    };
  }
  private notify(id: string) {
    const listeners = this.listeners.get(id);
    for (const listener of listeners ?? []) {
      try {
        listener();
      } catch {
        listeners?.delete(listener);
      }
    }
  }
  history() {
    return immutable(
      Object.fromEntries(
        [...this.slots.keys()].flatMap((id) => {
          const published = this.publication(id);
          return published
            ? [
                [
                  id,
                  {
                    key: published.key,
                    version: published.version,
                    evaluation: published.value?.evaluation,
                  },
                ],
              ]
            : [];
        }),
      ),
    );
  }
  /** Retained bytes do not make a released or superseded subscription open. */
  publication(id: string) {
    const slot = this.slots.get(id), published = slot?.published;
    if (!slot?.key || !published || published.generation !== slot.generation || published.key !== slot.key) return undefined;
    return published;
  }
  invalidate(matches: (trace: Dependency) => boolean) {
    for (const [id, slot] of this.slots) {
      const previous = slot.published;
      const pending = slot.pending?.inputs.some((input) => input.name === "work" && matches(input));
      if (pending || previous?.value?.trace.some(matches)) {
        // Work creation or editing replaces the pending basis, including the first publication.
        if (pending && slot.pending) { slot.pending.superseded = true; slot.attempt++; slot.pending = undefined; }
        slot.published = immutable({
          key: previous?.key ?? slot.key, generation: slot.generation, version: previous?.version ?? 0,
          state: "refresh-needed",
          value: previous?.value ? { ...previous.value, freshness: "refresh-needed" } : null,
        });
        this.notify(id);
      }
    }
  }
  release(id: string, generation: number) {
    const slot = this.slots.get(id);
    if (!slot) {
      // Release may overtake admission while its input read set is opening.
      if (this.slots.size < this.capacity) this.slots.set(id, { generation, key: "", attempt: 0 });
      return;
    }
    if (generation >= slot.generation) {
      slot.generation = generation;
      slot.key = "";
      slot.attempt++;
      slot.pending = undefined;
    }
  }
  async publish<I, O>(
    id: string,
    generation: number,
    definition: Read<I, O>,
    args: I,
    port: InputPort,
    keep?: (publication: Publication<O>) => Promise<() => void>,
  ): Promise<Publication<O>> {
    const key = fingerprint([definition.name, definition.input.parse(args)]);
    let owner = this.keys.get(key);
    if (!owner) {
      if (this.keys.size >= 512) throw Error("Read key capacity reached");
      owner = { version: 0, flights: new Map() };
      this.keys.set(key, owner);
    }
    let slot = this.slots.get(id);
    const obsolete = (): Publication<O> =>
      immutable({ key, generation, version: 0, value: null, state: "superseded" });
    if (
      slot &&
      (generation < slot.generation || (generation === slot.generation && key !== slot.key))
    )
      return obsolete();
    if (!slot) {
      if (this.slots.size >= this.capacity) throw Error("Read subscription capacity reached");
      slot = { generation, key, attempt: 0 };
      this.slots.set(id, slot);
    }
    slot.generation = generation;
    slot.key = key;
    const attempt = ++slot.attempt;
    const mine = () =>
      slot.generation === generation && slot.key === key && slot.attempt === attempt;
    // Share only the same admitted input set. Equal args cannot substitute another recording's inputs.
    const flightKey = fingerprint([
      key,
      generation,
      port.evaluation,
      definition.run.toString(),
      schemaId(definition.input),
      schemaId(definition.output),
    ]);
    let flight = owner.flights.get(flightKey) as Promise<Publication<O>> | undefined;
    const pending = (flight && this.flightInputs.get(flight)) ?? { inputs: [], superseded: false };
    slot.pending = pending;
    if (!flight) {
      flight = evaluate(definition, args, {
        ...port,
        take: (name, args, context) => {
          if (pending.superseded) throw new RefreshNeeded("Work basis superseded");
          pending.inputs.push({ name, args });
          return port.take(name, args, context);
        },
      }).then((value) => {
        const version = ++owner.version;
        return immutable({ key, generation, version, value, state: "current" as const });
      });
      owner.flights.set(flightKey, flight);
      this.flightInputs.set(flight, pending);
      void flight
        .finally(() => {
          if (owner.flights.get(flightKey) === flight) owner.flights.delete(flightKey);
        })
        .catch(() => {});
    }
    try {
      const result = await flight;
      if (!mine()) return obsolete();
      const published = immutable({ ...result, generation });
      const bytes = Buffer.byteLength(JSON.stringify(published));
      const nextBytes = this.bytes - (this.retainedBytes.get(id) ?? 0) + bytes;
      if (nextBytes > this.byteLimit)
        throw Error("Published Values exceed the shared byte bound; old Value retained");
      const dependencies = keep ? published.value!.trace.filter((trace) => trace.outcome === "answered")
        .map((trace) => ({ trace, revision: port.revision(trace.name, trace.args) })) : [];
      const commit = await keep?.(published);
      if (!mine()) return obsolete();
      if (dependencies.some(({ trace, revision }) => port.revision(trace.name, trace.args) !== revision))
        throw new RefreshNeeded("Inputs invalidated while persisting the publication");
      const retainedBytes = this.bytes - (this.retainedBytes.get(id) ?? 0) + bytes;
      if (retainedBytes > this.byteLimit) throw Error("Published Values exceed the shared byte bound; old Value retained");
      this.bytes = retainedBytes;
      this.retainedBytes.set(id, bytes);
      slot.published = published;
      commit?.();
      this.notify(id);
      return published;
    } catch (error) {
      if (!mine()) return obsolete();
      const previous = slot.published;
      const retained = previous?.value
        ? immutable({ ...previous.value, freshness: "refresh-needed" as const })
        : null;
      const result: Publication<O> = immutable({
        key: previous?.key ?? key,
        generation,
        version: previous?.version ?? 0,
        value: retained as Value<O> | null,
        state: "refresh-needed",
        reason: error instanceof Error ? error.message : String(error),
      });
      // Old data retains its original key/version, but its non-current label is host-owned too.
      if (previous?.value) {
        slot.published = result;
        if (previous.state === "current") this.notify(id);
      }
      return result;
    } finally {
      if (slot.pending === pending) slot.pending = undefined;
    }
  }
}
