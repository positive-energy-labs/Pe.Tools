import { z } from "zod";

const documentAddressPattern =
  /^(?:[A-Za-z]:[\\/]|\\\\)|^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A Revit document's cloud model GUID or absolute Windows path. */
export const addressSchema = z
  .string()
  .refine(
    (value) => documentAddressPattern.test(value),
    "an Address must be a cloud model GUID or absolute path",
  )
  .brand<"Address">();
export type Address = z.infer<typeof addressSchema>;

export const address = (value: string): Address => addressSchema.parse(value);

/** GUID case and Windows path case/separators do not distinguish documents. */
export const sameAddress = (a: Address, b: Address): boolean =>
  a.replaceAll("/", "\\").toLowerCase() === b.replaceAll("/", "\\").toLowerCase();

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
): A | null => (value && at && sameAddress(value.reading.at, at) ? value : null);

/** Version drift is meaningful only between readings of the same document. */
export const superseded = (older: Reading, newer: Reading): boolean =>
  sameAddress(older.at, newer.at) && older.version !== newer.version;
