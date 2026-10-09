import { spawn } from "node:child_process";
import { Deferred, Effect, Layer } from "effect";
import { HttpRouter, HttpServerResponse as Response } from "effect/unstable/http";
import {
  updateCheckArgv,
  updateApplyArgv,
  type UpdatePlan,
  type UpdateReceipt,
} from "@pe/host-contracts/pe-revit-contract";
import { HostLifecycle, resolveHostVersion } from "./host-lifecycle.ts";
import { hostOwnership } from "./host-ownership.ts";
import { parsePeRevitEnvelope, peRevitLauncher } from "./pe-revit-launch.ts";

/**
 * One `pe-revit update` verb. `apply` runs detached: libuv puts every non-detached child of this
 * process in a kill-on-close job, and the stub apply hands off to must outlive this host.
 */
function updateVerb<A>(verbArgs: string[], detached = false) {
  const launch = peRevitLauncher();
  return new Promise<ReturnType<typeof parsePeRevitEnvelope<A>>>((resolve, reject) => {
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
        resolve(parsePeRevitEnvelope<A>(stdout, verbArgs, launch));
      } catch (error) {
        reject(error);
      }
    });
  });
}

const said = (diagnostics: readonly { code: string; detail: string }[]) =>
  diagnostics.map((d) => `${d.code}: ${d.detail}`).join("; ");

/**
 * The installed host started without a window (the login Run key, or Revit's add-in) updates only
 * when no Revit runs at all: an idle Revit may be the one the user just opened. True when apply
 * handed off, so the caller exits and the stub can install.
 * ponytail: one attempt a minute after boot; a login with no network yet waits for the next start.
 */
export async function updateWhenNoRevit(): Promise<boolean> {
  if (hostOwnership.lane !== "installed") return false;
  await new Promise((resolve) => setTimeout(resolve, 60_000));
  const check = await updateVerb<UpdatePlan>(updateCheckArgv()).catch(() => null);
  if (!check || check.exitCode !== 0 || !check.result.available || check.result.revits.length > 0)
    return false;
  const applied = await updateVerb<UpdateReceipt>(
    updateApplyArgv({ planId: check.result.planId, waitPid: process.pid, noShortcutArgs: true }),
    true,
  ).catch(() => null);
  return (
    applied?.result.legs?.some((leg) => leg.name === "handoff" && leg.status === "ok") === true
  );
}

/**
 * The installed host updates itself through the SDK (host ledger 2026-10-08). GET reads the feed and
 * the Revits on this machine; `quiet` (no Revit, or all idle with nothing unsaved) is when the web
 * applies without asking. POST runs apply, which closes every Revit keeping its work and hands off
 * to a stub that waits for this host to exit, installs, reopens the documents and relaunches the app.
 */
export const updateRoutes = Layer.mergeAll(
  HttpRouter.add("GET", "/host/update", () =>
    Effect.promise(async () => {
      const installedVersion = hostOwnership.lane === "installed" ? resolveHostVersion() : null;
      if (!installedVersion)
        return Response.jsonUnsafe({
          installedVersion,
          latestVersion: null,
          updateAvailable: false,
          quiet: false,
        });
      try {
        const envelope = await updateVerb<UpdatePlan>(updateCheckArgv());
        if (envelope.exitCode !== 0 || envelope.diagnostics.length)
          return Response.jsonUnsafe({
            installedVersion,
            latestVersion: null,
            updateAvailable: false,
            quiet: false,
            error: said(envelope.diagnostics),
          });
        const { current, latest, available, planId, revits, quiet, blockers } = envelope.result;
        return Response.jsonUnsafe({
          installedVersion: current,
          latestVersion: latest,
          updateAvailable: available,
          planId,
          quiet,
          revits,
          blockers,
        });
      } catch (error) {
        return Response.jsonUnsafe({
          installedVersion,
          latestVersion: null,
          updateAvailable: false,
          quiet: false,
          error: String(error),
        });
      }
    }),
  ),
  HttpRouter.add("POST", "/host/update", (request) =>
    Effect.gen(function* () {
      if (hostOwnership.lane !== "installed")
        return yield* Response.json(
          { error: "Only the installed app updates itself." },
          { status: 409 },
        );
      const body = yield* request.json.pipe(Effect.catch(() => Effect.succeed(null)));
      const planId = (body as { planId?: unknown } | null)?.planId;
      if (typeof planId !== "string" || !planId.trim())
        return yield* Response.json({ error: "An update planId is required." }, { status: 400 });
      const outcome = yield* Effect.promise(() =>
        updateVerb<UpdateReceipt>(updateApplyArgv({ planId, waitPid: process.pid }), true).catch(
          (error: unknown) => ({
            result: null,
            diagnostics: [{ code: "host", detail: String(error) }],
          }),
        ),
      );
      const receipt = outcome.result;
      if (receipt?.state === "ok" && receipt.legs.some((leg) => leg.name === "done"))
        return yield* Response.json(
          { accepted: false, reason: "already-current", installedVersion: resolveHostVersion() },
          { status: 409 },
        );
      if (!receipt?.legs?.some((leg) => leg.name === "handoff" && leg.status === "ok"))
        return yield* Response.json(
          { error: said(outcome.diagnostics) || "update apply did not hand off" },
          { status: 502 },
        );
      // The stub waits for this pid: exit once the answer is on its way.
      const { latch } = yield* HostLifecycle;
      yield* Effect.forkDetach(
        Effect.sleep("1 second").pipe(Effect.andThen(Deferred.succeed(latch, undefined))),
      );
      return yield* Response.json({
        accepted: true,
        planId: receipt.planId,
        requestId: receipt.requestId,
        receiptPath: receipt.receiptPath,
      });
    }),
  ),
);
