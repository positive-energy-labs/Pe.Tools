import type { EntryContract } from "../../../../packages/agent-contracts/src/route-kernel-bodies.ts";
import type { UseSource } from "../shell/source-contract.ts";
import { z } from "zod";
import type { PeRouteId } from "@pe/agent-contracts/pe-api";
export interface Publication<D = unknown> {
  key: string;
  generation: number;
  version: number;
  state: "current" | "refresh-needed" | "superseded";
  reason?: string;
  value: {
    data: D;
    evaluation: string;
    inputs: string;
    coverage: {
      requested: string[];
      covered: string[];
      unknown: string[];
      refused: { keys: string[]; reason: string }[];
    };
    origin: unknown;
    trace: unknown[];
    freshness: "current" | "refresh-needed";
  } | null;
}
export interface HostRead {
  key: string;
  input: z.ZodType;
  output: z.ZodType<Publication>;
  axes: EntryContract["axes"];
  demand?: "mount" | "explicit";
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
export function hostRead<I extends z.ZodType, O extends z.ZodType<Publication>>(
  contract: {
    key: string;
    endpoint?: PeRouteId;
    request?(args: z.output<I>, target?: import("@pe/agent-contracts").ExecutionTarget): object;
    input: I;
    output: O;
    axes: EntryContract["axes"];
    demand?: "mount" | "explicit";
  },
  fixtures?: Readonly<Record<string, (args: z.output<I>) => FixtureValue<O>>>,
) {
  const { key } = contract;
  return {
    ...contract,
    fixtures,
    source: {
      kind: "use" as const,
      dirties: ["snapshot"],
      ...(fixtures
        ? {
            provide(name: string, args: unknown) {
              const provider = fixtures[name];
              if (!provider) throw Error(`No fixture '${name}' for ${key}`);
              const input = contract.input.parse(args);
              const value = provider(input);
              const id = `fixture:${key}:${name}:${JSON.stringify(input)}`;
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
