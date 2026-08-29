import { Effect, Layer, Option } from "effect";
import { HttpRouter, HttpServerResponse as Response } from "effect/unstable/http";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";
import { join } from "node:path";
import {
  docOpenArgv,
  docRecentsArgv,
  sessionListArgv,
  sessionRestartArgv,
  sessionStartArgv,
  sessionStatusArgv,
  sessionStopArgv,
} from "./generated/pe-revit-contract.ts";
import { hostOwnership, type HostLane } from "./host-ownership.ts";
import { peRevitLauncher, validatePeRevitEnvelope } from "./pe-revit-launch.ts";

/**
 * Control plane for Revit sessions — NOT a catalog op. Session lifecycle belongs to the SDK
 * (`pe-revit session …` is the only implementation); this plain HTTP route is a THIN RELAY so a
 * browser can reach it. It shells the CLI through the GENERATED argv builders
 * (`generated/pe-revit-contract.ts`, vendored from the SDK and drift-guarded by
 * `pe-revit doctor`'s `ts-client-drift`) and hands the CLI's envelope back untouched.
 *
 * Untouched is the whole contract. This file forges NO envelope of its own: every state, code,
 * diagnostic and nextStep a caller sees is the SDK's, so the browser and an agent running
 * `pe-revit session list` or exact `session status` read the same words. A hung CLI is the one
 * thing we cannot relay (no
 * envelope was ever produced) and is reported as a plain 504, not as a hand-made `unresponsive`
 * result that would look like an SDK verdict without being one.
 *
 * GET /sessions → `session list --json`, or exact `session status --id` when an id is supplied.
 * POST /sessions {action: start|stop|restart, …} → the matching verb.
 */

type SessionAction = "start" | "stop" | "restart";

export type SessionActionRequest = {
  readonly action: SessionAction;
  readonly id?: string;
  readonly year?: string;
  /**
   * Payload source for `start`, the CLI's own words: `installed` (default, a project-less start —
   * the end-user case) or `dev` (this host's checkout Pe.App; refused on a host with no checkout).
   * Explicit, never inferred from the host's lane: the same `{year}` must mean the same thing on
   * the route as on the CLI (BB-1 F-14).
   */
  readonly lane?: HostLane;
  readonly doc?: string;
  readonly force?: boolean;
  readonly timeoutSeconds?: number;
};

const SESSION_ACTIONS: readonly SessionAction[] = ["start", "stop", "restart"];

/**
 * Parse and validate a POST body. Field requirements mirror the CLI's own invocation contract
 * (start needs a year; stop/restart need an id) so bad requests fail here with a clear message
 * instead of a shelled bad-invocation.
 */
export function parseSessionActionRequest(
  body: unknown,
):
  | { readonly ok: true; readonly request: SessionActionRequest }
  | { readonly ok: false; readonly error: string } {
  if (typeof body !== "object" || body === null || Array.isArray(body))
    return { ok: false, error: `body must be { action: ${SESSION_ACTIONS.join("|")}, ...args }` };
  const record = body as Record<string, unknown>;
  const action = record.action;
  if (typeof action !== "string" || !SESSION_ACTIONS.includes(action as SessionAction))
    return { ok: false, error: `action must be one of ${SESSION_ACTIONS.join("|")}` };
  const id = readOptionalString(record.id);
  const year =
    typeof record.year === "number" ? String(record.year) : readOptionalString(record.year);
  if (action === "start" && !year) return { ok: false, error: 'start requires year (e.g. "25")' };
  const lane = record.lane === undefined ? "installed" : record.lane;
  if (action === "start" && lane !== "installed" && lane !== "dev")
    return { ok: false, error: 'lane must be "installed" (default) or "dev"' };
  if ((action === "stop" || action === "restart") && !id)
    return { ok: false, error: `${action} requires id` };
  return {
    ok: true,
    request: {
      action: action as SessionAction,
      id,
      year,
      lane: action === "start" ? (lane as HostLane) : undefined,
      doc: readOptionalString(record.doc),
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
 * Dev/prod payload routing: the HOST LANE decides which payload a session runs — the caller never
 * chooses source vs installed. A source-linked (dev) host starts sessions from its own checkout's
 * Pe.App project; an installed-lane host omits `--project` entirely, because a project-less
 * `session start` IS the installed lane (the `--installed <payload>` flag is gone — lane is
 * payload SOURCE, derived, never named by the caller). `sourceRoot` is the pe-tools monorepo root
 * (…\Pe.Tools\source\pe-tools), so the repo root is two levels up.
 */
export function resolveStartProject(lane: HostLane, sourceRoot: string | null): string | undefined {
  return lane === "dev" && sourceRoot
    ? join(sourceRoot, "..", "..", "source", "Pe.App", "Pe.App.csproj")
    : undefined;
}

/**
 * Map a validated action request onto pe-revit argv through the GENERATED builders. Every builder
 * appends `--json` itself. Start and restart return their own terminal observation.
 */
export function sessionCliArgs(
  request: SessionActionRequest,
  project: string | undefined,
): string[] {
  switch (request.action) {
    case "start":
      return sessionStartArgv({
        project,
        year: request.year!,
        id: request.id,
        doc: request.doc,
        origin: "web",
        timeoutSeconds: request.timeoutSeconds,
      });
    case "restart":
      return sessionRestartArgv({ id: request.id, timeoutSeconds: request.timeoutSeconds });
    case "stop":
      return sessionStopArgv({ id: request.id, force: request.force });
  }
}

/** GET (status/list) CLI args; `id` narrows to one session, `all` includes the graveyard. */
export function sessionStatusArgs(id?: string | null, all = false): string[] {
  const pinned = id?.trim();
  return pinned ? sessionStatusArgv({ id: pinned }) : sessionListArgv({ all });
}

type SessionCliRunner<R = never> = (args: readonly string[]) => Effect.Effect<string, unknown, R>;

type SessionCliOutcome = { readonly status: number; readonly bodyJson: string };

type DocOpenRequest = {
  readonly path: string;
  readonly id: string;
  readonly year?: string;
  readonly conflictPolicy?: string;
  readonly detach?: boolean;
};

export function docRecentsArgs(year?: string | null): string[] {
  return docRecentsArgv({ year: readOptionalString(year) });
}

export function parseDocOpenRequest(
  body: unknown,
):
  | { readonly ok: true; readonly request: DocOpenRequest }
  | { readonly ok: false; readonly error: string } {
  const record =
    typeof body === "object" && body !== null && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : {};
  const path = readOptionalString(record.path);
  const id = readOptionalString(record.id);
  if (!path || !id) return { ok: false, error: "document open requires path and id" };
  return {
    ok: true,
    request: {
      path,
      id,
      year: typeof record.year === "number" ? String(record.year) : readOptionalString(record.year),
      conflictPolicy: readOptionalString(record.conflictPolicy),
      detach: record.detach === true,
    },
  };
}

export function docOpenArgs(request: DocOpenRequest): string[] {
  return docOpenArgv(request);
}

// Start and restart block on Revit readiness (cold boot is 180-300s; the CLI's own wait
// default is 420s; a dev-lane start also builds first) — the route budget must outlast the CLI's.
const DEFAULT_ACTION_TIMEOUT_MS = 600_000;
const STATUS_TIMEOUT_MS = 60_000;
const DOC_OPEN_TIMEOUT_MS = 600_000;

export function sessionActionTimeoutMs(request: SessionActionRequest): number {
  return request.timeoutSeconds != null
    ? Math.round(request.timeoutSeconds * 1000) + 60_000
    : DEFAULT_ACTION_TIMEOUT_MS;
}

/**
 * Run one shelled session CLI invocation and shape the HTTP outcome: stdout (the CLI's JSON
 * envelope, emitted on success AND on failed verdicts) relays verbatim; a spawn failure is a 500;
 * a CLI that never answered is a 504 naming the real remedy. The 504 body is deliberately NOT
 * envelope-shaped: no envelope exists to relay, and inventing one would put a fake `state` and a
 * fake diagnostic code into a surface whose entire value is that its words are the SDK's.
 */
export function executeSessionCli<R>(
  args: readonly string[],
  runCli: SessionCliRunner<R>,
  timeoutMs: number,
  timeoutContext: { readonly action: string; readonly id?: string },
): Effect.Effect<SessionCliOutcome, never, R> {
  return Effect.gen(function* () {
    const outcome = yield* Effect.result(runCli(args).pipe(Effect.timeoutOption(timeoutMs)));
    if (outcome._tag === "Failure")
      return {
        status: 500,
        bodyJson: JSON.stringify({ ok: false, error: String(outcome.failure) }),
      } satisfies SessionCliOutcome;
    if (Option.isNone(outcome.success)) {
      const target = timeoutContext.id ? ` --id ${timeoutContext.id}` : "";
      return {
        status: 504,
        bodyJson: JSON.stringify({
          ok: false,
          error: `pe-revit session ${timeoutContext.action}${target} did not answer within ${Math.round(timeoutMs / 1000)}s. The process may still be alive but blocked inside a Revit API call, which no timeout can cancel.`,
          nextSteps: [
            timeoutContext.id
              ? `pe-revit session status --id ${timeoutContext.id} --json — read what the SDK actually observes`
              : `pe-revit session list --all --json — read what the SDK actually observes`,
            `pe-revit session stop${target} --force — force-stop that exact incarnation`,
          ],
        }),
      } satisfies SessionCliOutcome;
    }
    return { status: 200, bodyJson: outcome.success.value } satisfies SessionCliOutcome;
  });
}

// Real shell layer: same launcher chain as hostUpdateRoute/install-gc. An empty stdout means
// the resolved CLI does not speak this verb (e.g. a pre-session installed shim) — fail loudly
// instead of relaying a blank 200.
const runPeRevitCli: SessionCliRunner<ChildProcessSpawner.ChildProcessSpawner> = (args) =>
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

function jsonResponse(outcome: SessionCliOutcome) {
  return Response.text(outcome.bodyJson, {
    status: outcome.status,
    headers: { "content-type": "application/json" },
  });
}

const sessionsStatusRoute = HttpRouter.add("GET", "/sessions", (req) =>
  Effect.gen(function* () {
    const search = new URL(req.url, "http://localhost").searchParams;
    const id = search.get("id");
    const outcome = yield* executeSessionCli(
      sessionStatusArgs(id, search.get("all") === "true"),
      runPeRevitCli,
      STATUS_TIMEOUT_MS,
      { action: "status", id: id ?? undefined },
    );
    return jsonResponse(outcome);
  }),
);

const sessionsActionRoute = HttpRouter.add("POST", "/sessions", (req) =>
  Effect.gen(function* () {
    const body = yield* Effect.result(req.json);
    const parsed = parseSessionActionRequest(body._tag === "Success" ? body.success : null);
    if (!parsed.ok) return Response.jsonUnsafe({ ok: false, error: parsed.error }, { status: 400 });
    const request = parsed.request;
    const project =
      request.lane === "dev"
        ? resolveStartProject(hostOwnership.lane, hostOwnership.sourceRoot)
        : undefined;
    if (request.lane === "dev" && project === undefined)
      return Response.jsonUnsafe(
        {
          ok: false,
          error: `lane "dev" needs a source-linked host; this host (lane ${hostOwnership.lane}) has no checkout to build Pe.App from — start with lane "installed" or run the host from a checkout`,
        },
        { status: 400 },
      );
    const args = sessionCliArgs(request, project);
    const outcome = yield* executeSessionCli(args, runPeRevitCli, sessionActionTimeoutMs(request), {
      action: request.action,
      id: request.id,
    });
    return jsonResponse(outcome);
  }),
);

export const sessionsRoute = Layer.mergeAll(sessionsStatusRoute, sessionsActionRoute);

const docsRecentsRoute = HttpRouter.add("GET", "/docs/recents", (req) =>
  Effect.gen(function* () {
    const year = new URL(req.url, "http://localhost").searchParams.get("year");
    const outcome = yield* executeSessionCli(
      docRecentsArgs(year),
      runPeRevitCli,
      STATUS_TIMEOUT_MS,
      { action: "doc recents" },
    );
    return jsonResponse(outcome);
  }),
);

const docsOpenRoute = HttpRouter.add("POST", "/docs/open", (req) =>
  Effect.gen(function* () {
    const body = yield* Effect.result(req.json);
    const parsed = parseDocOpenRequest(body._tag === "Success" ? body.success : null);
    if (!parsed.ok) return Response.jsonUnsafe({ ok: false, error: parsed.error }, { status: 400 });
    const outcome = yield* executeSessionCli(
      docOpenArgs(parsed.request),
      runPeRevitCli,
      DOC_OPEN_TIMEOUT_MS,
      { action: "doc open", id: parsed.request.id },
    );
    return jsonResponse(outcome);
  }),
);

export const docsRoute = Layer.mergeAll(docsRecentsRoute, docsOpenRoute);
