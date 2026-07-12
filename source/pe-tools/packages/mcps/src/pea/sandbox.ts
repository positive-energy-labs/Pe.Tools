import { createTool } from "@mastra/core/tools";
import z from "zod";
import { assertRuntimeToolAccess, readRuntimeAccessLevelFromToolContext } from "@pe/runtime";

/**
 * pe_sandbox — the ONE dedicated pea tool for pea-owned Revit sandbox lifecycle (pe_status
 * class, control plane). It proxies the host's /sessions/sandboxes route, which shells
 * `pe-revit sandbox … --json`; it never appears in host_operation_search.
 *
 * Pea's world is "the user's session + pea-owned sandboxes": compact output presents every
 * sandbox as kind "sandbox" with its id and never leaks broker/SDK lane vocabulary. The host
 * lane decides which payload a sandbox runs — this tool exposes no source/installed switch.
 */

export const peSandboxInputSchema = z.object({
  action: z
    .enum(["list", "start", "wait", "restart", "stop"])
    .describe(
      "list = registry + live state per sandbox; start = mint a scratch Revit session (returns state=booting immediately — Revit cold boot is 180-300s, follow with action=wait or pass wait=true); wait = block until ready; restart = fresh generation swap; stop = verified stop of that exact sandbox (the user's session is never touched).",
    ),
  id: z
    .string()
    .optional()
    .describe(
      "Sandbox id. Required for wait/restart/stop; optional custom name for start (generated when omitted); filters list.",
    ),
  year: z
    .union([z.string(), z.number()])
    .optional()
    .describe("Revit year for start, e.g. 25. Required for start."),
  wait: z
    .boolean()
    .optional()
    .describe("start only: block until the sandbox is ready instead of returning while it boots."),
  force: z
    .boolean()
    .optional()
    .describe(
      "stop only: force-kill the verified owned process tree after the graceful window. Use for state=unresponsive.",
    ),
  timeoutSeconds: z
    .number()
    .min(5)
    .max(900)
    .optional()
    .describe("Readiness bound for start/wait/restart (default 420s on the host side)."),
  verbosity: z
    .enum(["compact", "full"])
    .default("compact")
    .describe("compact presents the sandboxes; full returns the raw host envelope."),
});

export type PeSandboxInput = z.infer<typeof peSandboxInputSchema>;

// --- presentation filter --------------------------------------------------------------------
// Pea never sees broker/SDK lane vocabulary: sessions present as the user's session or a
// pea-owned sandbox, nothing else. (verbosity=full keeps raw DTOs; broker error strings pass
// through verbatim — that carve-out lives at the broker layer, not here.)

export type SessionKindPresentation =
  | { readonly kind: "user" }
  | { readonly kind: "sandbox"; readonly sandboxId: string | null };

/** Map a broker session (lane + sandboxId) to pea's vocabulary: the user's session, or a sandbox. */
export function presentSessionKind(
  lane: string | null | undefined,
  sandboxId: string | null | undefined,
): SessionKindPresentation {
  return lane === "sandbox" ? { kind: "sandbox", sandboxId: sandboxId ?? null } : { kind: "user" };
}

type SandboxEnvelope = {
  readonly result?: unknown;
  readonly diagnostics?: readonly unknown[];
  readonly nextSteps?: readonly string[];
};

type SandboxRow = Record<string, unknown>;

export type PresentedSandbox = {
  readonly kind: "sandbox";
  readonly id: string | null;
  readonly state: string | null;
  readonly detail?: string;
  readonly pid: number | null;
  readonly year: string | null;
  readonly buildStamp?: string | null;
  readonly startedAtUtc?: string | null;
  readonly stoppedAtUtc?: string | null;
  /** Ready-to-use bridgeSessionId selector for targeting this sandbox in other tools. */
  readonly target: string | null;
};

/**
 * Compact presentation of a sandbox CLI envelope: only sandbox-vocabulary fields survive
 * (payload provenance, projects, and other SDK-layer fields are full-verbosity only).
 */
export function presentSandboxEnvelope(envelope: unknown, action: string) {
  const parsed = (envelope ?? {}) as SandboxEnvelope;
  const result = (parsed.result ?? {}) as Record<string, unknown>;
  const rows: readonly SandboxRow[] = Array.isArray(result.sandboxes)
    ? (result.sandboxes as SandboxRow[])
    : typeof result.id === "string" || typeof result.state === "string"
      ? [result]
      : [];
  return {
    action,
    sandboxes: rows.map(presentSandboxRow),
    diagnostics: parsed.diagnostics ?? [],
    nextSteps: parsed.nextSteps ?? [],
  };
}

function presentSandboxRow(row: SandboxRow): PresentedSandbox {
  const id = typeof row.id === "string" ? row.id : null;
  return {
    kind: "sandbox",
    id,
    state: typeof row.state === "string" ? row.state : null,
    detail: typeof row.detail === "string" ? row.detail : undefined,
    pid: typeof row.pid === "number" ? row.pid : null,
    year: typeof row.year === "string" ? row.year : typeof row.year === "number" ? String(row.year) : null,
    buildStamp: typeof row.buildStamp === "string" ? row.buildStamp : null,
    startedAtUtc: typeof row.startedAtUtc === "string" ? row.startedAtUtc : null,
    stoppedAtUtc: typeof row.stoppedAtUtc === "string" ? row.stoppedAtUtc : null,
    target: id ? `sandbox:${id}` : null,
  };
}

// --- host route client ----------------------------------------------------------------------

export type FetchLike = (
  url: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
  },
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown>; text(): Promise<string> }>;

export type SandboxRouteCall = {
  readonly method: "GET" | "POST";
  readonly url: string;
  readonly body?: Record<string, unknown>;
  readonly timeoutMs: number;
};

/** Pure request mapping (unit-tested): pe_sandbox input → host /sessions/sandboxes call. */
export function sandboxRouteCall(baseUrl: string, input: PeSandboxInput): SandboxRouteCall {
  const base = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
  if (input.action === "list") {
    const query = input.id ? `?id=${encodeURIComponent(input.id)}` : "";
    return { method: "GET", url: `${base}/sessions/sandboxes${query}`, timeoutMs: 90_000 };
  }
  return {
    method: "POST",
    url: `${base}/sessions/sandboxes`,
    body: {
      action: input.action,
      ...(input.id ? { id: input.id } : {}),
      ...(input.year != null ? { year: String(input.year) } : {}),
      ...(input.wait ? { wait: true } : {}),
      ...(input.force ? { force: true } : {}),
      ...(input.timeoutSeconds != null ? { timeoutSeconds: input.timeoutSeconds } : {}),
    },
    // Must outlast the host route's own CLI budget (default 600s) so the host's
    // unresponsive envelope arrives instead of a client-side abort.
    timeoutMs: (input.timeoutSeconds != null ? input.timeoutSeconds + 120 : 720) * 1000,
  };
}

/** Client-side unresponsiveness mapping (the host itself stopped answering). */
export function unresponsiveSandboxPresentation(input: PeSandboxInput) {
  const stopStep = `pe_sandbox action=stop${input.id ? ` id=${input.id}` : ""} force=true`;
  return {
    action: input.action,
    sandboxes: input.id
      ? [
          {
            kind: "sandbox" as const,
            id: input.id,
            state: "unresponsive",
            pid: null,
            year: null,
            target: `sandbox:${input.id}`,
          },
        ]
      : [],
    diagnostics: [
      {
        code: "sandbox.unresponsive",
        detail: `sandbox ${input.action} did not answer before the client timeout; the process may still be alive but blocked inside a Revit API call, which no timeout can cancel.`,
        fix: `${stopStep} — force-stop that exact sandbox (the user's session is untouched), then start a fresh one.`,
      },
    ],
    nextSteps: [`${stopStep} — force-stop the unresponsive sandbox; the user's session is preserved.`],
  };
}

async function callSandboxRoute(
  baseUrl: string,
  input: PeSandboxInput,
  fetchImpl: FetchLike = fetch as unknown as FetchLike,
): Promise<unknown> {
  const call = sandboxRouteCall(baseUrl, input);
  const response = await fetchImpl(call.url, {
    method: call.method,
    ...(call.body
      ? { headers: { "content-type": "application/json" }, body: JSON.stringify(call.body) }
      : {}),
    signal: AbortSignal.timeout(call.timeoutMs),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`sandbox ${input.action}: HTTP ${response.status} — ${text}`);
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error(`sandbox ${input.action}: host returned non-JSON output — ${text.slice(0, 500)}`);
  }
}

const MUTATING_SANDBOX_ACTIONS = new Set<PeSandboxInput["action"]>(["start", "restart", "stop"]);

/** Factory so the tool resolves the host base URL from the live pea product context. */
export function createPeSandboxTool(resolveBaseUrl: () => string, fetchImpl?: FetchLike) {
  return createTool({
    id: "pe_sandbox",
    description:
      "Manage pea-owned disposable Revit sandboxes: scratch Revit sessions for drafting and proving pods/scripts/specs before applying them to the user's session. Actions: list, start, wait, restart, stop. Target a running sandbox in other tools with bridgeSessionId='sandbox:<id>'. A sandbox is process/document isolation, not code security — in-process C# can still reach network, filesystem, and Revit APIs.",
    inputSchema: peSandboxInputSchema,
    execute: async (input, context) => {
      // Same per-action gating idiom as host_operation_call: mutating actions require an
      // access level that permits execution; list/wait are reads.
      if (MUTATING_SANDBOX_ACTIONS.has(input.action))
        assertRuntimeToolAccess({
          toolName: `pe_sandbox:${input.action}`,
          metadata: { name: `pe_sandbox:${input.action}`, title: `Sandbox ${input.action}`, kind: "execute" },
          accessLevel: readRuntimeAccessLevelFromToolContext(context),
        });
      try {
        const envelope = await callSandboxRoute(resolveBaseUrl(), input, fetchImpl);
        return input.verbosity === "full" ? envelope : presentSandboxEnvelope(envelope, input.action);
      } catch (error) {
        if (error instanceof Error && error.name === "TimeoutError")
          return unresponsiveSandboxPresentation(input);
        return { isError: true, content: error instanceof Error ? error.message : String(error) };
      }
    },
  });
}
