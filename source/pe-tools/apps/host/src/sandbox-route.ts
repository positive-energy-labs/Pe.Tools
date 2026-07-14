import { Effect, Layer, Option } from "effect";
import { HttpRouter, HttpServerResponse as Response } from "effect/unstable/http";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";
import { join } from "node:path";
import { hostOwnership, type HostLane } from "./host-ownership.ts";
import { peRevitLauncher, validatePeRevitEnvelope } from "./pe-revit-launch.ts";

/**
 * Control plane for pea-owned Revit sandboxes — NOT a catalog op. Sandbox lifecycle is fleet
 * management (same category as host.status/logs.tail): `pe-revit sandbox …` is the only
 * implementation and this plain HTTP route (copying the hostUpdateRoute pattern) shells it with
 * `--json` and relays the CLI's envelope verbatim. GET lists/status; POST performs
 * {action: start|wait|restart|stop}.
 */

export type SandboxAction = "start" | "wait" | "restart" | "stop";

export type SandboxActionRequest = {
  readonly action: SandboxAction;
  readonly id?: string;
  readonly year?: string;
  readonly wait?: boolean;
  readonly force?: boolean;
  readonly timeoutSeconds?: number;
};

const SANDBOX_ACTIONS: readonly SandboxAction[] = ["start", "wait", "restart", "stop"];

/**
 * Parse and validate a POST body. Field requirements mirror the CLI's own invocation contract
 * (start needs a year; wait/restart/stop need an id) so bad requests fail here with a clear
 * message instead of a shelled bad-invocation.
 */
export function parseSandboxActionRequest(
  body: unknown,
):
  | { readonly ok: true; readonly request: SandboxActionRequest }
  | { readonly ok: false; readonly error: string } {
  if (typeof body !== "object" || body === null || Array.isArray(body))
    return { ok: false, error: "body must be { action: start|wait|restart|stop, ...args }" };
  const record = body as Record<string, unknown>;
  const action = record.action;
  if (typeof action !== "string" || !SANDBOX_ACTIONS.includes(action as SandboxAction))
    return { ok: false, error: `action must be one of ${SANDBOX_ACTIONS.join("|")}` };
  const id = readOptionalString(record.id);
  const year =
    typeof record.year === "number" ? String(record.year) : readOptionalString(record.year);
  if (action === "start" && !year) return { ok: false, error: 'start requires year (e.g. "25")' };
  if (action !== "start" && !id) return { ok: false, error: `${action} requires id` };
  return {
    ok: true,
    request: {
      action: action as SandboxAction,
      id,
      year,
      wait: record.wait === true,
      force: record.force === true,
      timeoutSeconds:
        typeof record.timeoutSeconds === "number" && Number.isFinite(record.timeoutSeconds)
          ? record.timeoutSeconds
          : undefined,
    },
  };
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/**
 * Dev/prod payload routing (spec): the HOST LANE decides which payload a sandbox runs — the
 * caller never chooses source vs installed. A source-linked (dev) host starts sandboxes from
 * its own checkout's Pe.App project; an installed-lane host launches the shipped Pe.App payload.
 * `sourceRoot` is the pe-tools monorepo root (…\Pe.Tools\source\pe-tools), so the repo root is
 * two levels up.
 */
export function resolveSandboxStartPayloadArgs(
  lane: HostLane,
  sourceRoot: string | null,
): readonly string[] {
  return lane === "dev" && sourceRoot
    ? ["--project", join(sourceRoot, "..", "..", "source", "Pe.App", "Pe.App.csproj")]
    : ["--installed", "Pe.App"];
}

/** Map a validated action request onto `pe-revit sandbox …` CLI args (always `--json`). */
export function sandboxCliArgs(
  request: SandboxActionRequest,
  payloadArgs: readonly string[],
): string[] {
  const args: string[] = ["sandbox", request.action];
  if (request.action === "start") {
    args.push(...payloadArgs, "--year", request.year!);
    if (request.id) args.push("--id", request.id);
    if (request.wait) args.push("--wait");
  } else {
    args.push("--id", request.id!);
    if (request.action === "stop" && request.force) args.push("--force");
  }
  if (request.timeoutSeconds != null && request.action !== "stop")
    args.push("--timeout-seconds", String(Math.round(request.timeoutSeconds)));
  args.push("--json");
  return args;
}

/** GET (status/list) CLI args; `id` narrows to one sandbox. */
export function sandboxStatusArgs(id?: string | null): string[] {
  return id?.trim()
    ? ["sandbox", "status", "--id", id.trim(), "--json"]
    : ["sandbox", "status", "--json"];
}

/**
 * Unresponsiveness (spec): a task timeout cannot cancel a blocked Revit API call — when the
 * shelled sandbox operation stops answering we surface state `unresponsive` and point the agent
 * at `pe_sandbox action=stop`, which force-stops that exact owned incarnation while preserving
 * the user's session. The SDK CLI owns the actual stop verification; this is only a status
 * mapping, not a new state machine.
 */
export function unresponsiveSandboxEnvelope(
  action: string,
  id: string | undefined,
  timeoutMs: number,
): Record<string, unknown> {
  const stopStep = `pe_sandbox action=stop${id ? ` id=${id}` : ""} force=true`;
  return {
    result: { id: id ?? null, state: "unresponsive" },
    resolved: { action, timeoutMs },
    diagnostics: [
      {
        code: "sandbox.unresponsive",
        detail: `sandbox ${action}${id ? ` ${id}` : ""} did not answer within ${Math.round(timeoutMs / 1000)}s; the process may still be alive but blocked inside a Revit API call, which no timeout can cancel.`,
        fix: `${stopStep} — force-stop that exact owned sandbox incarnation (the user's session is untouched), then start a fresh sandbox.`,
      },
    ],
    nextSteps: [
      `${stopStep} — force-stop the unresponsive sandbox; the user's session is preserved.`,
    ],
    guide: "sandbox",
    related: [],
  };
}

export type SandboxCliRunner<R = never> = (
  args: readonly string[],
) => Effect.Effect<string, unknown, R>;

export type SandboxCliOutcome = { readonly status: number; readonly bodyJson: string };

// start/wait/restart block on Revit readiness (cold boot is 180-300s; the CLI's own wait default
// is 420s; a source start also builds first) — the route budget must outlast the CLI's.
const DEFAULT_ACTION_TIMEOUT_MS = 600_000;
const STATUS_TIMEOUT_MS = 60_000;

export function sandboxActionTimeoutMs(request: SandboxActionRequest): number {
  return request.timeoutSeconds != null
    ? Math.round(request.timeoutSeconds * 1000) + 60_000
    : DEFAULT_ACTION_TIMEOUT_MS;
}

/**
 * Run one shelled sandbox CLI invocation and shape the HTTP outcome: stdout (the CLI's JSON
 * envelope, emitted on success AND on failed verdicts) relays verbatim; a spawn failure is a
 * plain 500; a timeout synthesizes the `unresponsive` envelope above.
 */
export function executeSandboxCli<R>(
  args: readonly string[],
  runCli: SandboxCliRunner<R>,
  timeoutMs: number,
  timeoutContext: { readonly action: string; readonly id?: string },
): Effect.Effect<SandboxCliOutcome, never, R> {
  return Effect.gen(function* () {
    const outcome = yield* Effect.result(runCli(args).pipe(Effect.timeoutOption(timeoutMs)));
    if (outcome._tag === "Failure")
      return {
        status: 500,
        bodyJson: JSON.stringify({ ok: false, error: String(outcome.failure) }),
      } satisfies SandboxCliOutcome;
    if (Option.isNone(outcome.success))
      return {
        status: 200,
        bodyJson: JSON.stringify(
          unresponsiveSandboxEnvelope(timeoutContext.action, timeoutContext.id, timeoutMs),
        ),
      } satisfies SandboxCliOutcome;
    return { status: 200, bodyJson: outcome.success.value } satisfies SandboxCliOutcome;
  });
}

// Real shell layer: same launcher chain as hostUpdateRoute/install-gc. An empty stdout means
// the resolved CLI does not speak this verb (e.g. a pre-sandbox installed shim) — fail loudly
// instead of relaying a blank 200.
const runPeRevitCli: SandboxCliRunner<ChildProcessSpawner.ChildProcessSpawner> = (args) =>
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const launch = peRevitLauncher();
    const stdout = yield* spawner.string(
      ChildProcess.make(launch.cmd, [...launch.args, ...args], { cwd: launch.cwd }),
    );
    return yield* Effect.try({
      try: () => validatePeRevitEnvelope(stdout, args, launch),
      catch: (error) => (error instanceof Error ? error : new Error(String(error))),
    });
  });

function jsonResponse(outcome: SandboxCliOutcome) {
  return Response.text(outcome.bodyJson, {
    status: outcome.status,
    headers: { "content-type": "application/json" },
  });
}

const sandboxesStatusRoute = HttpRouter.add("GET", "/sessions/sandboxes", (req) =>
  Effect.gen(function* () {
    const id = new URL(req.url, "http://localhost").searchParams.get("id");
    const outcome = yield* executeSandboxCli(
      sandboxStatusArgs(id),
      runPeRevitCli,
      STATUS_TIMEOUT_MS,
      {
        action: "status",
        id: id ?? undefined,
      },
    );
    return jsonResponse(outcome);
  }),
);

const sandboxesActionRoute = HttpRouter.add("POST", "/sessions/sandboxes", (req) =>
  Effect.gen(function* () {
    const body = yield* Effect.result(req.json);
    const parsed = parseSandboxActionRequest(body._tag === "Success" ? body.success : null);
    if (!parsed.ok) return Response.jsonUnsafe({ ok: false, error: parsed.error }, { status: 400 });
    const request = parsed.request;
    const args = sandboxCliArgs(
      request,
      resolveSandboxStartPayloadArgs(hostOwnership.lane, hostOwnership.sourceRoot),
    );
    const outcome = yield* executeSandboxCli(args, runPeRevitCli, sandboxActionTimeoutMs(request), {
      action: request.action,
      id: request.id,
    });
    return jsonResponse(outcome);
  }),
);

export const sandboxesRoute = Layer.mergeAll(sandboxesStatusRoute, sandboxesActionRoute);
