import {documentRequestSchema,addressSchema,type Address,type DocumentRequest} from "@pe/agent-contracts";
/**
 * `?target` accepts a schema-validated JSON DocumentRequest for exact picker selections.
 * A document Address (path or cloud GUID) names the document in whichever
 * session holds it open; anything else is a session key and names that session's one open document.
 */
export function parseTarget(
  target: string | null | undefined,
):
  | { kind: "address"; address: Address }
  | { kind: "session"; session: string }
  | { kind: "request"; request: DocumentRequest }
  | { kind: "invalid"; raw: string }
  | null {
  if (!target) return null;
  if (/^[{["]/.test(target.trimStart())) {
    try {
      const request = documentRequestSchema.safeParse(JSON.parse(target));
      return request.success
        ? { kind: "request", request: request.data }
        : { kind: "invalid", raw: target };
    } catch {
      return { kind: "invalid", raw: target };
    }
  }
  const parsed = addressSchema.safeParse(target);
  return parsed.success
    ? { kind: "address", address: parsed.data }
    : { kind: "session", session: target };
}

