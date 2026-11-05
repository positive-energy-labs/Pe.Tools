import { agentFields, type AdmittedFields, type RouteBindings, type ViewCodec } from "@pe/agent-contracts";

/**
 * Attention for an admitted route (ADR 0030 rule 10): an opt-in read projection of the fields whose
 * agent policy is not "none", written and read with the admission's own codecs. Null when the route
 * declares no agent field, so it publishes nothing. Pea's patch lands as a pea-origin owner move
 * (admitted-mount peaMove), which the page policy fences to agent "set" keys (page-port.ts) and the
 * address pushes so Back undoes it. Not a lease invariant; no second state.
 */
export interface Attention extends ViewCodec {
  readonly keys: readonly string[];
}

export function createAttention(
  graphFields: AdmittedFields,
  codecs: RouteBindings["codecs"],
): Attention | null {
  const fields = agentFields(graphFields).map(
    ([key, field]) => [key, codecs[(field as { codec: string }).codec]!] as const,
  );
  if (!fields.length) return null;
  const byKey = new Map(fields);
  return {
    keys: fields.map(([key]) => key),
    write: (page) =>
      Object.fromEntries(
        fields.map(([key, codec]) => {
          const text = codec.encode((page as Record<string, unknown>)[key]);
          if (typeof text !== "string") throw Error(`Attention codec for ${key} wrote no text`);
          return [key, text];
        }),
      ),
    read: (patch) =>
      Object.fromEntries(
        Object.entries(patch).map(([key, text]) => {
          const codec = byKey.get(key);
          if (!codec) throw Error(`${key} is not an attention field`);
          const decoded = codec.decode(text) as { ok: true; value: unknown } | { ok: false; reason: string };
          if (!decoded.ok) throw Error(`${key} does not read as its codec writes it: ${decoded.reason}`);
          return [key, decoded.value];
        }),
      ),
  };
}
