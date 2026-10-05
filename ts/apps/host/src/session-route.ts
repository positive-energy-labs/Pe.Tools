import { Effect, Layer, Option } from "effect";
import { NodeServices } from "@effect/platform-node";
import { OwnerReads, type OwnerValue } from "@pe/runtime";
import { canonicalRouteInput, type SdkReading } from "@pe/agent-contracts";
import { HttpRouter, HttpServerResponse as Response } from "effect/unstable/http";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";
import { join } from "node:path";
import {
  docListArgv,
  doctorArgv,
  sessionListArgv,
  sessionStartArgv,
} from "@pe/host-contracts/pe-revit-contract";
import { checkoutLayout } from "@pe/host-contracts/service-identity";
import { hostOwnership, type HostLane } from "./host-ownership.ts";
import { peRevitLauncher, validatePeRevitEnvelope } from "./pe-revit-launch.ts";

/**
 * Control plane for Revit sessions — NOT a catalog op. Session lifecycle belongs to the SDK
 * (`pe-revit session …` is the only implementation); this plain HTTP route is a THIN RELAY so a
 * browser can reach it. It shells the CLI through the GENERATED argv builders
 * (`@pe/host-contracts/pe-revit-contract`, vendored from the SDK and drift-guarded by
 * `pe-revit doctor`'s `ts-client-drift`) and hands the CLI's envelope back untouched.
 *
 * Untouched is the whole contract. This file forges NO envelope of its own: every state, code,
 * diagnostic and nextStep a caller sees is the SDK's, so the browser and an agent running
 * `pe-revit session list` read the same words. A hung CLI is the one
 * thing we cannot relay (no
 * envelope was ever produced) and is reported as a plain 504, not as a hand-made `unresponsive`
 * result that would look like an SDK verdict without being one.
 *
 * GET /sessions → `session list --json`, narrowed with `--id` when an id is supplied. Lifecycle
 * mutations are not relayed here: they are host-admitted Instances actions (instances-actions.ts).
 */

function readOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/**
 * Dev/prod payload routing: the HOST LANE decides which payload a session runs — the caller never
 * chooses source vs installed. A source-linked (dev) host starts sessions from its own checkout's
 * Pe.App project; an installed-lane host omits `--project` entirely, because a project-less
 * `session start` IS the installed lane (the `--installed <payload>` flag is gone — lane is
 * payload SOURCE, derived, never named by the caller). `sourceRoot` is the checkout root.
 */
export function resolveStartProject(lane: HostLane, sourceRoot: string | null): string | undefined {
  return lane === "dev" && sourceRoot
    ? join(sourceRoot, checkoutLayout.dotnet, "Pe.App", "Pe.App.csproj")
    : undefined;
}

/** GET (list) CLI args; `id` narrows to one session, `all` includes the graveyard. */
export function sessionStatusArgs(id?: string | null, all = false): string[] {
  const pinned = id?.trim();
  return pinned ? sessionListArgv({ id: pinned }) : sessionListArgv({ all });
}

type SessionCliRunner<R = never> = (args: readonly string[]) => Effect.Effect<string, unknown, R>;

type SessionCliOutcome = { readonly status: number; readonly bodyJson: string };

/** `doc list --recent [--year]`: the per-year recents; needs no Revit. */
export function docRecentsArgs(year?: string | null): string[] {
  return docListArgv({ recent: true, year: readOptionalString(year) });
}

/** `doc list [--id] [--doc]`: open documents; no `--id` reads every live session. */
export function docListArgs(id?: string | null, doc?: string | null): string[] {
  return docListArgv({ id: readOptionalString(id), doc: readOptionalString(doc) });
}

const STATUS_TIMEOUT_MS = 60_000;

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
          error: `pe-revit session ${timeoutContext.action}${target} did not answer within ${Math.round(timeoutMs / 1000)}s. The process may still be alive but blocked inside a Revit API call, which only session reset ends.`,
          nextSteps: [
            timeoutContext.id
              ? `pe-revit session list --id ${timeoutContext.id} --json — read what the SDK actually observes`
              : `pe-revit session list --all --json — read what the SDK actually observes`,
            `pe-revit session reset --id ${timeoutContext.id ?? "<id>"} --unsaved keep|discard — recover a wedged session; choose what happens to unsaved work`,
          ],
        }),
      } satisfies SessionCliOutcome;
    }
    return { status: 200, bodyJson: outcome.success.value } satisfies SessionCliOutcome;
  });
}

// Real shell layer: the same launcher chain as hostUpdateRoute. An empty stdout means
// the resolved CLI does not speak this verb (e.g. a pre-session installed shim) — fail loudly
// instead of relaying a blank 200.
export const runPeRevitCli: SessionCliRunner<ChildProcessSpawner.ChildProcessSpawner> = (args) =>
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

/** One SDK observation owner; the browser's former fleet timer lives here. */
const sdkReads = new OwnerReads();
export function observeSdkReading(
  request: SdkReading,
  accept: (value: OwnerValue<unknown>) => void,
  subscribe: (notify: () => void) => () => void = () => () => {},
) {
  return sdkReads.observe(
    canonicalRouteInput(request),
    async () => {
      const args =
        request.read === "sessions"
          ? sessionStatusArgs(request.id, request.all)
          : request.read === "doctor"
            ? doctorArgv({ timeoutSeconds: 20 })
            : request.read === "recents"
              ? docRecentsArgs(request.year)
              : docListArgs(request.id);
      const result = await Effect.runPromise(
        executeSessionCli(args, runPeRevitCli, STATUS_TIMEOUT_MS, {
          action: request.read,
          id: request.id,
        }).pipe(Effect.provide(NodeServices.layer)),
      );
      if (result.status !== 200) throw Error(result.bodyJson);
      return JSON.parse(result.bodyJson) as unknown;
    },
    (notify) => {
      const release = subscribe(notify);
      const timer = request.read === "sessions" ? setInterval(notify, 5_000) : undefined;
      return () => {
        release();
        if (timer) clearInterval(timer);
      };
    },
    accept,
  );
}

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

// LEDGER (docs/features/host/LEDGER.md): the browser never mints session ids — this route
// discloses the id the SDK WOULD mint, via `session start --plan` (no mutation). A
// `session.bootstrap-missing` refusal for a never-converged year relays verbatim, like any envelope.
const sessionsMintRoute = HttpRouter.add("GET", "/sessions/mint", (req) =>
  Effect.gen(function* () {
    const search = new URL(req.url, "http://localhost").searchParams;
    const lane = search.get("lane");
    const year = search.get("year")?.trim();
    if ((lane !== "installed" && lane !== "dev") || !year)
      return Response.jsonUnsafe(
        { ok: false, error: 'mint requires lane ("installed" or "dev") and year (e.g. "25")' },
        { status: 400 },
      );
    const project = resolveStartProject(hostOwnership.lane, hostOwnership.sourceRoot);
    if (lane === "dev" && project === undefined)
      return Response.jsonUnsafe(
        {
          ok: false,
          error: `lane "dev" needs a source-linked host; this host (lane ${hostOwnership.lane}) has no checkout to build Pe.App from — mint with lane "installed" or run the host from a checkout`,
        },
        { status: 400 },
      );
    const outcome = yield* executeSessionCli(
      sessionStartArgv({ project: lane === "dev" ? project : undefined, year, plan: true }),
      runPeRevitCli,
      STATUS_TIMEOUT_MS,
      { action: "start --plan" },
    );
    return jsonResponse(outcome);
  }),
);

const doctorRoute = HttpRouter.add("GET", "/doctor", () =>
  Effect.gen(function* () {
    const outcome = yield* executeSessionCli(
      doctorArgv({ timeoutSeconds: 20 }),
      runPeRevitCli,
      STATUS_TIMEOUT_MS,
      { action: "doctor" },
    );
    return jsonResponse(outcome);
  }),
);

const instancesReadingsRoute = HttpRouter.add("GET", "/instances/readings", (req) =>
  Effect.tryPromise(async () => {
    const { sdkReadingSchema } = await import("@pe/agent-contracts");
    const query = new URL(req.url, "http://host").searchParams;
    const request = sdkReadingSchema.parse({
      kind: "sdk",
      read: query.get("read"),
      ...(query.has("id") ? { id: query.get("id") } : {}),
      ...(query.has("year") ? { year: query.get("year") } : {}),
      ...(query.has("all") ? { all: query.get("all") === "true" } : {}),
    });
    const value = await new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        release();
        reject(Error("SDK reading timed out"));
      }, STATUS_TIMEOUT_MS + 1000);
      const release = observeSdkReading(request, (result) => {
        clearTimeout(timer);
        release();
        if ("error" in result) reject(Error(result.error));
        else resolve(result.value);
      });
    });
    return Response.jsonUnsafe(value);
  }).pipe(
    Effect.catch((error) =>
      Effect.succeed(Response.jsonUnsafe({ error: String(error) }, { status: 503 })),
    ),
  ),
);

export const sessionsRoute = Layer.mergeAll(
  instancesReadingsRoute,
  sessionsStatusRoute,
  sessionsMintRoute,
  doctorRoute,
);

const docsRecentsRoute = HttpRouter.add("GET", "/docs/recents", (req) =>
  Effect.gen(function* () {
    const year = new URL(req.url, "http://localhost").searchParams.get("year");
    const outcome = yield* executeSessionCli(
      docRecentsArgs(year),
      runPeRevitCli,
      STATUS_TIMEOUT_MS,
      { action: "doc list --recent" },
    );
    return jsonResponse(outcome);
  }),
);

const docsListRoute = HttpRouter.add("GET", "/docs", (req) =>
  Effect.gen(function* () {
    const search = new URL(req.url, "http://localhost").searchParams;
    const id = search.get("id");
    const outcome = yield* executeSessionCli(
      docListArgs(id, search.get("doc")),
      runPeRevitCli,
      STATUS_TIMEOUT_MS,
      { action: "doc list", id: id ?? undefined },
    );
    return jsonResponse(outcome);
  }),
);

export const docsRoute = Layer.mergeAll(docsRecentsRoute, docsListRoute);
