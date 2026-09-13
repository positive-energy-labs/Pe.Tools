import "./ensure-source-lane.ts";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { Deferred, Effect } from "effect";
import { NodeRuntime } from "@effect/platform-node";
import { hostOwnership } from "./host-ownership.ts";
import { hostProgram } from "./host-program.ts";

// Reject foreign spawn plumbing before claiming or evicting any checkout's host.
if (
  resolve(hostOwnership.sourceRoot ?? "").toLowerCase() !==
  resolve(import.meta.dirname, "../../..").toLowerCase()
)
  throw new Error("Dev host source identity does not match this checkout.");

NodeRuntime.runMain(
  hostProgram((handle, ready) =>
    Effect.gen(function* () {
      const child = yield* Effect.acquireRelease(
        Effect.sync(() =>
          spawn(
            process.execPath,
            [
              "--import",
              "jiti/register",
              fileURLToPath(new URL("../scripts/dev-web.ts", import.meta.url)),
            ],
            {
              cwd: new URL("../", import.meta.url),
              stdio: ["ignore", "inherit", "inherit", "ipc"],
              // Node --watch uses this env flag to make children report imports over IPC.
              // The frontend owns its watcher; its imports must never restart the backend.
              env: { ...process.env, WATCH_REPORT_DEPENDENCIES: undefined },
              windowsHide: true,
            },
          ),
        ),
        (child) =>
          Effect.promise(async () => {
            if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
            await new Promise<void>((resolve) => {
              const timeout = setTimeout(() => child.kill(), 5_000);
              child.once("exit", () => {
                clearTimeout(timeout);
                resolve();
              });
              if (child.connected) child.disconnect();
            });
          }),
      );
      // Only the SDK claim winner starts an optimizer. The child receives the exact bound
      // endpoint over IPC, never discovers a host by port or another checkout's environment.
      const url = yield* Effect.tryPromise({
        try: () =>
          new Promise<string>((resolve, reject) => {
            const timeout = setTimeout(
              () => reject(new Error("Dev frontend did not start within 60s")),
              60_000,
            );
            child.once("error", (error) => {
              clearTimeout(timeout);
              reject(error);
            });
            child.once("exit", (code) => {
              clearTimeout(timeout);
              reject(new Error(`Dev frontend exited (${code})`));
            });
            child.once("message", (message) => {
              clearTimeout(timeout);
              if (typeof message !== "string" || !/^http:\/\/127\.0\.0\.1:\d+$/.test(message))
                reject(new Error("Invalid dev frontend address"));
              else resolve(message);
            });
            child.send({
              port: handle.serviceFile.port,
              sourceRoot: handle.serviceFile.sourceRoot,
              name: hostOwnership.serviceName,
            });
          }),
        catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
      });
      yield* Deferred.succeed(ready, url);
      return yield* Effect.callback<never, Error>((resume) => {
        child.once("exit", (code) =>
          resume(Effect.fail(new Error(`Dev frontend exited (${code})`))),
        );
        if (child.exitCode !== null || child.signalCode !== null)
          resume(Effect.fail(new Error("Dev frontend stopped")));
      });
    }),
  ),
);
