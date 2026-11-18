import { decode, subjectCode, uniqueIdSchema } from "@pe/agent-contracts";
import type { DuctSnapshot } from "./types.ts";

type Elements = Pick<DuctSnapshot, "nodes" | "segments">;
/** Work identity comes from the captured native UniqueId, never the session-local id. */
export const elementSubject = (element: { uniqueId: string }, port?: number) =>
  subjectCode({ keyKind: "UniqueId", key: uniqueIdSchema.parse(element.uniqueId),
    ...(port === undefined ? {} : { sub: { port } }) });

/** Resolve an admitted Work subject against this acquisition before constructing a native write. */
export function workElementId(snapshot: Elements, code: string): number {
  const ref = decode(code);
  if (!ref.ok || ref.value.keyKind !== "UniqueId" || ref.value.source || ref.value.placement)
    throw Error(`Unavailable Work subject: ${code}`);
  const element = [...snapshot.nodes, ...snapshot.segments].find(e => e.uniqueId === ref.value.key);
  const sub = ref.value.sub;
  if (!element || (sub && !("port" in sub && element.connectors.some(c => c.index === sub.port))))
    throw Error(`Work subject is absent from the acquisition: ${code}`);
  return element.id;
}
