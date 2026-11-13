import type { EntryContract } from "../../../../packages/agent-contracts/src/route-kernel-bodies.ts";
import type { UseSource } from "../shell/source-contract.ts";
import { z } from "zod";
import type { PeRouteId } from "@pe/agent-contracts/pe-api";
import type { Publication } from "@pe/agent-contracts/value";
import type { ReadHandle } from "@pe/agent-contracts/handle";
export interface HostRead {
  key: string;
  input: z.ZodType;
  output: z.ZodType<Publication>;
  axes: EntryContract["axes"];
  fixtures?: Readonly<Record<string, (args: any) => FixtureValue<z.ZodType<Publication>>>>;
  endpoint?: PeRouteId;
  request?(args: any, target?: import("@pe/agent-contracts").ExecutionTarget): object;
  source: Omit<UseSource,"open"> & { provide?(name: string, args: unknown): Publication };
}
type FixtureValue<O extends z.ZodType<Publication>> = Pick<
  NonNullable<z.output<O>["value"]>,
  "data" | "coverage"
>;

/** A host publication handle. Importing a route on the host never loads browser transport. */
export function hostRead<K extends string, S extends z.ZodRawShape, D>(
  contract: ReadHandle<K, z.output<z.ZodObject<S>>, D> & { input: z.ZodObject<S> },
  fixtures?: Readonly<Record<string, (args: z.output<z.ZodObject<Omit<S, "target">>>) => FixtureValue<z.ZodType<Publication<D>>>>>,
): HostRead & { input: z.ZodObject<Omit<S, "target">>; output: z.ZodType<Publication<D>> };
export function hostRead<K extends string, I, D>(
  contract: ReadHandle<K, I, D>,
  fixtures?: Readonly<Record<string, (args: I) => FixtureValue<z.ZodType<Publication<D>>>>>,
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
    request(args: z.output<typeof input>, target?: import("@pe/agent-contracts").ExecutionTarget) {
      const shape = contract.input instanceof z.ZodObject ? contract.input.shape.target : undefined;
      const bound = target ?? { kind: "host" as const };
      const direct = shape instanceof z.ZodType ? shape.safeParse(bound) : undefined;
      return { read: key, args: contract.input.parse(shape && typeof args === "object" && args !== null
        ? { ...args, target: direct?.success ? direct.data : bound.kind === "document" ? bound.ref : bound }
        : args) };
    },
    fixtures,
    source: {
      kind: "use" as const,
      dirties: ["snapshot"],
      ...(fixtures
        ? {
            provide(name: string, args: unknown) {
              const provider = fixtures[name];
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
                  works: [], trace: [],
                  freshness: "current",
                },
              } satisfies Publication;
            },
          }
        : {}),
    },
  };
}
