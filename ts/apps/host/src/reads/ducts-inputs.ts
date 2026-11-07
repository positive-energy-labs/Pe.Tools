import { nativeRequestSchema } from "@pe/host-contracts/decoders";
import { BridgeError as InputBridgeError } from "@pe/host-internal/dispatch";
import { BridgeError } from "../bridge.ts";

import { bindWork, workKeySchema, type WorkKey } from "@pe/agent-contracts";
import type { RouteWorkspace } from "@pe/runtime";
import { z } from "zod";
import type { HostMarks } from "../document-marks.ts";

import {
  DUCTS_BODY_VERSION_HEADER,
  ductsDocumentSchema,
  ductsSnapshotReadingSchema,
  fansDocumentSchema,
  documentRefSchema, executionTargetSchema,
} from "@pe/agent-contracts";
import type { WorkReadContext } from "@pe/runtime";
import { catalogReading, firmReading } from "../ducts-files.ts";
import type { InputConsumption } from "../input-occurrence.ts";
import type { WorkInputRunner } from "../work-inputs.ts";
import { leaf, read, RefusedPartition, type InputPort, workScope, workValue } from "./evaluator.ts";

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

export interface DuctsReadSources {
  inputs?: { consumption: InputConsumption; run: WorkInputRunner; work: WorkReadContext };
  workKey: (target: import("@pe/agent-contracts").DocumentRef) => Promise<WorkKey>;
  firm: () => Promise<z.infer<typeof firmReading>>;
  catalogs: () => Promise<import("../duct-catalogs.ts").CatalogReading>;
  resource?: (request:unknown)=>Promise<unknown>;
  call: (
    key: string,
    request: unknown,
    target: import("@pe/agent-contracts").DocumentRef | import("@pe/agent-contracts").ExecutionTarget,
    version?: string,
    role?: "acquire" | "validate" | "join" | "beyond",
  ) => Promise<Response>;
}

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
  leaves?: NonNullable<import("@pe/agent-contracts").HostRouteModule["leaves"]>;
}): InputPort {
  const port:InputPort = {
    evaluation: options.evaluation,
    get origin() {
      return options.origin();
    },
    revision: options.revision,
    take: async (name, raw, context) => {
      const custom=options.leaves?.[name];
      if(custom) return custom(raw,{...port,take:async (key,args)=> {
        if(!context) return port.take(key,args);
        if(key === "native") {
          const input=z.object({target:z.union([documentRefSchema,executionTargetSchema])}).parse(args);
          const ref="kind" in input.target ? input.target.kind === "document" ? input.target.ref : null : input.target;
          if(ref) await context.read(documentMark,ref);
        }
        return context.read(leaf(key,z.unknown(),z.unknown(),key !== "native"),args);
      }});

      switch (name) {
        case "resource":
          if(!options.source.resource) throw Error("Resource inputs are unavailable");
          return options.source.resource(raw);
        case "document-mark":
          await options.marks.settled?.();
          return options.run(options.marks.snapshot(documentRefSchema.parse(raw)));
        case "work-scope": {
          const legacy=documentRefSchema.safeParse(raw);
          if(legacy.success) return options.source.workKey(legacy.data);
          const request=z.object({route:z.string().min(1),work:z.string().nullable().optional(),target:z.union([documentRefSchema,executionTargetSchema]).optional()}).parse(raw);
          if(request.work === null) return null;
          if(request.work !== undefined) return bindWork(request.route,null,request.work);
          const target=request.target;
          const ref=target && ("kind" in target ? target.kind === "document"?target.ref:null : target);
          return ref ? {...await options.source.workKey(ref),route:request.route} : bindWork(request.route,null);
        }
        case "work": {
          const { owner, scope } = z.object({ owner: z.string(), scope: workKeySchema }).parse(raw);
          return options.workspace.view(scope, owner, options.source.inputs?.work);
        }
        case "firm":
          return options.source.firm();
        case "catalogs":
          return options.source.catalogs();
        case "native": {
          const args=z.object({key:z.string(),request:z.unknown(),target:z.union([documentRefSchema,executionTargetSchema]),
            version:z.string().optional(),role:z.enum(["acquire","validate","join","beyond"]).optional()}).parse(raw);
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
  return port;
}
