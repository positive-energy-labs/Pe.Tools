import { z } from "zod";
import { listSearchCodec, listSearchSchema } from "../../../../packages/agent-contracts/src/list-search.ts";
import { textCodec } from "../../../../packages/agent-contracts/src/route-field.ts";

export type FieldCodec = "list-search" | "text";
type Field = { schema: z.ZodType; initial: unknown; codec?: FieldCodec };

/** The kernel Page and generated address must write the same declared URL codec. */
export function encodeField(field: Pick<Field, "codec"> | undefined, value: unknown): string {
  if (field?.codec === "text") return textCodec.encode(z.string().parse(value));
  if (field?.codec === "list-search") return listSearchCodec.encode(listSearchSchema.parse(value));
  return JSON.stringify(value);
}

/** URLs may contain JSON from typed Pages or plain text from shared links. */
export function decodeField(field: Field, raw: unknown): unknown {
  if (typeof raw === "string" && field.codec) {
    const value = field.codec === "text" ? textCodec.decode(raw) : listSearchCodec.decode(raw);
    const decoded = field.schema.safeParse(value);
    return decoded.success ? decoded.data : field.initial;
  }
  if (typeof raw === "string") {
    try {
      const json = field.schema.safeParse(JSON.parse(raw));
      if (json.success) return json.data;
    } catch {
      // Plain strings and malformed JSON still get the field's own validation below.
    }
  }
  const text = field.schema.safeParse(raw);
  return text.success ? text.data : field.initial;
}
