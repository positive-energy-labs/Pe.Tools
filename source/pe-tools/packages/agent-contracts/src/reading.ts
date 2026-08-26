import { z } from "zod";

const documentAddress =
  /^(?:[A-Za-z]:[\\/]|\\\\)|^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A Revit document's cloud model GUID or absolute Windows path. */
export const addressSchema = z
  .string()
  .refine(
    (value) => documentAddress.test(value),
    "an Address must be a cloud model GUID or absolute path",
  )
  .brand<"Address">();
export type Address = z.infer<typeof addressSchema>;

export const address = (value: string): Address => addressSchema.parse(value);

export const readingSchema = z.object({
  at: addressSchema,
  version: z.string().nullable(),
  observedAt: z.iso.datetime(),
});
export type Reading = z.infer<typeof readingSchema>;

/** A persisted read renders only at the document it describes. */
export const here = <A extends { reading: Reading }>(
  value: A | null | undefined,
  at: Address | null,
): A | null => (value && at && value.reading.at === at ? value : null);

/** Version drift is meaningful only between readings of the same document. */
export const superseded = (older: Reading, newer: Reading): boolean =>
  older.at === newer.at && older.version !== newer.version;
