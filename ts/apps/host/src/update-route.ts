import { spawn } from "node:child_process";
import { Deferred, Effect, Layer } from "effect";
import { HttpRouter, HttpServerResponse as Response } from "effect/unstable/http";
import { HostLifecycle, resolveHostVersion } from "./host-lifecycle.ts";
import { hostOwnership } from "./host-ownership.ts";
import { parsePeRevitEnvelope, peRevitLauncher } from "./pe-revit-launch.ts";

/** `pe-revit update check` result (SDK UpdateCommand.CheckResult). */
type CheckResult = {
  update: { current: string; latest: string | null; available: boolean };
  revits: { pid: number; year: number; answering: boolean; idle: boolean; unsaved: string[] }[];
  quiet: boolean;
};

/**
 * One `pe-revit update` verb. `apply` runs detached: libuv puts every non-detached child of this
 * process in a kill-on-close job, and the stub apply hands off to must outlive this host.
 */
function updateVerb<A>(args: string[], detached = false) {
  const launch = peRevitLauncher();
  const verbArgs = ["update", ...args, "--json"];
  return new Promise<{ result: A; diagnostics: { code: string; detail: string }[] }>(
    (resolve, reject) => {
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
          resolve(parsePeRevitEnvelope<A>(stdout, verbArgs, launch) as never);
        } catch (error) {
          reject(error);
        }
      });
    },
  );
}

const said = (diagnostics: { code: string; detail: string }[]) =>
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
  const check = await updateVerb<CheckResult>(["check"]).catch(() => null);
  if (!check?.result.update?.available || check.result.revits.length > 0) return false;
  const applied = await updateVerb<{ phase?: string }>(
    ["apply", "--wait-pid", String(process.pid), "--no-shortcut-args"],
    true,
  ).catch(() => null);
  return applied?.result.phase === "handed-off";
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
        const envelope = await updateVerb<CheckResult>(["check"]);
        if (envelope.diagnostics.length)
          return Response.jsonUnsafe({
            installedVersion,
            latestVersion: null,
            updateAvailable: false,
            quiet: false,
            error: said(envelope.diagnostics),
          });
        const { update, revits, quiet } = envelope.result;
        return Response.jsonUnsafe({
          installedVersion: update.current,
          latestVersion: update.latest,
          updateAvailable: update.available,
          quiet,
          revits,
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
  HttpRouter.add("POST", "/host/update", () =>
    Effect.gen(function* () {
      if (hostOwnership.lane !== "installed")
        return yield* Response.json(
          { error: "Only the installed app updates itself." },
          { status: 409 },
        );
      const outcome = yield* Effect.promise(() =>
        updateVerb<{ phase?: string; check?: { latest: string } }>(
          ["apply", "--wait-pid", String(process.pid)],
          true,
        ).catch((error: unknown) => ({
          result: {},
          diagnostics: [{ code: "host", detail: String(error) }],
        })),
      );
      const phase = (outcome.result as { phase?: string }).phase;
      if (phase === "current")
        return yield* Response.json(
          { accepted: false, reason: "already-current", installedVersion: resolveHostVersion() },
          { status: 409 },
        );
      if (phase !== "handed-off")
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
        latestVersion: (outcome.result as { check?: { latest: string } }).check?.latest ?? null,
      });
    }),
  ),
);
