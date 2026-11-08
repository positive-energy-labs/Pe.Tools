import type { ReadingRequest } from "@pe/agent-contracts";

// Sampling is evidence, not census content (ADR 0033). Keep errors and unread/observed presence.
function sampledContent(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sampledContent);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).flatMap(([key, value]) =>
    key === "uptimeSeconds" || key === "privateBytes" ? [] : [[key,
      key === "observedAtUtc" || key === "attemptedAtUtc" || key === "lastTickUtc" || key === "activeDocumentObservedAtUnixMs"
        ? value === null ? null : true
        : sampledContent(value),
    ]],
  ));
}

/** Version only: the decoded resource and recorded evidence retain every sampling field. */
export function resourceContent(request: ReadingRequest, value: unknown): unknown {
  switch (request.kind) {
    case "machine":
    case "inventory":
      return sampledContent(value);
    case "capabilities": {
      const { at: _sampledAt, ...catalog } = value as Record<string, unknown>;
      return { ...catalog, machine: sampledContent(catalog.machine) };
    }
    case "sdk": {
      const content = sampledContent(value);
      if (request.read !== "sessions" || !content || typeof content !== "object" || !("result" in content))
        return content;
      const result = content.result;
      if (!result || typeof result !== "object" || Array.isArray(result)) return content;
      // SessionListResult.requestId identifies the poll, not an operation running in its queue.
      const { requestId: _poll, ...facts } = result as Record<string, unknown>;
      return { ...content, result: facts };
    }
    default:
      return value;
  }
}
