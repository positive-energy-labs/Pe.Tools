/**
 * The three universal route-state tools — pea's side of every collaborative web route.
 *
 * These replace the six family_sheet_* tools with a per-route-agnostic trio. They are
 * THIN HTTP CLIENTS to the route-state dispatcher endpoints on the host
 * (`/pe/route-state...`), always acting as `actor:"agent"`. The trust contract is
 * enforced server-side by the route's write mask and human-only command gate — not
 * here — so the same tools work identically from an in-pea run and over stdio.
 *
 * On error they return the endpoint's `hint` text verbatim: pre/post-action hints are
 * how the agent learns what it may write and how to correct an invalid proposal.
 */
import { createTool } from "@mastra/core/tools";
import z from "zod";

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
      content: `Couldn't reach the route-state dispatcher at ${base} (${message(error)}). Is the host running?`,
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
      content: `Couldn't reach the route-state dispatcher at ${base} (${message(error)}).`,
    };
  }
}

export const routeStateRead = createTool({
  id: "route_state_read",
  description:
    "Read the collaborative route-state documents you co-edit with a human in their browser. Cold start: call with NO args to discover the live routes and their commands. Call with a route to get that route's full document, its JSON Schema, the agent write mask (exactly which paths you may write — everything else is human-only), and its commands. Read before you propose: the mask tells you what you may write.",
  inputSchema: z.object({
    route: z
      .string()
      .optional()
      .describe("Route name from the list; omit to list all live routes."),
  }),
  execute: async (input) =>
    getJson(input.route ? `/pe/route-state/${encodeURIComponent(input.route)}` : "/pe/route-state"),
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
  execute: async (input) =>
    postJson(`/pe/route-state/${encodeURIComponent(input.route)}/apply`, {
      actor: "agent",
      patches: input.patches,
    }),
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
  execute: async (input) =>
    postJson(`/pe/route-state/${encodeURIComponent(input.route)}/command`, {
      actor: "agent",
      command: input.command,
      input: input.input,
    }),
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

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
