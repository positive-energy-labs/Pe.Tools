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
export function hostRead<K extends string, I, D>(
  contract: ReadHandle<K, I, D>,
  fixtures?: Readonly<Record<string, (args: Omit<I, "target">) => FixtureValue<z.ZodType<Publication<D>>>>>,
): HostRead & { input: z.ZodType<Omit<I, "target">>; output: z.ZodType<Publication<D>> } {
  const { key } = contract;
  const browserInput = contract.input instanceof z.ZodObject && "target" in contract.input.shape
    ? contract.input.omit({ target: true })
    : contract.input;
  const input = z.preprocess((value) => browserInput.parse(value), z.custom<Omit<I, "target">>());
  return {
    ...contract,
    input,
    endpoint: "reads.value" as const,
    request(args: Omit<I, "target">, target?: import("@pe/agent-contracts").ExecutionTarget) {
      const shape = contract.input instanceof z.ZodObject ? contract.input.shape.target : undefined;
      const bound = target ?? { kind: "host" as const };
      const direct = shape?.safeParse(bound);
      return { read: key, args: contract.input.parse({ ...args, ...(shape ? {
        target: direct?.success ? direct.data : bound.kind === "document" ? bound.ref : bound,
      } : {}) }) };
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
                  trace: [],
                  freshness: "current",
                },
              } satisfies Publication;
            },
          }
        : {}),
    },
  };
}
