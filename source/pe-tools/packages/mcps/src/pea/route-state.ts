import { createTool } from "@mastra/core/tools";
import z from "zod";
import { addressSchema, message } from "@pe/agent-contracts";

import { coerceJsonObject } from "../shared/coerce.ts";
import { resolveHostBaseUrl } from "../shared/host-config.ts";

function dispatcherBaseUrl(): string {
  const base = resolveHostBaseUrl(undefined);
  return base.endsWith("/") ? base.slice(0, -1) : base;
}

// The server enforces trust, and endpoint hints return verbatim so Pea can correct a proposal.
async function call(path: string, body?: unknown): Promise<unknown> {
  let base = "";
  try {
    base = dispatcherBaseUrl();
    const response = await fetch(
      `${base}${path}`,
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

export const routeStateRead = createTool({
  id: "route_state_read",
  description:
    "Read the collaborative route documents you co-edit with a human in their browser. Cold start: call with NO args for a shallow route list. Call with a route to get that thread's document, JSON Schema, agent write mask (exactly which paths you may write — everything else is human-only), and commands. Read detail before you propose.",
  inputSchema: z.object({
    route: z
      .string()
      .optional()
      .describe("Route name from the list; omit to list all live routes."),
    doc: addressSchema.optional().describe("Revit document address; required with route."),
  }),
  execute: async (input) => {
    if (!input.route) return call("/pe/route-state");
    if (!input.doc)
      return {
        isError: true,
        content: "Cannot read route-state detail without a Revit document address.",
      };
    return call(scopedPath(`/pe/route-state/${encodeURIComponent(input.route)}`, input.doc));
  },
});

export const routeStateApply = createTool({
  id: "route_state_apply",
  description:
    "Propose changes to a route-state document by patching specific paths. Trust contract: you PROPOSE, the human stages and pushes — you cannot commit to Revit. Patches are segment-array paths (path is an array of string/number segments, e.g. ['cells','Width::Type A','proposal']); omit `value` to delete that key. Paths outside the route's agent write mask are rejected with a hint naming what you may write. The whole document is re-validated after patching; validation errors come back as hints you should act on (e.g. a low-confidence proposal must be marked for attention).",
  inputSchema: z.object({
    route: z.string(),
    doc: addressSchema,
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
  execute: async (input) => {
    return call(
      scopedPath(`/pe/agent/route-state/${encodeURIComponent(input.route)}/apply`, input.doc),
      {
        patches: input.patches,
        expectedRevision: input.expectedRevision,
      },
    );
  },
});

export const routeCommand = createTool({
  id: "route_command",
  description:
    "Run a named command on a route-state document (e.g. parse_spec, refresh_snapshot). Commands do the side-effectful work the write mask forbids you from doing by hand. Human-only commands (like push) reject you with a hint — ask the engineer to run those from the UI. Discover command names and their input shapes with route_state_read. On route=\"parameter-links\": inspect the model with host operations, replace only draftProfile with a complete profile, run command=\"preview\" with that exact profile, and stop for browser review; apply is human-only, and electricalEquipmentCircuits is how equipment parameters reach circuit parameters.",
  inputSchema: z.object({
    route: z.string(),
    doc: addressSchema,
    command: z.string(),
    input: z.unknown().optional(),
    expectedRevision: z.number().int().nonnegative(),
  }),
  execute: async (input, context) => {
    return call(
      scopedPath(`/pe/agent/route-state/${encodeURIComponent(input.route)}/command`, input.doc),
      {
        command: input.command,
        input: coerceJsonObject(input.input),
        expectedRevision: input.expectedRevision,
        requestId: requestIdentity(context),
      },
    );
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

function scopedPath(path: string, doc: string): string {
  return `${path}?doc=${encodeURIComponent(doc)}`;
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
