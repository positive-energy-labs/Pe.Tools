import { createHash } from "node:crypto";
import { documentMarks, type DocumentMarks, type DocumentRef } from "./document-marks.ts";
import { lifetime } from "./family-actions.ts";
import type { RevitBridge } from "./bridge.ts";
import type { SdkReceiptReader } from "./native-receipts.ts";
import { z } from "zod";
import {
  canonicalRouteInput,
  writeResponseSchema,
  workHandleSchema,
  workBinding,
  tools,
  type Tool,
  type WorkHandle,
  type WriteSeal,
  type Consumed,
  type WorkIntentBinding,
  type WriteBoundaryBinding,
} from "@pe/agent-contracts";
import { refused, type CommandContext, type CommandExecutor } from "./command-executor.ts";

const hash = (value: unknown) =>
  createHash("sha256").update(canonicalRouteInput(value)).digest("hex");
// Dependency and path collections are sets; request arrays retain their semantic order.
const canonicalSet = <T>(values: readonly T[]): T[] =>
  [...new Set(values.map(canonicalRouteInput))].sort().map((value) => JSON.parse(value));
/** The document mark the plan read, as the seal carries it (ADR 0030 rule 4). */
export const sealedDocumentMark = (marks: DocumentMarks, ref: DocumentRef): WriteSeal["documentMark"] => ({
  session: ref.session,
  openId: ref.openId,
  observedSince: marks.observedSince ?? null,
  changedAt: marks.changedAt(ref),
});
export interface WriteSealInput {
  request: unknown;
  input: unknown;
  work: WorkHandle;
  incarnation: unknown;
  documentMark: WriteSeal["documentMark"];
  /** Work, file, receipt and incarnation dependencies; the document mark is sealed by name, never as a probe. */
  consumed: readonly Exclude<Consumed, { kind: "document-mark" }>[];
  evidence: unknown;
}
export function writeSeal({ request, input, work, incarnation, documentMark, consumed, evidence }: WriteSealInput): WriteSeal {
  const dependencies = canonicalSet(
    consumed
      .map((item) =>
        item.kind === "work"
          ? {
              ...item,
              probe: {
                ...item.probe,
                paths: canonicalSet(item.probe.paths),
                edits: canonicalSet(item.probe.edits ?? []),
              },
            }
          : item,
      ),
  );
  return {
    requestHash: hash(request),
    work: { handle: work, consumed: dependencies.filter((item) => item.kind === "work") },
    documentMark,
    incarnation,
    dependencies: hash({ input, dependencies, evidence }),
  };
}
const preparedSchema = z.object({
  input: z.record(z.string(), z.unknown()),
  value: z.unknown(),
  seal: writeResponseSchema.shape.seal,
  previewOnly: z.boolean(),
});

type WorkSpec = NonNullable<Tool["work"]> & { schema: z.ZodType<Record<string, unknown>> };
const workSpec = (
  route: string,
  registeredWork?: import("@pe/agent-contracts").RouteStateSpec<z.ZodType>,
) => (registeredWork ?? (tools[route as keyof typeof tools] as Tool)?.work)! as WorkSpec;

/** Primitive 1 on the host: admit the Work to its document, read the authored cells, derive the input. */
async function deriveFromWork(
  ctx: CommandContext,
  definition: import("@pe/agent-contracts").Command,
  hooks: WorkIntentBinding,
  spec: WorkSpec,
  bridge: RevitBridge["Service"],
  deps: { sdk?: SdkReceiptReader },
) {
  const { work, readWorks } = z.object({ work: workHandleSchema, readWorks: z.record(z.string(), workHandleSchema).optional() }).parse(definition.input.parse(ctx.admission.input));
  if (ctx.admission.target.kind !== "document") throw refused("Exact document required");
  const target = ctx.admission.target.ref;
  const observed = await lifetime(bridge, target, false, deps);
  const address = observed.session.state?.openDocuments.find(
    (doc) => doc.openId === target.openId,
  )?.address;
  if (!workBinding(work.key).admits(target, address, hooks.workspace))
    throw refused("Work belongs to another document", "work.target");
  // Each owner also resolves the native incarnation. The address check uses that same bound dependency below.
  const doc = (await ctx.selectWork(spec, work, (_doc, cells) => ({
    cells: cells.filter(({ cell }) => cell.edit).map(({ path }) => path),
    facts: Object.keys(_doc as object)
      .filter((name) => name !== "writeIntent")
      .map((name) => [name]),
    edits: spec.editable,
  }))) as { writeIntent?: Record<string, { edit?: { value: Record<string, unknown> } }> };
  const input = { ...(hooks.derive(doc) as object), work, ...(readWorks ? { readWorks } : {}) };
  return { work, input, target, observed };
}
const withInput = (ctx: CommandContext, input: Record<string, unknown>): CommandContext => ({
  ...ctx,
  admission: { ...ctx.admission, input },
});

const intentPrepared = z.object({ input: z.record(z.string(), z.unknown()), value: z.unknown() });
/**
 * Primitive 1's executor half, for a Work command with no seal (a SessionWrite capture): derive the
 * input from Work, then run the leaf. No preview entry, no seal, no recheck; it writes nothing to the model.
 */
export function workIntentBoundary(
  executor: CommandExecutor,
  bridge: RevitBridge["Service"],
  deps: { sdk?: SdkReceiptReader } = {},
): CommandExecutor {
  const definition = executor.definition as import("@pe/agent-contracts").Command & {
    workIntent: WorkIntentBinding;
  };
  const hooks = definition.workIntent;
  if (typeof hooks?.derive !== "function")
    throw Error("Work command requires a typed derive binding");
  const spec = workSpec(hooks.route);
  return {
    ...executor,
    boundary: "work",
    prepared: intentPrepared,
    bind: async (ctx) => {
      const { input } = await deriveFromWork(ctx, definition, hooks, spec, bridge, deps);
      const bound = await executor.bind(withInput(ctx, input));
      return {
        ...bound,
        prepare: async () => ({ input, value: executor.prepared.parse(await bound.prepare?.()) }),
      };
    },
    run: async (ctx, execution) => {
      const p = intentPrepared.parse(execution.prepared);
      return executor.run(withInput(ctx, p.input), { ...execution, prepared: p.value });
    },
    recover: executor.recover
      ? (step, prepared, target) =>
          executor.recover!(step, intentPrepared.parse(prepared).value, target)
      : undefined,
  };
}

// TODO: docs/features/routes/LEDGER.md#s3-native-seal Prove plan/refetch/apply in browser against a controlled Revit session.
/** Keep native derivation/recovery in its owner; admit only authored, revisioned Work. */
export function workWriteBoundary(
  executor: CommandExecutor,
  bridge: RevitBridge["Service"],
  deps: { sdk?: SdkReceiptReader } = {},
  registeredWork?: import("@pe/agent-contracts").RouteStateSpec<z.ZodType>,
  /** The preview entry has its own executor (a native plan leaf); otherwise it is synthesized. */
  ownsPreview = false,
): CommandExecutor {
  const definition = executor.definition as import("@pe/agent-contracts").Command & {
    authoredInput: z.ZodType;
    writeBoundary: WriteBoundaryBinding;
  };
  const hooks = definition.writeBoundary;
  if (hooks?.phase !== "preview" && hooks?.phase !== "apply")
    throw Error("Write command requires a preview or apply phase");
  if (!hooks || typeof hooks.derive !== "function" || typeof hooks.preview !== "function")
    throw Error("Write command requires typed derive and preview bindings");
  if (!executor.seal) throw Error("Write command requires a producer-owned seal projection");
  const project = executor.seal;
  const { route } = hooks;
  const spec = workSpec(route, registeredWork);
  return {
    ...executor,
    boundary: "work",
    prepared: preparedSchema,
    bind: async (ctx) => {
      const marks = documentMarks(bridge);
      // The entry is the mode: seal at the plan, recheck at the ModelWrite.
      const previewOnly = hooks.phase === "preview";
      const { work, input, target, observed } = await deriveFromWork(
        ctx,
        definition,
        hooks,
        spec,
        bridge,
        deps,
      );
      const preview = ctx.read
        .receipts()
        .filter(
          (row) =>
            row.key === hooks.previewKey &&
            row.state === "succeeded" &&
            canonicalRouteInput(row.target) === canonicalRouteInput(ctx.admission.target),
        )
        .at(-1);
      const derivedContext = withInput(ctx, input);
      // Reproduce generated paths and plan references from this exact preview, never a new caller payload.
      derivedContext.admission.id = !previewOnly && preview ? preview.id : ctx.admission.id;
      const bound = await executor.bind(derivedContext);
      const prepare = async () => {
        const value = executor.prepared.parse(await bound.prepare?.());
        if (!previewOnly && !preview)
          throw refused("Plan the current Work first", "preview.stale");
        // The seal names the document mark itself; mark probes (the plan's sealed mark below, a family
        // read's takenAt) are the journal's dispatch guard and stay out of the hash.
        const dependencies = [...ctx.consumed, ...(bound.consumes ?? [])].filter(
          (item): item is Exclude<Consumed, { kind: "document-mark" }> => item.kind !== "document-mark",
        );
        const projection = project(value);
        await marks.settled?.();
        const seal = writeSeal({
          request: projection.request,
          input,
          work,
          incarnation: { target, process: observed.process },
          documentMark: sealedDocumentMark(marks, target),
          consumed: dependencies,
          evidence: projection.evidence,
        });
        const previousSeal =
          preview?.state === "succeeded"
            ? (preview.result as { seal?: Record<string, unknown> }).seal
            : undefined;
        if (!previewOnly && canonicalRouteInput(previousSeal) !== canonicalRouteInput(seal)) {
          const changed = Object.keys(seal).filter(
            (key) =>
              canonicalRouteInput(previousSeal?.[key]) !==
              canonicalRouteInput(seal[key as keyof typeof seal]),
          );
          throw refused(
            `Plan changed; plan the current Work again (${changed.join(", ")})`,
            "preview.stale",
          );
        }
        return { input, value, seal, previewOnly };
      };
      // The journal re-probes consumes at every gate, including `validateDispatch` just before the
      // native step leaves the bridge queue: the plan's sealed mark guards that window too.
      const plannedMark =
        !previewOnly && preview?.state === "succeeded"
          ? (preview.result as { seal?: WriteSeal }).seal?.documentMark
          : undefined;
      return {
        ...bound,
        consumes: [
          ...(bound.consumes ?? []),
          ...(plannedMark
            ? [
                {
                  kind: "document-mark" as const,
                  probe: {
                    ref: target,
                    sealed: { observedSince: plannedMark.observedSince, changedAt: plannedMark.changedAt },
                  },
                  expected: true as const,
                },
              ]
            : []),
        ],
        effects: previewOnly ? [] : bound.effects,
        claims: [
          ...(bound.claims ?? []),
          ...(!previewOnly && preview ? [{ kind: "receipt" as const, id: preview.id }] : []),
        ],
        // Seal eligibility is read-only; rederive again after consent to catch intervening changes.
        preflight: previewOnly
          ? undefined
          : async () => {
              await prepare();
            },
        prepare,
      };
    },
    run: async (ctx, execution) => {
      const p = preparedSchema.parse(execution.prepared);
      if (p.previewOnly && !ownsPreview)
        return {
          previewOnly: true,
          derivedRequest: project(p.value).request,
          authoredIntent: p.input,
          seal: p.seal,
        };
      const result = await executor.run(withInput(ctx, p.input), {
        ...execution,
        prepared: p.value,
      });
      const retires = executor.retires;
      if (!p.previewOnly && retires) {
        const paths = retires(result);
        if (paths.length)
          await execution.retireWork((p.input.work as WorkHandle).key, route, paths);
      }
      return {
        ...(result as object),
        previewOnly: p.previewOnly,
        derivedRequest: project(p.value).request,
        seal: p.seal,
      };
    },
    recover: executor.recover
      ? (step, prepared, target) =>
          executor.recover!(step, preparedSchema.parse(prepared).value, target)
      : undefined,
  };
}
