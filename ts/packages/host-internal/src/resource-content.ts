import type { ReadingRequest } from "@pe/agent-contracts";

// Sampling is evidence, not census content (ADR 0033). Keep errors and unread/observed presence.
// The SDK queue's running request is whichever read the poll caught in flight, often a census
// `doc.list`: it is null or set from one poll to the next, so its presence is sampling too.
const SAMPLED = new Set(["uptimeSeconds", "privateBytes", "runningKey", "runningRequestId", "runningStartedUtc"]);
function sampledContent(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sampledContent);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).flatMap(([key, value]) =>
    SAMPLED.has(key) ? [] : [[key,
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
      // The catalog's version is its own rows. The machine and the recents are other readings with
      // their own owners and versions (a read that needs them reads them: `chat.context`,
      // `bind.picker`), `sources` is each source's outcome for this poll, and document and recent rows
      // are projections of those two. Counted here, host startup raced every evaluation of a first
      // publication: the recents budget, the machine's sessions and the Pod import each land alone.
      const { at: _sampledAt, machine: _machine, recents: _recents, sources: _sources, capabilities, ...catalog } =
        value as Record<string, unknown>;
      return { ...catalog, capabilities: Array.isArray(capabilities)
        ? capabilities.filter((row) => row?.kind !== "document" && row?.kind !== "recent") : capabilities };
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
