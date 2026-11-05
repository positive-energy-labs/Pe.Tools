import { z } from "zod";

/**
 * Where a runtime's inputs come from (ADR 0031): the one lane host and shell share. `Store` is a
 * host-opened capability; a browser holds only its {@link SourceProvenance}, never a store or path.
 */
export type InputLane<Store> =
  | { readonly kind: "live"; readonly captureStore?: Store }
  | { readonly kind: "fixture"; readonly name: string }
  | { readonly kind: "recording"; readonly recordingStore: Store; readonly at: string | null };

/** Input kinds a historical body may need; a recording serves only the kinds its bundle covers. */
export const inputKinds = [
  "native",
  "document",
  "work",
  "files",
  "marks",
  "clock",
  "artifacts",
  "receipts",
] as const;
export type InputKind = (typeof inputKinds)[number];

/** The lane as surfaces may show it. A recording names its build, catalog and partial coverage. */
export const sourceProvenanceSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("live"), capturing: z.boolean() }),
  z.strictObject({ kind: z.literal("fixture"), name: z.string() }),
  z.strictObject({
    kind: z.literal("recording"),
    at: z.string().nullable(),
    build: z.string(),
    catalog: z.string(),
    coverage: z.array(z.enum(inputKinds)),
  }),
]);
export type SourceProvenance = z.infer<typeof sourceProvenanceSchema>;
