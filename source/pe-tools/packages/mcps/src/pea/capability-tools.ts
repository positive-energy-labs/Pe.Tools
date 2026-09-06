/**
 * The three doors plus the one Scope door.
 *
 * `pe_find` ranks the one capability catalog (no query → the map plus the connected sessions).
 * `pe_read` runs any row with `mutates: false`. `pe_do` runs any row. Two runners rather than one
 * because approval is per tool category: `pe_read` is `read` and never prompts under the `ask`
 * access level, `pe_do` is `execute` and does. No tool takes a target input: every run resolves
 * its session and document from the Scope frozen into the turn at admission (`turnOf`), and every
 * result carries `revision` (the Scope revision it ran under) and `target` (what the host actually
 * resolved to), so the transcript card shows what was touched, not what was typed.
 */
import { createTool } from "@mastra/core/tools";
import z from "zod";
import {
  bridgeSelector,
  capabilityCatalogSchema,
  capabilityKindSchema,
  capabilityMap,
  capabilityNeedsSchema,
  emptyScope,
  findCapabilities,
  message,
  parsePodKey,
  parseRouteKey,
  putScopeResultSchema,
  scopeDocument,
  scopeSchema,
  scopePin,
  turnOf,
  type Capability,
  type CapabilityCatalog,
  type ResolvedTarget,
  type Scope,
} from "@pe/agent-contracts";
import { HostRpcCaller } from "../shared/host-rpc-caller.ts";
import { coerceJsonObject } from "../shared/coerce.ts";
import { resolveHostBaseUrl } from "../shared/host-config.ts";
import { bundledPeaSkills } from "./skills.ts";

type PeaProductToolContext = { hostBaseUrl?: string; workspaceKey?: string };
let productContext: PeaProductToolContext = {};
export function configurePeaProductToolContext(next: PeaProductToolContext): void {
  productContext = next;
}
function base(): string {
  return resolveHostBaseUrl(productContext.hostBaseUrl).replace(/\/$/, "");
}
export const peaHostBaseUrl = base;

/** What the Scope NAMES, as a target: the fallback when a receipt carries no resolved target. */
const namedTarget = (scope: Scope): ResolvedTarget => ({
  session: scopePin(scope),
  document: scopeDocument(scope),
});

/** The turn's frozen Scope; a call outside a chat turn (CLI, MCP) runs under the empty Scope. */
function scopeOf(context: unknown): { scope: Scope; revision: number } {
  const turn = turnOf(context);
  return turn ? { scope: turn.scope, revision: turn.revision } : { scope: emptyScope, revision: 0 };
}

const scopeQuery = (scope: Scope): string => {
  const query = new URLSearchParams();
  const document = scopeDocument(scope);
  const pin = scopePin(scope);
  if (document) query.set("doc", document);
  if (pin) query.set("pin", pin);
  return query.toString();
};

export const peFind = createTool({
  id: "pe_find",
  description:
    "Find a capability. No query returns the map: connected Revit sessions with their active document and custody, counts per kind, top rows per kind, and which sources answered. A query ranks rows across host operations (op:), the collaborative route documents you co-edit with the user and their commands (route:), pod buttons the user presses in Revit's Do palette (pod:), and skills (skill:). Filter with kind, needs, mutates. Every row is visible; nothing is tiered or hidden. Then pe_read a non-mutating row or pe_do any row.",
  inputSchema: z.object({
    query: z.string().optional().describe("Keywords describing what you need."),
    kind: capabilityKindSchema.optional(),
    needs: capabilityNeedsSchema.optional(),
    mutates: z.boolean().optional(),
    limit: z.number().int().min(1).max(50).default(8),
  }),
  execute: async (input, context) => {
    const { scope, revision } = scopeOf(context);
    const catalog = await readCatalog(scope);
    if ("isError" in catalog) return catalog;
    const filtered = input.query || input.kind || input.needs || input.mutates !== undefined;
    if (!filtered)
      return {
        at: catalog.at,
        scope,
        revision,
        bridgeSessionId: catalog.bridgeSessionId,
        sessions: catalog.sessions,
        sources: catalog.sources,
        map: capabilityMap(catalog.capabilities),
        hint: "Query pe_find for rows. pe_read runs a row that does not mutate; pe_do runs any row and is approval-gated. A session's custody says what the SDK will allow (observed = reads only).",
      };
    const rows = findCapabilities(catalog.capabilities, input);
    return {
      at: catalog.at,
      sources: catalog.sources,
      matches: rows.map((row) => ({
        key: row.key,
        kind: row.kind,
        title: row.title,
        description: row.description,
        needs: row.needs,
        mutates: row.mutates,
        actor: row.actor,
        input: row.input,
      })),
    };
  },
});

const runInputSchema = z.object({
  key: z.string().min(1).describe("A capability key from pe_find."),
  input: z.unknown().optional().describe("Matches the row's input schema."),
  expectedRevision: z
    .number()
    .int()
    .nonnegative()
    .optional()
    .describe(
      "Route rows only: the revision from the route read. Required for route:<name>.propose; a command omits it to run against the current revision.",
    ),
  timeoutSeconds: z.number().min(5).max(900).default(300),
});
type RunInput = z.infer<typeof runInputSchema>;

export const peRead = createTool({
  id: "pe_read",
  description:
    "Run one capability that does not mutate: an op: row with mutates false, a route: document read, or a skill: body. Refuses mutating rows with a hint to use pe_do. Split from pe_do so reads never wait on an approval prompt. Runs under this thread's Scope; the result names the revision and the resolved target.",
  inputSchema: runInputSchema,
  execute: (input, context) =>
    runCapability(input, context, (row) =>
      row.mutates ? `'${row.key}' mutates; run it with pe_do (approval-gated).` : null,
    ),
});

export const peDo = createTool({
  id: "pe_do",
  description:
    "Do one capability by key from pe_find: any op: row, route:<name>.propose (patch inside the write mask), route:<name>.<command>, or a pod: button. Approval-gated because it may mutate; use pe_read for rows that do not. Human-only rows refuse you with a hint: ask the user to press it. Runs under this thread's Scope (no target input); the result names the Scope revision it ran under and the session and document the host resolved to.",
  inputSchema: runInputSchema,
  execute: (input, context) => runCapability(input, context, () => null),
});

async function runCapability(
  input: RunInput,
  context: unknown,
  gate: (row: Capability) => string | null,
): Promise<Record<string, unknown>> {
  const { scope, revision } = scopeOf(context);
  const catalog = await readCatalog(scope);
  if ("isError" in catalog) return catalog;
  const row = catalog.capabilities.find((candidate) => candidate.key === input.key);
  if (!row) return refuse(input.key, `Unknown capability '${input.key}'. Find keys with pe_find.`);
  if (row.actor === "human")
    return refuse(
      row.key,
      `'${row.key}' is human-only. Ask the user to press it in the ${row.title.split(":")[0]} workspace.`,
    );
  const refusal = gate(row);
  if (refusal) return refuse(row.key, refusal);
  try {
    const outcome = await dispatch(row, input, scope, requestIdentity(context));
    return { key: row.key, kind: row.kind, revision, ...outcome };
  } catch (error) {
    return refuse(row.key, message(error));
  }
}

type Outcome = { ok: boolean; target: ResolvedTarget; result: unknown; elapsedMs?: number };

async function dispatch(
  row: Capability,
  input: RunInput,
  scope: Scope,
  requestId: string,
): Promise<Outcome> {
  const coerced = coerceJsonObject(input.input);
  const payload: Record<string, unknown> =
    coerced && typeof coerced === "object" ? (coerced as Record<string, unknown>) : {};
  const scopeTarget = namedTarget(scope);
  switch (row.kind) {
    case "op": {
      const caller = new HostRpcCaller({
        hostBaseUrl: base(),
        bridgeSessionId: bridgeSelector(scope),
        timeoutMs: input.timeoutSeconds * 1000,
      });
      const result = await caller.callOperation(row.key.slice("op:".length), payload, "compact");
      return {
        ok: result.ok,
        target: result.ok && result.resolvedTarget ? result.resolvedTarget : scopeTarget,
        result: result.ok ? result.response : result,
        elapsedMs: result.elapsedMs,
      };
    }
    case "skill": {
      const skill = bundledPeaSkills.find((entry) => `skill:${entry.name}` === row.key);
      return { ok: true, target: scopeTarget, result: skill?.content ?? "" };
    }
    case "pod": {
      const pod = parsePodKey(row.key);
      if (!pod) throw new Error(`Malformed pod key '${row.key}'.`);
      // A pod button is the pods route's `run` command, so its receipt lands in the Pods document.
      return routeWrite("pods", "command", scope, input.expectedRevision, {
        command: "run",
        input: { entrypoint: pod.entrypoint, workspaceKey: pod.workspace, ...payload },
        requestId,
      });
    }
    case "route-doc":
    case "route-command": {
      const parsed = parseRouteKey(row.key);
      if (!parsed) throw new Error(`Malformed route key '${row.key}'.`);
      if (parsed.member === undefined) {
        const result = await routeFetch(
          `/pe/route-state/${encodeURIComponent(parsed.route)}?${scopeQuery(scope)}`,
        );
        return { ok: !("isError" in result), target: scopeTarget, result };
      }
      if (row.kind === "route-doc") {
        if (input.expectedRevision === undefined)
          throw new Error(`Read route:${parsed.route} first and pass its expectedRevision.`);
        return routeWrite(parsed.route, "apply", scope, input.expectedRevision, {
          patches: payload.patches,
        });
      }
      return routeWrite(parsed.route, "command", scope, input.expectedRevision, {
        command: parsed.member,
        input: payload,
        requestId,
      });
    }
  }
}

/** A route write under the Scope. A command with no expectedRevision runs against the current one. */
async function routeWrite(
  route: string,
  suffix: "apply" | "command",
  scope: Scope,
  expectedRevision: number | undefined,
  body: Record<string, unknown>,
): Promise<Outcome> {
  const query = scopeQuery(scope);
  const encoded = encodeURIComponent(route);
  const revision =
    expectedRevision ??
    (await routeFetch(`/pe/route-state/${encoded}?${query}`).then((view) =>
      typeof view.revision === "number" ? view.revision : 0,
    ));
  const result = await routeFetch(`/pe/agent/route-state/${encoded}/${suffix}?${query}`, {
    ...body,
    expectedRevision: revision,
  });
  // A command whose receipt names the target it resolved to (instances, pods) wins over the Scope.
  const receipt = (result.result ?? result) as { target?: unknown };
  const target = receipt && typeof receipt === "object" ? parseTarget(receipt.target) : null;
  return {
    ok: !("isError" in result),
    target: target ?? namedTarget(scope),
    result,
  };
}

function parseTarget(value: unknown): ResolvedTarget | null {
  if (!value || typeof value !== "object") return null;
  const record = value as { session?: unknown; document?: unknown };
  return {
    session: typeof record.session === "string" ? record.session.replace(/^session:/, "") : null,
    document: typeof record.document === "string" ? record.document : null,
  };
}

async function routeFetch(path: string, body?: unknown): Promise<Record<string, unknown>> {
  const response = await fetch(
    `${base()}${path}`,
    body === undefined
      ? undefined
      : {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        },
  );
  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok || payload.ok === false) {
    const hint = payload.hint ?? payload.error;
    return {
      isError: true,
      content: typeof hint === "string" ? hint : `request failed (${response.status})`,
      ...payload,
    };
  }
  return payload;
}

async function readCatalog(
  scope: Scope,
): Promise<CapabilityCatalog | { isError: true; content: string }> {
  try {
    const response = await fetch(`${base()}/pe/capabilities?${scopeQuery(scope)}`);
    const parsed = capabilityCatalogSchema.safeParse(await response.json());
    if (!response.ok || !parsed.success)
      return {
        isError: true,
        content: `GET ${base()}/pe/capabilities failed (${response.status}).`,
      };
    return parsed.data;
  } catch (error) {
    return {
      isError: true,
      content: `Couldn't reach the host at ${base()} (${message(error)}). Is the host running?`,
    };
  }
}

function refuse(key: string, content: string) {
  return { isError: true, ok: false, key, content };
}

function requestIdentity(context: unknown): string {
  const record = context as {
    agent?: { toolCallId?: string };
    mcp?: { extra?: { requestId?: string | number } };
  };
  const agentId = record.agent?.toolCallId?.trim();
  if (agentId) return agentId;
  const mcpId = record.mcp?.extra?.requestId;
  if (mcpId !== undefined && String(mcpId).trim()) return String(mcpId);
  return crypto.randomUUID();
}

export const scopeSet = createTool({
  id: "scope_set",
  description:
    "Propose the thread's Scope, what every following turn acts on. kind 'document' names a Revit document and the host derives its one holding session on every call (the normal choice); 'session' names an idle SDK session with nothing open; 'pinned' names both, only when two sessions hold the same document; 'none' clears it. The human approves it in the chat head. The running turn keeps the Scope it was admitted under; the new revision applies from the next turn. pe_find with no query lists sessions with their active document.",
  inputSchema: z.object({ scope: scopeSchema }),
  execute: async (input, context) => {
    const turn = turnOf(context);
    if (!turn) return { isError: true, content: "scope_set needs a chat turn; none is admitted." };
    const scope = input.scope;
    const response = await fetch(`${base()}/pe/scope/${encodeURIComponent(turn.thread)}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ scope, expectedRevision: turn.revision, turn: turn.id }),
    });
    const result = putScopeResultSchema.safeParse(await response.json().catch(() => null)).data;
    if (!result) return { isError: true, content: `scope set failed (${response.status})` };
    if (!result.ok)
      return {
        isError: true,
        content:
          result.why === "stale"
            ? `Scope is at revision ${result.head.revision}, not ${turn.revision}; it changed under you.`
            : "Another turn holds the Scope; wait for it to end.",
      };
    return {
      head: result.head,
      note: `This turn keeps revision ${turn.revision}; the next turn runs under the new Scope.`,
    };
  },
});
