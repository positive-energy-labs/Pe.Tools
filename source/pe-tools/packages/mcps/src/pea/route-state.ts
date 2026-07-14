/**
 * The three universal route-state tools — pea's side of every collaborative web route.
 *
 * These replace the six family_sheet_* tools with a per-route-agnostic trio. They are
 * THIN HTTP CLIENTS to the RouteWorkspace endpoints on the host
 * (`/pe/route-state...`), always acting as `actor:"agent"`. The trust contract is
 * enforced server-side by the route's write mask and human-only command gate — not
 * here — so the same tools work identically from an in-pea run and over stdio.
 *
 * On error they return the endpoint's `hint` text verbatim: pre/post-action hints are
 * how the agent learns what it may write and how to correct an invalid proposal.
 */
import { createTool } from "@mastra/core/tools";
import { MASTRA_THREAD_ID_KEY } from "@mastra/core/request-context";
import z from "zod";

import { coerceJsonObject } from "../shared/coerce.ts";
import { resolveHostBaseUrl } from "../shared/host-config.ts";

function dispatcherBaseUrl(): string {
  const base = resolveHostBaseUrl(undefined);
  return base.endsWith("/") ? base.slice(0, -1) : base;
}

async function getJson(path: string): Promise<unknown> {
  const base = dispatcherBaseUrl();
  try {
    const response = await fetch(`${base}${path}`);
    const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (!response.ok) {
      return { isError: true, content: hintOf(payload) ?? `request failed (${response.status})` };
    }
    return payload;
  } catch (error) {
    return {
      isError: true,
      content: `Couldn't reach RouteWorkspace at ${base} (${message(error)}). Is the host running?`,
    };
  }
}

async function postJson(path: string, body: unknown): Promise<unknown> {
  const base = dispatcherBaseUrl();
  try {
    const response = await fetch(`${base}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (!response.ok || payload.ok === false) {
      return { isError: true, content: hintOf(payload) ?? `request failed (${response.status})` };
    }
    return payload;
  } catch (error) {
    return {
      isError: true,
      content: `Couldn't reach RouteWorkspace at ${base} (${message(error)}).`,
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
  }),
  execute: async (input, context) => {
    if (!input.route) return getJson("/pe/route-state");
    const threadId = activeThreadId(context);
    if (!threadId) return missingThread("read route-state detail");
    return getJson(scopedPath(`/pe/route-state/${encodeURIComponent(input.route)}`, threadId));
  },
});

export const routeStateApply = createTool({
  id: "route_state_apply",
  description:
    "Propose changes to a route-state document by patching specific paths. Trust contract: you PROPOSE, the human stages and pushes — you cannot commit to Revit. Patches are segment-array paths (path is an array of string/number segments, e.g. ['cells','Width::Type A','proposal']); omit `value` to delete that key. Paths outside the route's agent write mask are rejected with a hint naming what you may write. The whole document is re-validated after patching; validation errors come back as hints you should act on (e.g. a low-confidence proposal must be marked for attention).",
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
  }),
  execute: async (input, context) => {
    const threadId = activeThreadId(context);
    if (!threadId) return missingThread("apply route-state patches");
    return postJson(
      scopedPath(`/pe/agent/route-state/${encodeURIComponent(input.route)}/apply`, threadId),
      {
        patches: input.patches,
      },
    );
  },
});

export const routeCommand = createTool({
  id: "route_command",
  description:
    "Run a named command on a route-state document (e.g. parse_spec, refresh_snapshot). Commands do the side-effectful work the write mask forbids you from doing by hand. Human-only commands (like push) reject you with a hint — ask the engineer to run those from the UI. Discover command names and their input shapes with route_state_read.",
  inputSchema: z.object({
    route: z.string(),
    command: z.string(),
    input: z.unknown().optional(),
  }),
  execute: async (input, context) => {
    const threadId = activeThreadId(context);
    if (!threadId) return missingThread("run a route-state command");
    return postJson(
      scopedPath(`/pe/agent/route-state/${encodeURIComponent(input.route)}/command`, threadId),
      {
        command: input.command,
        input: coerceJsonObject(input.input),
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

function activeThreadId(toolContext: unknown): string | undefined {
  const requestContext = record(toolContext).requestContext;
  const controller = record(requestContextValue(requestContext, "controller"));
  return (
    nonEmptyString(controller.threadId) ??
    nonEmptyString(requestContextValue(requestContext, MASTRA_THREAD_ID_KEY))
  );
}

function requestContextValue(requestContext: unknown, key: string): unknown {
  const context = record(requestContext);
  if (typeof context.get === "function") {
    return (context.get as (name: string) => unknown)(key);
  }
  return context[key];
}

function scopedPath(path: string, threadId: string): string {
  return `${path}?threadId=${encodeURIComponent(threadId)}`;
}

function missingThread(action: string) {
  return {
    isError: true,
    content: `Cannot ${action} without an active Pea thread. Run this tool from a thread-backed Pea turn.`,
  };
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
