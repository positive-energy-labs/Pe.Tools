import { spawn } from "node:child_process";
import { join } from "node:path";
import { Deferred, Effect, Layer } from "effect";
import { HttpRouter, HttpServerResponse as Response } from "effect/unstable/http";
import { HostLifecycle } from "./host-lifecycle.ts";
import { hostOwnership, productRoot } from "./host-ownership.ts";
import { parsePeRevitEnvelope, peRevitLauncher } from "./pe-revit-launch.ts";
import { createUpdateReader, UpdateReader, type UpdateRunner } from "./update-reader.ts";

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
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.on("error", reject);
    child.on("close", () => {
      try {
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

/** Login applies only with no Revit, through the same durable admission as the HTTP action. */
export async function updateWhenNoRevit(reader = makeInstalledUpdateReader()): Promise<boolean> {
  if (hostOwnership.lane !== "installed") return false;
  await new Promise((resolve) => setTimeout(resolve, 60_000));
  const { plan } = await reader.refresh();
  if (!plan?.available || plan.revits.length > 0) return false;
  const applied = await reader.apply(plan.planId, true).catch(() => null);
  return (
    applied?.receipt?.legs.some((leg) => leg.name === "handoff" && leg.status === "ok") === true
  );
}

export const updateRoutes = Layer.mergeAll(
  HttpRouter.add("GET", "/host/update", () =>
    Effect.gen(function* () {
      const reader = yield* UpdateReader;
      // Machine is the clock. GET only acquires before the first observation.
      const current = reader.current();
      return Response.jsonUnsafe(
        current.planLeg.attemptedAtUtc ? current : yield* Effect.promise(reader.refresh),
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
      if (typeof planId !== "string" || !planId.trim())
        return Response.jsonUnsafe({ error: "An update planId is required." }, { status: 400 });
      const reader = yield* UpdateReader;
      const outcome = yield* Effect.tryPromise(() => reader.apply(planId)).pipe(
        Effect.catch((error) => Effect.succeed({ error: String(error) })),
      );
      if ("error" in outcome) return Response.jsonUnsafe(outcome, { status: 409 });
      const receipt = outcome.receipt;
      if (receipt?.legs.some((leg) => leg.name === "handoff" && leg.status === "ok")) {
        const { latch } = yield* HostLifecycle;
        yield* Effect.forkDetach(
          Effect.sleep("1 second").pipe(Effect.andThen(Deferred.succeed(latch, undefined))),
        );
      }
      return Response.jsonUnsafe(
        {
          accepted: true,
          requestId: outcome.requestId,
          planId,
          receiptPath: receipt?.receiptPath ?? null,
          receipt,
          error: outcome.receiptLeg.error,
        },
        { status: 202 },
      );
    }),
  ),
);
