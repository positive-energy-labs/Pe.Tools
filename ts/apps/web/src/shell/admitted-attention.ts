import { agentFields, type RouteGraphJson, type RouteBindings, type ViewCodec } from "@pe/agent-contracts";

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
  graph: RouteGraphJson,
  codecs: RouteBindings["codecs"],
): Attention | null {
  const fields = agentFields(graph.fields);
  if (!fields.length) return null;
  // X04 fill (Opus): `write` encodes each key through codecs[field.codec].encode (a string);
  // `read` decodes through codecs[field.codec].decode (`{ok,value}`; throw on `ok:false` or an
  // unknown key, the bridge answers "failed"), exactly as admitted-address.ts encodePage/restore do.
  void codecs;
  throw Error("X04 scaffold: createAttention body not yet filled");
}
