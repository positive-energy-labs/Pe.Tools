import type { EntryContract } from "../../../../packages/agent-contracts/src/route-kernel-bodies.ts";
import type { ReadingContext, UseSource } from "../shell/readings.ts";
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
  key: PeRouteId;
  input: z.ZodType;
  output: z.ZodType<Publication>;
  axes: EntryContract["axes"];
  fixtures?: Readonly<Record<string, (args: any) => FixtureValue<z.ZodType<Publication>>>>;
  source: UseSource & { provide?(name: string, args: unknown): Publication };
}
type FixtureValue<O extends z.ZodType<Publication>> = Pick<
  NonNullable<z.output<O>["value"]>,
  "data" | "coverage"
>;

/** A host publication handle. Importing a route on the host never loads browser transport. */
export function hostRead<I extends z.ZodType, O extends z.ZodType<Publication>>(
  contract: { key: PeRouteId; input: I; output: O; axes: EntryContract["axes"] },
  fixtures?: Readonly<Record<string, (args: z.output<I>) => FixtureValue<O>>>,
) {
  const { key } = contract;
  return {
    ...contract,
    fixtures,
    source: {
      kind: "use" as const,
      dirties: ["snapshot"],
      async open(ctx: ReadingContext, deliver: Parameters<UseSource["open"]>[1]) {
        const { callCompose, publicationSource } = await import("../shell/readings-api.ts");
        if (ctx.signal.aborted) return;
        return publicationSource({
          async read(context, publication, release) {
            if (context.target.kind !== "document") throw Error("Choose a document");
            return contract.output.parse(
              await callCompose(context, key, {
                body: {
                  ...publication,
                  release,
                  args: {
                    ...z.record(z.string(), z.unknown()).parse(contract.input.parse(context.args)),
                    target: context.target.ref,
                  },
                },
              } as never),
            );
          },
        }).open(ctx, deliver);
      },
      ...(fixtures
        ? {
            provide(name: string, args: unknown) {
              const provider = fixtures[name];
              if (!provider) throw Error(`No fixture '${name}' for ${key}`);
              const input = contract.input.parse(args);
              const value = provider(input);
              const id = `fixture:${key}:${name}:${JSON.stringify(input)}`;
              return contract.output.parse({
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
              });
            },
          }
        : {}),
    },
  };
}
