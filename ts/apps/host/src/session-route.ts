import { Effect, Option } from "effect";
import { NodeServices } from "@effect/platform-node";
import { OwnerReads, type OwnerValue } from "@pe/runtime";
import {
  canonicalRouteInput,
  type SdkSessionSelection,
  type SdkReading,
} from "@pe/agent-contracts";
import { HttpRouter, HttpServerResponse as Response } from "effect/unstable/http";
import { execFile, spawn } from "node:child_process";
import { join } from "node:path";
import { docListArgv, doctorArgv, sessionListArgv } from "@pe/host-contracts/pe-revit-contract";
import { checkoutLayout } from "@pe/host-contracts/service-identity";
import { type HostLane } from "./host-ownership.ts";
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
 * /instances/readings and the shared Reading owner relay SDK reads. Lifecycle mutations are
 * host-admitted Instances actions (instances-actions.ts).
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
export function sessionStatusArgs(session?: SdkSessionSelection, all = false): string[] {
  return sessionListArgv({ ...session, all });
}

type SessionCliRunner<R = never> = (args: readonly string[]) => Effect.Effect<string, unknown, R>;

type SessionCliOutcome = { readonly status: number; readonly bodyJson: string };

/** `doc list --recent [--year]`: the per-year recents; needs no Revit. */
export function docRecentsArgs(year?: string | null): string[] {
  return docListArgv({ recent: true, year: readOptionalString(year) });
}

/** Open documents in the SDK-resolved session; omission runs its default ladder. */
export function docListArgs(session?: SdkSessionSelection, doc?: string | null): string[] {
  return docListArgv({ ...session, doc: readOptionalString(doc) });
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
export const runPeRevitCli: SessionCliRunner = (args) =>
  Effect.scoped(
    Effect.gen(function* () {
      const launch = peRevitLauncher();
      const running = yield* Effect.acquireRelease(
        Effect.try({
          try: () => {
            const child = spawn(launch.cmd, [...launch.args, ...args], {
              cwd: launch.cwd,
              windowsHide: true,
              detached: process.platform !== "win32",
              stdio: ["ignore", "pipe", "pipe"],
            });
            let closed = false;
            let stdout = "";
            child.stdout.setEncoding("utf8");
            child.stdout.on("data", (chunk: string) => {
              stdout += chunk;
            });
            child.stderr.resume();
            const exited = new Promise<void>((resolve) =>
              child.once("close", () => {
                closed = true;
                resolve();
              }),
            );
            const output = new Promise<string>((resolve, reject) => {
              child.once("error", reject);
              child.stdout.once("error", reject);
              child.stderr.once("error", reject);
              child.once("close", () => resolve(stdout));
            });
            return {
              child,
              exited,
              needsCleanup: () => !closed,
              output,
            };
          },
          catch: (error) => (error instanceof Error ? error : new Error(String(error))),
        }),
        (running) =>
          Effect.promise(async () => {
            if (!running.needsCleanup()) return;
            const { child } = running;
            // Preserve the adapter's process-tree cleanup without spawning a visible taskkill console.
            if (child.pid && process.platform === "win32")
              await new Promise<void>((resolve) =>
                execFile(
                  "taskkill",
                  ["/pid", String(child.pid), "/T", "/F"],
                  { windowsHide: true, timeout: 5000 },
                  (error) => {
                    if (error) child.kill();
                    resolve();
                  },
                ),
              );
            else if (child.pid) {
              try {
                process.kill(-child.pid, "SIGTERM");
              } catch {
                child.kill();
              }
            }
            let deadline: ReturnType<typeof setTimeout> | undefined;
            try {
              await Promise.race([
                running.exited,
                new Promise<never>((_resolve, reject) => {
                  deadline = setTimeout(
                    () => reject(Error("The CLI child did not close after termination.")),
                    5000,
                  );
                }),
              ]);
            } finally {
              clearTimeout(deadline);
            }
          }),
      );
      const stdout = yield* Effect.tryPromise({
        try: () => running.output,
        catch: (error) => (error instanceof Error ? error : new Error(String(error))),
      });
      return yield* Effect.try({
        try: () => validatePeRevitEnvelope(stdout, args, launch),
        catch: (error) => (error instanceof Error ? error : new Error(String(error))),
      });
    }),
  );

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
          ? sessionStatusArgs(request.session, request.all)
          : request.read === "doctor"
            ? doctorArgv({ timeoutSeconds: 20 })
            : request.read === "recents"
              ? docRecentsArgs(request.year)
              : docListArgs(request.session);
      const result = await Effect.runPromise(
        executeSessionCli(args, runPeRevitCli, STATUS_TIMEOUT_MS, {
          action: request.read,
          id: request.session && "id" in request.session ? request.session.id : undefined,
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

export const instancesReadingsRoute = HttpRouter.add("GET", "/instances/readings", (req) =>
  Effect.tryPromise(async () => {
    const { sdkReadingSchema } = await import("@pe/agent-contracts");
    const query = new URL(req.url, "http://host").searchParams;
    if ([...query.keys()].some((key) => !["read", "session", "year", "all"].includes(key)))
      throw Error("Unknown SDK reading field; session accepts an id-or-pid object");
    const request = sdkReadingSchema.parse({
      kind: "sdk",
      read: query.get("read"),
      ...(query.has("session") ? { session: JSON.parse(query.get("session")!) } : {}),
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
