import { nativeRequestSchema } from "@pe/host-contracts/decoders";
import { BridgeError as InputBridgeError } from "@pe/host-internal/dispatch";
import { BridgeError } from "../bridge.ts";

import { workKeySchema, type WorkKey } from "@pe/agent-contracts";
import type { RouteWorkspace } from "@pe/runtime";
import { z } from "zod";
import type { HostMarks } from "../document-marks.ts";

import {
  DUCTS_BODY_VERSION_HEADER,
  ductsDocumentSchema,
  ductsSnapshotReadingSchema,
  fansDocumentSchema,
  documentRefSchema,
} from "@pe/agent-contracts";
import type { WorkReadContext } from "@pe/runtime";
import { catalogReading, firmReading } from "../ducts-files.ts";
import type { InputConsumption } from "../input-occurrence.ts";
import type { WorkInputRunner } from "../work-inputs.ts";
import { leaf, read, RefusedPartition, type InputPort } from "./evaluator.ts";

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
export const firm = leaf("firm", z.null(), firmReading);
export const catalogs = leaf("catalogs", z.null(), catalogReading);
const nativeInput = leaf(
  "native",
  z
    .discriminatedUnion("key", [
      z.object({
        key: z.literal("ducts.snapshot.roster"),
        request: nativeRequestSchema("ducts.snapshot.roster").and(
          ductsSnapshotReadingSchema.omit({ kind: true, target: true }),
        ),
      }),
      z.object({
        key: z.literal("ducts.snapshot.walk"),
        request: nativeRequestSchema("ducts.snapshot.walk").and(
          ductsSnapshotReadingSchema.omit({ kind: true, target: true }),
        ),
      }),
      z.object({ key: z.literal("ducts.tables"), request: nativeRequestSchema("ducts.tables") }),
    ])
    .and(
      z.object({
        target: documentRefSchema,
        version: z.string().optional(),
        role: z.enum(["acquire", "validate", "join", "beyond"]).optional(),
      }),
    ),
  z.object({ body: z.unknown(), version: z.string().nullable() }),
  false,
);
export const native = read("ducts.native", {
  input: nativeInput.input,
  output: nativeInput.output,
  async run(ctx, args) {
    await ctx.read(documentMark, args.target);
    return ctx.read(nativeInput, { ...args, role: args.role ?? "acquire" });
  },
});
export const workValue = z
  .object({ doc: z.unknown(), revision: z.number() })
  .passthrough()
  .nullable();

export interface DuctsReadSources {
  inputs?: { consumption: InputConsumption; run: WorkInputRunner; work: WorkReadContext };
  workKey: (target: import("@pe/agent-contracts").DocumentRef) => Promise<WorkKey>;
  firm: () => Promise<z.infer<typeof firmReading>>;
  catalogs: () => Promise<import("../duct-catalogs.ts").CatalogReading>;
  call: (
    key: "ducts.snapshot.roster" | "ducts.snapshot.walk" | "ducts.tables",
    request: z.infer<typeof nativeInput.input>["request"],
    target: import("@pe/agent-contracts").DocumentRef,
    version?: string,
    role?: "acquire" | "validate" | "join" | "beyond",
  ) => Promise<Response>;
}
export const workScope = leaf("work-scope", documentRefSchema, workKeySchema, false);
export const designLayers = read("ducts.design-layers", {
  input: documentRefSchema,
  output: z.object({
    ducts: ductsDocumentSchema,
    fans: fansDocumentSchema,
    revision: z.number(),
    fansRevision: z.number(),
    firm: firmReading,
  }),
  async run(ctx, target) {
    const scope = await ctx.read(workScope, target);
    const ducts = workValue.parse(await ctx.work("ducts", scope));
    const fans = workValue.parse(await ctx.work("fans", { ...scope, route: "fans" }));
    return {
      ducts: ductsDocumentSchema.parse(ducts?.doc ?? {}),
      fans: fansDocumentSchema.parse(fans?.doc ?? {}),
      revision: ducts?.revision ?? 0,
      fansRevision: fans?.revision ?? 0,
      firm: await ctx.read(firm, null),
    };
  },
});

export function ductsInputPort(options: {
  source: DuctsReadSources;
  workspace: RouteWorkspace;
  marks: HostMarks;
  run: WorkInputRunner;
  evaluation: string;
  origin: () => unknown;
  revision: InputPort["revision"];
}): InputPort {
  return {
    evaluation: options.evaluation,
    get origin() {
      return options.origin();
    },
    revision: options.revision,
    take: async (name, raw) => {
      switch (name) {
        case "document-mark":
          await options.marks.settled?.();
          return options.run(options.marks.snapshot(documentRefSchema.parse(raw)));
        case "work-scope":
          return options.source.workKey!(documentRefSchema.parse(raw));
        case "work": {
          const { owner, scope } = z.object({ owner: z.string(), scope: workKeySchema }).parse(raw);
          return options.workspace.view(scope, owner, options.source.inputs?.work);
        }
        case "firm":
          return options.source.firm();
        case "catalogs":
          return options.source.catalogs();
        case "native": {
          const args = nativeInput.input.parse(raw);
          let response: Response;
          try {
            response = await options.source.call(
              args.key,
              args.request,
              args.target,
              args.version,
              args.role,
            );
          } catch (error) {
            if (
              (error instanceof BridgeError || error instanceof InputBridgeError) &&
              error.outcome === "refused"
            )
              throw new RefusedPartition(error.message);
            throw error;
          }
          if (!response.ok) throw Error(await response.text());
          return {
            body: await response.json(),
            version: response.headers.get(DUCTS_BODY_VERSION_HEADER),
          };
        }
        default:
          throw Error(`Unknown input leaf '${name}'`);
      }
    },
  };
}
