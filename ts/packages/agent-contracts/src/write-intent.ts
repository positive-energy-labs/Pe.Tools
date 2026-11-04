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

const workWriteInputSchema = z.strictObject({ work: workHandleSchema, readWorks: z.record(z.string(), workHandleSchema).optional() });

/** Named boundaries keep declaration emit out of the local generic entry closure (TS 6.0.3). */
type IntentEntry<D extends Command> = Omit<D, "input" | "work"> & {
  authoredInput: D["input"];
  workIntent: WorkIntentBinding;
  input: typeof workWriteInputSchema;
  work: { route: string; bind: (input: unknown, handle: WorkHandle) => { work: WorkHandle } };
};

type WriteEntry<D extends Command, P extends WriteBoundaryBinding["phase"]> = Omit<
  IntentEntry<D>,
  "result"
> & {
  result: ReturnType<typeof writeCommandResultSchema<NonNullable<D["result"]>>>;
  derivation: Pick<WriteBoundaryBinding, "derive" | "preview">;
  writeBoundary: WriteBoundaryBinding & { phase: P };
};

/** The Work-derived entry shape both primitives share; `derivation`, `result` and the seal half are theirs. */
function intentEntry<D extends Command>(
  source: D,
  route: string,
  intent: WorkIntentBinding,
): IntentEntry<D> {
  const { input: _input, work: _work, ...metadata } = source;
  return {
    ...metadata,
    authoredInput: source.input as D["input"],
    workIntent: intent,
    input: workWriteInputSchema,
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
): { [P in K]: IntentEntry<C> & { derivation: Pick<WorkIntentBinding, "derive"> } } {
  const intent = bindIntent(route, key, definition, options);
  return {
    [key]: { ...intentEntry(definition, route, intent), derivation: { derive: intent.derive } },
  } as {
    [P in K]: IntentEntry<C> & { derivation: Pick<WorkIntentBinding, "derive"> };
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
  // A preview shares the apply's derivation, so it must take exactly the apply's input:
  // the constraint refuses a narrower input, the `options` check below a wider one.
  const PC extends Command & { input: C["input"] } = C,
>(
  route: string,
  key: K,
  definition: C,
  options: WorkIntentOptions & {
    preview?: { key: PK; definition: PC } & ([C["input"]] extends [PC["input"]]
        ? unknown
        : { previewInputMustEqualApplyInput: never });
  } = {},
): { [P in K]: WriteEntry<C, "apply"> } & {
  [P in [PK] extends [never] ? `${K}.preview` : PK]: WriteEntry<PC, "preview">;
} {
  const intent = bindIntent(route, key, definition, options);
  const derivation = { derive: intent.derive, preview: (request: unknown) => request };
  type PreviewKey = [PK] extends [never] ? `${K}.preview` : PK;
  const previewKey = (options.preview?.key ?? `${key}.preview`) as PreviewKey;
  const entry = <D extends Command, const P extends WriteBoundaryBinding["phase"]>(
    source: D,
    phase: P,
  ): WriteEntry<D, P> => {
    const { result: _result, ...metadata } = intentEntry(source, route, intent);
    return {
      ...metadata,
      result: writeCommandResultSchema(source.result as NonNullable<D["result"]>),
      derivation,
      writeBoundary: {
        ...intent,
        previewKey: previewKey as string,
        phase,
        preview: derivation.preview,
      },
    };
  };
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
  } as { [P in K]: WriteEntry<C, "apply"> } & {
    [P in PreviewKey]: WriteEntry<PC, "preview">;
  };
}
