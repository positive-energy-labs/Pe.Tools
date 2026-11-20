import type { EntryContract } from "./route-kernel-bodies.ts";
import type { UseSource } from "./reading-source.ts";
import { z } from "zod";
import type { ExecutionTarget } from "./target.ts";
import type { PeRouteId } from "./pe-api.ts";
import type { Publication, ReadingLoad } from "./value.ts";
import type { ReadHandle } from "./handle.ts";
export interface HostRead {
  key: string;
  input: z.ZodType;
  output: z.ZodType<Publication>;
  axes: EntryContract["axes"];
  readonly load?: ReadingLoad;
  fixtures?: FixtureProviders<any, unknown>;
  endpoint?: PeRouteId;
  request?(args: any, target?: ExecutionTarget): object;
  source: Omit<UseSource, "open"> & {
    provide?(name: string, args: unknown): Publication | Promise<Publication>;
  };
}
type FixtureTable<I, D> = Readonly<
  Record<string, (args: I) => FixtureValue<z.ZodType<Publication<D>>>>
>;
type FixtureProviders<I, D> = FixtureTable<I, D> | (() => Promise<FixtureTable<I, D>>);
type FixtureValue<O extends z.ZodType<Publication>> = Pick<
  NonNullable<z.output<O>["value"]>,
  "data" | "coverage"
>;

/** A host publication handle. Importing a route on the host never loads browser transport. */
export function hostRead<K extends string, S extends z.ZodRawShape, D>(
  contract: ReadHandle<K, z.output<z.ZodObject<S>>, D> & { input: z.ZodObject<S> },
  fixtures?: FixtureProviders<z.output<z.ZodObject<Omit<S, "target">>>, D>,
): HostRead & { input: z.ZodObject<Omit<S, "target">>; output: z.ZodType<Publication<D>> };
export function hostRead<K extends string, I, D>(
  contract: ReadHandle<K, I, D>,
  fixtures?: FixtureProviders<I, D>,
): HostRead & { input: z.ZodType<I>; output: z.ZodType<Publication<D>> };
export function hostRead<K extends string, D>(
  contract: ReadHandle<K, unknown, D>,
  fixtures?: HostRead["fixtures"],
): HostRead & { output: z.ZodType<Publication<D>> } {
  const { key } = contract;
  let input: z.ZodType = contract.input;
  if (contract.input instanceof z.ZodObject && "target" in contract.input.shape) {
    const { target, ...shape } = contract.input.shape;
    input = z.object(shape).clone({ ...contract.input.def, shape });
  }
  return {
    ...contract,
    input,
    endpoint: "reads.value" as const,
    request(args: z.output<typeof input>, target?: ExecutionTarget) {
      const shape = contract.input instanceof z.ZodObject ? contract.input.shape.target : undefined;
      const bound = target ?? { kind: "host" as const };
      const direct = shape instanceof z.ZodType ? shape.safeParse(bound) : undefined;
      return {
        read: key,
        args: contract.input.parse(
          shape && typeof args === "object" && args !== null
            ? {
                ...args,
                target: direct?.success
                  ? direct.data
                  : bound.kind === "document"
                    ? bound.ref
                    : bound,
              }
            : args,
        ),
      };
    },
    fixtures,
    source: {
      kind: "use" as const,
      dirties: ["snapshot"],
      ...(fixtures
        ? {
            provide(name: string, args: unknown) {
              const publish = (table: FixtureTable<unknown, unknown>) => {
                const provider = table[name];
                if (!provider) throw Error(`No fixture '${name}' for ${key}`);
                const parsed = input.parse(args);
                const value = provider(parsed);
                const id = `fixture:${key}:${name}:${JSON.stringify(parsed)}`;
                return {
                  key: id,
                  generation: 0,
                  version: 1,
                  state: "current",
                  value: {
                    ...value,
                    evaluation: id,
                    inputs: id,
                    origin: { kind: "fixture", name },
                    works: [],
                    trace: [],
                    freshness: "current",
                  },
                } satisfies Publication;
              };
              return typeof fixtures === "function" ? fixtures().then(publish) : publish(fixtures);
            },
          }
        : {}),
    },
  };
}
