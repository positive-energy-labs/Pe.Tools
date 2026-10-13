import { endpointFailureSchema, type EndpointFailure } from "@pe/agent-contracts";

/** Provider bodies arrive as JSON, plain text, or JSON embedded in an ACP error message. */
export function classifyEndpointFailure(error: unknown, status?: number): EndpointFailure {
  const record = error && typeof error === "object" ? error : null;
  const existing = endpointFailureSchema.safeParse(
    record && "failure" in record ? record.failure : undefined,
  );
  if (existing.success) return existing.data;
  const raw =
    typeof error === "string"
      ? error
      : error instanceof Error
        ? [error.message, record && "data" in record ? JSON.stringify(record.data) : undefined]
            .filter(Boolean)
            .join("\n")
        : (JSON.stringify(error) ?? "Unknown endpoint error");
  const text = raw.toLowerCase();
  const kind =
    status === 402 ||
    /credit balance|insufficient[_ ](?:quota|credit|funds)|out of credit|billing|payment required|usage limit/.test(
      text,
    )
      ? "billing"
      : status === 401 ||
          status === 403 ||
          /invalid[_ -]?(?:api[_ -]?)?key|authentication|unauthorized|incorrect api key/.test(text)
        ? "auth"
        : /model_not_found|no such model|model.*(?:not found|does not exist|not (?:listed|available|supported))|no .*model|unsupported.*model/.test(
              text,
            )
          ? "model"
          : (status !== undefined && status >= 500) ||
              /unreachable|fetch failed|econnrefused|enotfound|timed? ?out|network|connection (?:closed|reset)/.test(
                text,
              )
            ? "unreachable"
            : "other";
  const messages = {
    billing: "Out of credit or billing limit reached.",
    auth: "Bad API key or access denied.",
    unreachable: "Endpoint unreachable or unavailable.",
    model: "Model not found or unavailable.",
    other: "Endpoint request failed.",
  };
  return { kind, message: `${kind}: ${messages[kind]}`, raw };
}
