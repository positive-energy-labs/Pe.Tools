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
 * One Work write is two catalog entries: a TransactRead preview that seals what it would send, and
 * the ModelWrite that rechecks that seal and commits. The mode is the entry, never an input flag
 * (ADR 0028 write boundary rulings): a preview cannot reach a committing leaf by setting a boolean.
 */
export interface WriteBoundaryBinding {
  route: string;
  /** The committing entry. */
  key: string;
  /** The TransactRead entry whose sealed receipt the write rechecks. */
  previewKey: string;
  phase: "preview" | "apply";
  workspace: boolean;
  derive(work: unknown): unknown;
  preview(request: unknown): unknown;
}

const workWriteInputSchema = z.strictObject({ work: workHandleSchema });
/** A named boundary keeps declaration emit out of the local generic entry closure (TS 6.0.3). */
type WriteEntry<
  D extends Command,
  A extends z.ZodType,
  P extends WriteBoundaryBinding["phase"],
> = Omit<D, "input" | "work" | "result"> & {
  result: ReturnType<typeof writeCommandResultSchema<NonNullable<D["result"]>>>;
  derivation: Pick<WriteBoundaryBinding, "derive" | "preview">;
  authoredInput: A;
  writeBoundary: WriteBoundaryBinding & { phase: P };
  input: typeof workWriteInputSchema;
  work: { route: string; bind: (input: unknown, handle: WorkHandle) => { work: WorkHandle } };
};

export function workWriteCommands<
  const K extends string,
  const C extends Command,
  const PK extends string = never,
  const PC extends Command = C,
>(
  route: string,
  key: K,
  definition: C,
  options: {
    workspace?: boolean;
    derive?: (work: unknown) => unknown;
    preview?: { key: PK; definition: PC };
  } = {},
): { [P in K]: WriteEntry<C, C["input"], "apply"> } & {
  [P in [PK] extends [never] ? `${K}.preview` : PK]: WriteEntry<PC, C["input"], "preview">;
} {
  const authoredInput = definition.input as C["input"];
  const derivation = {
    derive:
      options.derive ??
      ((work: unknown) =>
        authoredInput.parse(
          (work as { writeIntent?: Record<string, { edit?: { value: unknown } }> }).writeIntent?.[
            key
          ]?.edit?.value ?? {},
        )),
    preview: (request: unknown) => request,
  };
  type PreviewKey = [PK] extends [never] ? `${K}.preview` : PK;
  const previewKey = (options.preview?.key ?? `${key}.preview`) as PreviewKey;
  const entry = <D extends Command, const P extends WriteBoundaryBinding["phase"]>(
    source: D,
    phase: P,
  ): WriteEntry<D, C["input"], P> => {
    const { input: _input, work: _work, result: _result, ...metadata } = source;
    return {
      ...metadata,
      result: writeCommandResultSchema(source.result as NonNullable<D["result"]>),
      derivation,
      authoredInput,
      writeBoundary: {
        route,
        key: key as string,
        previewKey: previewKey as string,
        phase,
        workspace: options.workspace ?? false,
        ...derivation,
      },
      input: workWriteInputSchema,
      work: { route, bind: (_input: unknown, handle: WorkHandle) => ({ work: handle }) },
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
  } as { [P in K]: ReturnType<typeof entry<C, "apply">> } & {
    [P in PreviewKey]: ReturnType<typeof entry<PC, "preview">>;
  };
}
