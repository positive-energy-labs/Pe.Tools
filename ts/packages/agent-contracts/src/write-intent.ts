import { z } from "zod";
import { draftCellSchema } from "./draft.ts";
import { workHandleSchema, type Command, type WorkHandle } from "./command.ts";

/** Operation options are authored cells; suggestions never authorize a write. */
export const writeIntentSchema = z.record(
  z.string(),
  draftCellSchema(z.record(z.string(), z.json())),
);

/** The write boundary owns this envelope for preview and commit alike. */
export const writeResponseSchema = z.object({
  previewOnly: z.boolean(),
  derivedRequest: z.unknown(),
  seal: z.object({
    requestHash: z.string(),
    work: z.unknown(),
    incarnation: z.unknown(),
    dependencies: z.string(),
  }),
  takenAt: z.string(),
});
export const writePreviewSchema = writeResponseSchema
  .extend({
    previewOnly: z.literal(true),
    authoredIntent: z.record(z.string(), z.unknown()).optional(),
  })
  .loose();

export const writeCommandResultSchema = <R extends z.ZodType = z.ZodObject<{}, z.core.$loose>>(
  result: R = z.looseObject({}) as unknown as R,
) =>
  z.union([
    writePreviewSchema,
    z.intersection(result, writeResponseSchema.extend({ previewOnly: z.literal(false) })),
  ]);

/**
 * Work → authored input, for every Work command: the derivation the host runs before a leaf and the
 * `authoredInput` schema the web stages into Work. It carries no preview and no seal.
 */
export interface WorkIntentBinding {
  route: string;
  key: string;
  workspace: boolean;
  derive(work: unknown): unknown;
}

/**
 * A ModelWrite is two catalog entries: a TransactRead preview that seals what it would send, and
 * the ModelWrite that rechecks that seal and commits. The mode is the entry, never an input flag
 * (ADR 0028 write boundary rulings): a preview cannot reach a committing leaf by setting a boolean.
 */
export interface WriteBoundaryBinding extends WorkIntentBinding {
  /** The TransactRead entry whose sealed receipt the write rechecks. */
  previewKey: string;
  phase: "preview" | "apply";
  preview(request: unknown): unknown;
}

interface WorkIntentOptions {
  workspace?: boolean;
  derive?: (work: unknown) => unknown;
}

/** The Work-derived entry shape both primitives share; `derivation`, `result` and the seal half are theirs. */
function intentEntry<D extends Command>(source: D, route: string, intent: WorkIntentBinding) {
  const { input: _input, work: _work, ...metadata } = source;
  return {
    ...metadata,
    authoredInput: source.input as D["input"],
    workIntent: intent,
    input: z.strictObject({ work: workHandleSchema }),
    work: { route, bind: (_input: unknown, handle: WorkHandle) => ({ work: handle }) },
  };
}

function bindIntent(
  route: string,
  key: string,
  definition: Command,
  options: WorkIntentOptions,
): WorkIntentBinding {
  const derive =
    options.derive ??
    ((work: unknown) =>
      definition.input.parse(
        (work as { writeIntent?: Record<string, { edit?: { value: unknown } }> }).writeIntent?.[key]
          ?.edit?.value ?? {},
      ));
  return { route, key, workspace: options.workspace ?? false, derive };
}

/**
 * Primitive 1, for every Work command: derive the authored input from Work. A SessionWrite capture
 * is only this; it writes nothing to the model, so it has no preview entry and no seal (ADR 0028).
 */
export function workIntent<const K extends string, const C extends Command>(
  route: string,
  key: K,
  definition: C,
  options: WorkIntentOptions = {},
) {
  const intent = bindIntent(route, key, definition, options);
  return {
    [key]: { ...intentEntry(definition, route, intent), derivation: { derive: intent.derive } },
  } as {
    [P in K]: ReturnType<typeof intentEntry<C>> & { derivation: { derive(work: unknown): unknown } };
  };
}

/**
 * Primitive 2, only for a command whose catalog axis reaches Revit (Effect ModelWrite): the apply
 * entry plus its sealed TransactRead preview. `command-axes.ts` refuses a boundary on any other axis.
 */
export function workWriteCommands<
  const K extends string,
  const C extends Command,
  const PK extends string = never,
  const PC extends Command = C,
>(
  route: string,
  key: K,
  definition: C,
  options: WorkIntentOptions & { preview?: { key: PK; definition: PC } } = {},
) {
  const intent = bindIntent(route, key, definition, options);
  const derivation = { derive: intent.derive, preview: (request: unknown) => request };
  type PreviewKey = [PK] extends [never] ? `${K}.preview` : PK;
  const previewKey = (options.preview?.key ?? `${key}.preview`) as PreviewKey;
  const entry = <D extends Command, const P extends WriteBoundaryBinding["phase"]>(
    source: D,
    phase: P,
  ) => ({
    ...intentEntry(source, route, intent),
    result: writeCommandResultSchema(source.result as NonNullable<D["result"]>),
    derivation,
    writeBoundary: {
      ...intent,
      previewKey: previewKey as string,
      phase,
      preview: derivation.preview,
    },
  });
  // A Pod entry carries its own axes; its preview inherits them as a rolled-back read.
  const axes = (definition as { axes?: import("./catalog.ts").CatalogAxes }).axes;
  const previewDefinition = (options.preview?.definition ?? {
    ...definition,
    says: `Preview, nothing committed: ${definition.says}`,
    ...(axes ? { axes: { ...axes, effect: "TransactRead", rollsBack: true } } : {}),
  }) as PC;
  return {
    [key]: entry(definition, "apply"),
    [previewKey]: entry(previewDefinition, "preview"),
  } as { [P in K]: ReturnType<typeof entry<C, "apply">> } & {
    [P in PreviewKey]: ReturnType<typeof entry<PC, "preview">>;
  };
}
