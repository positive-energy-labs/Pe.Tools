import { z } from "zod";
import {
  documentRefSchema,
  executionTargetSchema,
  workKeySchema,
  bindWork,
  DUCTS_BODY_VERSION_HEADER,
  nativeOutputSchema,
  nativeOutputAssets,
  type NativeReadOutput,
} from "@pe/agent-contracts";
import { nativeRequestSchema } from "@pe/host-contracts/decoders";
import { hostOpCatalog } from "@pe/host-contracts/catalog";
import type { HostOperationKey, OpRequestOf } from "@pe/host-contracts/operation-types";
import { leaf, read, type Read, type InputPort, RefusedPartition } from "./evaluator.ts";
import type { RouteWorkspace, WorkReadContext } from "@pe/runtime";
import type { HostMarks } from "../document-marks.ts";
import type { WorkInputRunner } from "../work-inputs.ts";
import type { InputConsumption } from "../input-occurrence.ts";
import { BridgeError } from "../bridge.ts";
import { BridgeError as InputBridgeError } from "@pe/host-internal/dispatch";

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
const targetSchema = z.union([documentRefSchema, executionTargetSchema]);
const nativeArgs = z.object({
  key: z.string(),
  request: z.unknown(),
  target: executionTargetSchema,
  version: z.string().optional(),
  role: z.enum(["acquire", "validate", "join", "beyond"]).optional(),
});
const nativeLeaf = leaf(
  "native",
  nativeArgs,
  z.object({ body: z.unknown(), version: z.string().nullable() }),
  false,
);
const cache = new Map<string, unknown>();
/** Handles project their request, response and admission from the checked-in C# catalog. */
type NativeArgs<K extends HostOperationKey> = {
  request: OpRequestOf<K>;
  target: z.output<typeof executionTargetSchema>;
  version?: string;
  role?: "acquire" | "validate" | "join" | "beyond";
};
type NativeValue<K extends HostOperationKey> = {
  body: NativeReadOutput<K>;
  version: string | null;
};
export const assetFile = leaf(
  "file:capture",
  z.string().regex(/^[0-9a-f]{64}$/),
  z.string().regex(/^[0-9a-f]{64}$/),
  false,
);
export function nativeRead<K extends HostOperationKey>(
  key: K,
): Read<NativeArgs<K>, NativeValue<K>> {
  if (cache.has(key)) return cache.get(key) as Read<NativeArgs<K>, NativeValue<K>>;
  const input = nativeArgs.omit({ key: true }).extend({ request: nativeRequestSchema(key) });
  const output = z.object({ body: nativeOutputSchema(key), version: z.string().nullable() });
  const operation = hostOpCatalog.find((op) => op.key === key);
  if (
    !operation ||
    operation.intent !== "Read" ||
    !(operation.effect === "Read" || (operation.effect === "TransactRead" && operation.rollsBack))
  )
    throw Error(`Input is not a catalog Read/Read: ${key}`);
  const handle = read(`input.native.${key}`, {
    input,
    output,
    async run(ctx, args) {
      const target = args.target;
      const ref = target.kind === "document" ? target.ref : null;
      if (ref) await ctx.read(documentMark, ref);
      const value = output.parse(await ctx.read(nativeLeaf, { ...args, key }));
      for (const sha of nativeOutputAssets(key, value.body)) await ctx.read(assetFile, sha);
      return value;
    },
  });
  cache.set(key, handle);
  return handle;
}
export const workBinding = leaf(
  "work-scope",
  z.object({
    route: z.string(),
    target: targetSchema.optional(),
    work: z.string().nullable().optional(),
  }),
  workKeySchema.nullable(),
  false,
);
/** The contract is supplied once by the Work owner; routes never decode Work envelopes. */
export const workRead = <T>(owner: string, schema: z.ZodType<T>) => {
  const output = z.object({ doc: schema, revision: z.number() }).nullable();
  return read(`input.work.${owner}`, {
    input: workKeySchema,
    output,
    async run(ctx, scope) {
      return output.parse(await ctx.work(owner, scope));
    },
  });
};
export interface ReadSources {
  inputs?: { consumption: InputConsumption; run: WorkInputRunner; work: WorkReadContext };
  workKey: (target: z.output<typeof documentRefSchema>) => Promise<z.output<typeof workKeySchema>>;
  resource: (request: unknown) => Promise<unknown>;
  file: (name: string, args: unknown) => Promise<unknown>;
  call: (
    key: string,
    request: unknown,
    target: z.output<typeof executionTargetSchema>,
    version?: string,
    role?: "acquire" | "validate" | "join" | "beyond",
  ) => Promise<Response>;
}
export function inputPort(options: {
  source: ReadSources;
  workspace: RouteWorkspace;
  marks: HostMarks;
  run: WorkInputRunner;
  evaluation: string;
  origin: () => unknown;
  revision: InputPort["revision"];
  leaves?: import("@pe/agent-contracts").HostRouteModule["leaves"];
}): InputPort {
  const port: InputPort = {
    evaluation: options.evaluation,
    get origin() {
      return options.origin();
    },
    revision: options.revision,
    async take(name, raw, context) {
      const source = options.source;
      const custom = options.leaves?.[name];
      if (custom)
        return custom(raw, {
          ...port,
          take: async (key, args) => {
            if (!context) return port.take(key, args);
            if (key === "native") {
              const input = nativeArgs.parse(args);
              const definition = nativeRead(input.key as HostOperationKey);
              return context.read(definition, definition.input.parse(input));
            }
            return context.read(leaf(key, z.unknown(), z.unknown()), args);
          },
        });
      if (name === "resource") return source.resource(raw);
      if (name.startsWith("local:")) return source.file(name, raw);
      if (name.startsWith("file:")) return source.file(name.slice(5), raw);
      if (name === "document-mark") {
        await options.marks.settled?.();
        return options.run(options.marks.snapshot(documentRefSchema.parse(raw)));
      }
      if (name === "work-scope") {
        const document = documentRefSchema.safeParse(raw);
        if (document.success) return source.workKey(document.data);
        const request = workBinding.input.parse(raw);
        if (request.work === null) return null;
        if (request.work !== undefined) return bindWork(request.route, null, request.work);
        const target = request.target,
          ref =
            target &&
            ("kind" in target ? (target.kind === "document" ? target.ref : null) : target);
        return ref
          ? { ...(await source.workKey(ref)), route: request.route }
          : bindWork(request.route, null);
      }
      if (name === "work") {
        const { owner, scope } = z.object({ owner: z.string(), scope: workKeySchema }).parse(raw);
        return options.workspace.view(scope, owner, source.inputs?.work);
      }
      if (name === "native") {
        const args = nativeArgs.parse(raw);
        let response: Response;
        try {
          response = await source.call(
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
      throw Error(`Unknown input leaf '${name}'`);
    },
  };
  return port;
}
