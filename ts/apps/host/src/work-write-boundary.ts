import { createHash } from "node:crypto";
import { documentMarks } from "./document-marks.ts";
import { lifetime } from "./family-actions.ts";
import type { RevitBridge } from "./bridge.ts";
import type { SdkReceiptReader } from "./native-receipts.ts";
import { z } from "zod";
import { canonicalRouteInput, tools, type Tool, type WorkHandle } from "@pe/agent-contracts";
import { refused, type CommandContext, type CommandExecutor } from "./command-executor.ts";

const hash = (value: unknown) =>
  createHash("sha256").update(canonicalRouteInput(value)).digest("hex");
const preparedSchema = z.object({
  input: z.record(z.string(), z.unknown()),
  value: z.unknown(),
  seal: z.object({
    requestHash: z.string(),
    work: z.unknown(),
    incarnation: z.unknown(),
    dependencies: z.string(),
  }),
  previewOnly: z.boolean(),
  takenAt: z.string(),
});

export interface WriteBinding {
  route: string;
  key: string;
  workspace?: boolean;
  derive(work: unknown): unknown;
  preview(request: unknown): unknown;
  nativePreview?: boolean;
  previewOnly?: boolean;
  handle?(input: Record<string, unknown>): WorkHandle;
}

/** Keep native derivation/recovery in its owner; admit only authored, revisioned Work. */
export function workWriteBoundary(
  executor: CommandExecutor,
  bridge: RevitBridge["Service"],
  deps: { sdk?: SdkReceiptReader } = {},
  binding?: WriteBinding,
  registeredWork?: import("@pe/agent-contracts").RouteStateSpec<z.ZodType>,
): CommandExecutor {
  const definition = executor.definition as import("@pe/agent-contracts").Command & {
    authoredInput: z.ZodType;
    writeBoundary: WriteBinding;
  };
  const hooks = binding ?? definition.writeBoundary;
  if (!hooks || typeof hooks.derive !== "function" || typeof hooks.preview !== "function")
    throw Error("Write command requires typed derive and preview bindings");
  const { route, key } = hooks;
  const spec = (registeredWork ??
    (tools[route as keyof typeof tools] as Tool)?.work)! as NonNullable<Tool["work"]> & {
    schema: z.ZodType<Record<string, unknown>>;
  };
  const internal = (ctx: CommandContext, input: Record<string, unknown>) => ({
    ...ctx,
    admission: { ...ctx.admission, input },
  });
  return {
    ...executor,
    prepared: preparedSchema,
    bind: async (ctx) => {
      documentMarks(bridge);
      const takenAt = new Date().toISOString();
      const parsed = definition.input.parse(ctx.admission.input) as {
        work: WorkHandle;
        previewOnly: boolean;
      };
      const work = hooks.handle ? hooks.handle(ctx.admission.input) : parsed.work;
      const previewOnly = hooks.previewOnly ?? parsed.previewOnly;
      if (ctx.admission.target.kind !== "document") throw refused("Exact document required");
      // Address binding must be checked against the current open, never provenance `from`.
      if (
        work.key.binding !== "open" &&
        work.key.binding !== "address" &&
        !(hooks.workspace && work.key.binding === "workspace")
      )
        throw refused("Document Work required");
      if (
        work.key.binding === "open" &&
        canonicalRouteInput(work.key.open) !== canonicalRouteInput(ctx.admission.target.ref)
      )
        throw refused("Work belongs to another document", "work.target");
      const target = ctx.admission.target.ref;
      const observed = await lifetime(bridge, target, false, deps);
      const address = observed.session.state?.openDocuments.find(
        (doc) => doc.openId === target.openId,
      )?.address;
      if (
        work.key.binding === "address" &&
        (!address ||
          String(address).replaceAll("/", "\\").toLowerCase() !==
            String(work.key.target).replaceAll("/", "\\").toLowerCase())
      )
        throw refused("Work belongs to another document", "work.target");
      // Each owner also resolves the native incarnation. The address check uses that same bound dependency below.
      const doc = (await ctx.selectWork(spec, work, (_doc, cells) => ({
        cells: cells.filter(({ cell }) => cell.edit).map(({ path }) => path),
        facts: Object.keys(_doc as object)
          .filter((name) => name !== "writeIntent")
          .map((name) => [name]),
        edits: spec.editable,
      }))) as { writeIntent?: Record<string, { edit?: { value: Record<string, unknown> } }> };
      const authored = hooks.derive(doc);
      const input = { ...(authored as object), work };
      const preview = ctx.read
        .receipts()
        .filter(
          (row) =>
            row.key === key &&
            row.state === "succeeded" &&
            (row.result as { previewOnly?: boolean })?.previewOnly &&
            canonicalRouteInput(row.target) === canonicalRouteInput(ctx.admission.target),
        )
        .at(-1);
      const derivedContext = internal(ctx, input);
      // Reproduce generated paths and plan references from this exact preview, never a new caller payload.
      derivedContext.admission.id = !previewOnly && preview ? preview.id : ctx.admission.id;
      const bound = await executor.bind(derivedContext);
      return {
        ...bound,
        effects: previewOnly ? [] : bound.effects,
        claims: [
          ...(bound.claims ?? []),
          ...(!previewOnly && preview ? [{ kind: "receipt" as const, id: preview.id }] : []),
        ],
        consumes: [
          ...(bound.consumes ?? []),
          ...(!previewOnly && preview
            ? [
                {
                  kind: "document-mark" as const,
                  probe: {
                    ref: ctx.admission.target.ref,
                    takenAt:
                      preview.state === "succeeded"
                        ? (preview.result as { takenAt: string }).takenAt
                        : "",
                  },
                  expected: true as const,
                },
              ]
            : []),
        ],
        prepare: async () => {
          const value = executor.prepared.parse(await bound.prepare?.());
          if (!previewOnly && !preview)
            throw refused("Preview the current Work first", "preview.stale");
          const dependencies = [...ctx.consumed, ...(bound.consumes ?? [])].filter(
            (item) => item.kind !== "document-mark",
          );
          // Capture filing timestamps do not change the native request or authored destination.
          const { at: _at, ...request } =
            value && typeof value === "object" && !Array.isArray(value)
              ? (value as Record<string, unknown>)
              : { value };
          const seal = {
            requestHash: hash(hooks.preview(request)),
            work: { handle: work, consumed: ctx.consumed.filter((item) => item.kind === "work") },
            incarnation: { target, process: observed.process },
            dependencies: hash({
              input,
              dependencies,
              evidence: (request as Record<string, unknown>).dependencies,
            }),
          };
          if (
            !previewOnly &&
            (preview?.state !== "succeeded" ||
              canonicalRouteInput((preview.result as { seal?: unknown }).seal) !==
                canonicalRouteInput(seal))
          )
            throw refused(
              "Preview changed; preview the current Work and dependencies again",
              "preview.stale",
            );
          return { input, value, seal, previewOnly, takenAt };
        },
      };
    },
    run: async (ctx, execution) => {
      const p = preparedSchema.parse(execution.prepared);
      if (p.previewOnly && !hooks.nativePreview)
        return {
          previewOnly: true,
          derivedRequest: hooks.preview(p.value),
          authoredIntent: p.input,
          seal: p.seal,
          takenAt: p.takenAt,
        };
      const result = await executor.run(internal(ctx, p.input), {
        ...execution,
        prepared: p.value,
      });
      const retires = executor.retires;
      if (!p.previewOnly && retires) {
        const paths = retires(result);
        if (paths.length) await execution.retireWork((p.input.work as WorkHandle).key, route, paths);
      }
      return {
        ...(result as object),
        previewOnly: p.previewOnly,
        derivedRequest: hooks.preview(p.value),
        seal: p.seal,
        takenAt: p.takenAt,
      };
    },
    recover: executor.recover
      ? (step, prepared, target) =>
          executor.recover!(step, preparedSchema.parse(prepared).value, target)
      : undefined,
  };
}
