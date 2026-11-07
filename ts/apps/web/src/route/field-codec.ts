import type { z } from "zod";

/** URLs may contain JSON from typed Pages or plain text from shared links. */
export function decodeField(field: { schema: z.ZodType; initial: unknown }, raw: unknown): unknown {
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
