import { spawn } from "node:child_process";
import { join } from "node:path";
import { Deferred, Effect, Layer } from "effect";
import { HttpRouter, HttpServerResponse as Response } from "effect/unstable/http";
import { HostLifecycle } from "./host-lifecycle.ts";
import { hostOwnership, productRoot } from "./host-ownership.ts";
import { parsePeRevitEnvelope, peRevitLauncher } from "./pe-revit-launch.ts";
import {
  createUpdateReader,
  isUpdatePlanId,
  UpdateReader,
  type UpdateRunner,
} from "./update-reader.ts";

/** Detached apply must outlive this host's libuv kill-on-close job. */
export const updateVerb: UpdateRunner = (verbArgs, detached = false) => {
  const launch = peRevitLauncher();
  return new Promise((resolve, reject) => {
    const child = spawn(launch.cmd, [...launch.args, ...verbArgs], {
      cwd: launch.cwd,
      detached,
      windowsHide: true,
      stdio: ["ignore", "pipe", "ignore"],
    });
    let stdout = "";
    let settled = false;
    const settle = (envelope: () => Parameters<typeof resolve>[0]) => {
      if (settled) return;
      try {
        const value = envelope();
        settled = true;
        resolve(value);
      } catch (error) {
        if (!detached) reject(error);
      }
    };
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      // A detached apply hands off to the installer stub, which inherits this pipe and then waits for
      // THIS host to exit (`--wait-pid`). Waiting for the pipe to close here deadlocks both until the
      // stub gives up (install refused: "Processes still running after 120 seconds"). Resolve on the
      // envelope the CLI prints at handoff; the pipe closes whenever the stub finishes.
      if (detached) settle(() => parsePeRevitEnvelope(stdout, verbArgs, launch));
    });
    child.on("error", reject);
    child.on("close", () => {
      if (settled) return;
      try {
        settled = true;
        resolve(parsePeRevitEnvelope(stdout, verbArgs, launch));
      } catch (error) {
        reject(error);
      }
    });
  });
};

export const makeInstalledUpdateReader = () =>
  createUpdateReader({
    path: join(productRoot(), "state", "host-update.json"),
    run: updateVerb,
    installed: hostOwnership.lane === "installed",
    pid: process.pid,
    manifest: join(productRoot(), "product.payloads.json"),
  });

export const updateRoutes = Layer.mergeAll(
  HttpRouter.add("GET", "/host/update", (request) =>
    Effect.gen(function* () {
      const reader = yield* UpdateReader;
      // Ordinary readers share Machine's clock; Recheck explicitly reads the feed and plan.
      const current = reader.current();
      return Response.jsonUnsafe(
        !new URL(request.url, "http://host").searchParams.has("recheck") &&
          current.planLeg.attemptedAtUtc
          ? current
          : yield* Effect.promise(() => reader.refresh()),
      );
    }),
  ),
  HttpRouter.add("POST", "/host/update", (request) =>
    Effect.gen(function* () {
      if (hostOwnership.lane !== "installed")
        return Response.jsonUnsafe(
          { error: "Only the installed app updates itself." },
          { status: 409 },
        );
      const body = yield* request.json.pipe(Effect.catch(() => Effect.succeed(null)));
      const planId = (body as { planId?: unknown } | null)?.planId;
      if (!isUpdatePlanId(planId))
        return Response.jsonUnsafe(
          { error: "An update planId must be a canonical UUID." },
          { status: 400 },
        );
      const reader = yield* UpdateReader;
      const outcome = yield* Effect.tryPromise(() => reader.apply(planId)).pipe(
        Effect.catch((error) => Effect.succeed({ error: String(error) })),
      );
      if ("error" in outcome) return Response.jsonUnsafe(outcome, { status: 409 });
      const receipt = outcome.receipt;
      const refused = receipt?.state === "refused" || receipt?.state === "failed";
      if (
        receipt?.state === "running" &&
        receipt.legs.some((leg) => leg.name === "handoff" && leg.status === "ok")
      ) {
        const { latch } = yield* HostLifecycle;
        yield* Effect.forkDetach(
          Effect.sleep("1 second").pipe(Effect.andThen(Deferred.succeed(latch, undefined))),
        );
      }
      return Response.jsonUnsafe(
        {
          accepted: !refused,
          requestId: outcome.requestId,
          planId,
          receiptPath: receipt?.receiptPath ?? null,
          receipt,
          error:
            outcome.receiptLeg.error ??
            (refused ? (receipt?.legs.at(-1)?.detail ?? `Update ${receipt?.state}.`) : null),
        },
        { status: refused ? 409 : 202 },
      );
    }),
  ),
);
