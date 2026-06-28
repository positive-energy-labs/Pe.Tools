/**
 * JSON Schema for generic request-form rendering, derived from the generated zod
 * schemas (`z.toJSONSchema`) rather than reflected separately from C#. The zod
 * schema is the single source of truth, so the form schema inherits its
 * validation refinements and can never drift from what the caller validates.
 */
import { z } from "zod";

import type { HostOperationKey } from "../contracts/host-operations.generated.js";
import { hostOperationSchemas } from "../zod/host-op-schemas.generated.js";

export type HostOperationJsonSchema = Record<string, unknown>;

/** JSON Schema for an operation's request, or undefined if it takes no request. */
export function requestJsonSchema(key: HostOperationKey): HostOperationJsonSchema | undefined {
  const schema = (hostOperationSchemas as Record<string, { request?: z.ZodType }>)[key]?.request;
  if (!schema) return undefined;
  try {
    return z.toJSONSchema(schema, { unrepresentable: "any" }) as HostOperationJsonSchema;
  } catch {
    return undefined;
  }
}
