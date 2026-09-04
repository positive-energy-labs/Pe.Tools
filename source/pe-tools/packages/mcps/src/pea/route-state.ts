import { createTool } from "@mastra/core/tools";
import z from "zod";
import {
  addressSchema,
  emptyScope,
  message,
  scopeSchema,
  sdkSessionIdSchema,
  turnOf,
  type Scope,
} from "@pe/agent-contracts";

import { coerceJsonObject } from "../shared/coerce.ts";
import { resolveHostBaseUrl } from "../shared/host-config.ts";

function dispatcherBaseUrl(): string {
  const base = resolveHostBaseUrl(undefined);
  return base.endsWith("/") ? base.slice(0, -1) : base;
}

// The server enforces trust, and endpoint hints return verbatim so Pea can correct a proposal.
async function call(path: string, body?: unknown, method = "POST"): Promise<unknown> {
  let base = "";
  try {
    base = dispatcherBaseUrl();
    const response = await fetch(
      `${base}${path}`,
      body === undefined
        ? undefined
        : { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) },
    );
    const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (!response.ok || payload.ok === false) {
      return { isError: true, content: hintOf(payload) ?? `request failed (${response.status})` };
    }
    return payload;
  } catch (error) {
    return {
      isError: true,
      content: base
        ? `Couldn't reach RouteWorkspace at ${base} (${message(error)}).${body === undefined ? " Is the host running?" : ""}`
        : message(error),
    };
  }
}

/** Route documents are keyed by the turn's Scope; a turn without one lands on the empty Scope. */
function scopedPath(path: string, context: unknown): string {
  const scope: Scope = turnOf(context)?.scope ?? emptyScope;
  const query = new URLSearchParams();
  if (scope.session) query.set("session", scope.session);
  if (scope.document) query.set("doc", scope.document);
  return `${path}?${query.toString()}`;
}

export const routeStateRead = createTool({
  id: "route_state_read",
  description:
    "Read the collaborative route documents you co-edit with a human in their browser, under this thread's Scope. Cold start: call with NO args for a shallow route list. Call with a route to get that document, JSON Schema, agent write mask (exactly which paths you may write — everything else is human-only), and commands. Read detail before you propose.",
  inputSchema: z.object({
    route: z
      .string()
      .optional()
      .describe("Route name from the list; omit to list all live routes."),
  }),
  execute: async (input, context) => {
    if (!input.route) return call("/pe/route-state");
    return call(scopedPath(`/pe/route-state/${encodeURIComponent(input.route)}`, context));
  },
});

export const routeStateApply = createTool({
  id: "route_state_apply",
  description:
    "Edit a route document by patching specific paths. Patches only change route state; external operations require route_command and its declared actor permission. Patches are segment-array paths (e.g. ['cells','Width::Type A','proposal']); omit value to delete a key. Paths outside the agent write mask are rejected. The whole document is re-validated after patching.",
  inputSchema: z.object({
    route: z.string(),
    patches: z
      .array(
        z.object({
          path: z.array(z.union([z.string(), z.number()])),
          value: z.unknown().optional(),
        }),
      )
      .min(1),
    expectedRevision: z.number().int().nonnegative(),
  }),
  execute: async (input, context) =>
    call(scopedPath(`/pe/agent/route-state/${encodeURIComponent(input.route)}/apply`, context), {
      patches: input.patches,
      expectedRevision: input.expectedRevision,
    }),
});

export const routeCommand = createTool({
  id: "route_command",
  description:
    'Run a named command on a route-state document (e.g. parse_spec, refresh_snapshot). Commands do the side-effectful work the write mask forbids you from doing by hand; they act on this thread\'s Scope. Human-only commands (like push) reject you with a hint — ask the engineer to run those from the UI. Discover command names and their input shapes with route_state_read. On route="parameter-links": inspect the model with host operations, replace only draftProfile with a complete profile, run command="preview" with that exact profile, and stop for browser review; apply is human-only, and electricalEquipmentCircuits is how equipment parameters reach circuit parameters.',
  inputSchema: z.object({
    route: z.string(),
    command: z.string(),
    input: z.unknown().optional(),
    expectedRevision: z.number().int().nonnegative(),
  }),
  execute: async (input, context) =>
    call(scopedPath(`/pe/agent/route-state/${encodeURIComponent(input.route)}/command`, context), {
      command: input.command,
      input: coerceJsonObject(input.input),
      expectedRevision: input.expectedRevision,
      requestId: requestIdentity(context),
    }),
});

export const scopeSet = createTool({
  id: "scope_set",
  description:
    "Propose the thread's Scope: the SDK session and the Revit document every following turn acts on. The human approves it in the chat head. The running turn keeps the Scope it was admitted under; the new revision applies from the next turn. Read pe_status for session ids and document addresses before proposing.",
  inputSchema: z.object({
    session: sdkSessionIdSchema.nullable().describe("SDK session id, or null for none."),
    document: addressSchema.nullable().describe("Revit document Address, or null for none."),
  }),
  execute: async (input, context) => {
    const turn = turnOf(context);
    if (!turn) return { isError: true, content: "scope_set needs a chat turn; none is admitted." };
    const scope = scopeSchema.parse(input);
    const set = await call(
      `/pe/scope/${encodeURIComponent(turn.thread)}`,
      { scope, expectedRevision: turn.revision, turn: turn.id },
      "PUT",
    );
    return typeof set === "object" && set && "revision" in set
      ? {
          ...set,
          note: `This turn keeps revision ${turn.revision}; the next turn runs under the new Scope.`,
        }
      : set;
  },
});

export const routeStateTools = {
  [routeStateRead.id]: routeStateRead,
  [routeStateApply.id]: routeStateApply,
  [routeCommand.id]: routeCommand,
};

/* ── helpers ─────────────────────────────────────────────────────────────── */

function hintOf(payload: Record<string, unknown>): string | undefined {
  const hint = payload.hint ?? payload.error;
  return typeof hint === "string" ? hint : undefined;
}

function requestIdentity(context: {
  agent?: { toolCallId?: string };
  mcp?: { extra?: { requestId?: string | number } };
}): string {
  const agentId = context.agent?.toolCallId?.trim();
  if (agentId) return agentId;
  const mcpId = context.mcp?.extra?.requestId;
  if (mcpId !== undefined && String(mcpId).trim()) return String(mcpId);
  return crypto.randomUUID();
}
