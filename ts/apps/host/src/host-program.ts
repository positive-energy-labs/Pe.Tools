import { execFile, spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { Deferred, Effect, Layer, type Scope } from "effect";
import { capture } from "@pe/runtime";
import { serviceFilePath, type ServiceFile } from "@pe/host-contracts/pe-service";
import type { ServiceHostHandle } from "@pe/host-contracts/pe-service-host";
import { productRoot } from "@pe/host-contracts/service-identity";
import { openWindow, prepareHostBinding, resolveHostVersion } from "./host-lifecycle.ts";
import { makeHttpLive, resolveWebRoot } from "./app.ts";
import { hostCapabilities, hostOwnership } from "./host-ownership.ts";
import { makeInstalledUpdateReader } from "./update-route.ts";

/** The shared host lifecycle used by both installed startup and source web development. */
export const hostProgram = (
  web?: (
    handle: ServiceHostHandle,
    ready: Deferred.Deferred<string>,
  ) => Effect.Effect<never, Error, Scope.Scope>,
  onShutdown?: () => void,
) =>
  Effect.scoped(
    Effect.gen(function* () {
      yield* Effect.sync(() =>
        capture("app_boot", { component: "host", version: resolveHostVersion() }),
      );
      const open = process.argv.includes("--open");
      const showTray = process.argv.includes("--show-tray");
      if (showTray && hostOwnership.lane !== "installed")
        throw Error("Use tools/dev-tray.ps1 to show the checkout tray.");
      const reuse = async (incumbent: ServiceFile) => {
        console.log(
          `pe-host service '${hostOwnership.serviceName}' already serving on ${incumbent.port} (pid ${incumbent.pid})`,
        );
        if (open) await openWindow(incumbent.port);
        if (showTray)
          await promisify(execFile)(
            installedTrayExecutable(),
            installedTrayArguments(incumbent, true),
            {
              windowsHide: true,
              timeout: 10_000,
            },
          );
      };
      const binding = yield* Effect.promise(() => prepareHostBinding(open, resolveHostVersion()));
      if (typeof binding !== "number") {
        yield* Effect.promise(() => reuse(binding));
        return;
      }
      const port = binding;

      const latch = yield* Deferred.make<void>();
      const handle = yield* Deferred.make<ServiceHostHandle>();
      const webUrl = web ? yield* Deferred.make<string>() : undefined;
      const updateReader = makeInstalledUpdateReader();
      const HttpLive = makeHttpLive({
        port,
        webUrl,
        capabilities: hostCapabilities,
        lifecycle: {
          latch,
          handle,
          startTray:
            hostOwnership.lane === "installed"
              ? (handle) => startInstalledTray(handle, showTray)
              : undefined,
        },
        updateReader,
        webRoot: resolveWebRoot(),
      });

      yield* Effect.forkScoped(
        Deferred.await(latch).pipe(
          Effect.andThen(Effect.sync(() => setTimeout(() => process.exit(0), 5_000).unref())),
        ),
      );

      console.log(`pe-host binding http://127.0.0.1:${port || "dynamic"}`);
      if (open)
        // Open only once the claim holds, on the port the service file names.
        yield* Effect.forkScoped(
          Deferred.await(handle).pipe(
            Effect.tap((claimed) => Effect.promise(() => openWindow(claimed.serviceFile.port))),
          ),
        );
      const frontend =
        web && webUrl
          ? Effect.flatMap(Deferred.await(handle), (claimed) => web(claimed, webUrl))
          : Effect.never;
      yield* Effect.raceFirst(
        Effect.raceFirst(
          Layer.launch(HttpLive).pipe(
            Effect.catchTag("ServeError", (error) => {
              const cause = error.cause;
              if (
                hostOwnership.lane !== "installed" ||
                typeof cause !== "object" ||
                cause === null ||
                !("code" in cause) ||
                cause.code !== "EADDRINUSE"
              )
                return Effect.fail(error);
              // A listener won between census and bind. Re-read it, never retry the bind.
              return Effect.promise(() => prepareHostBinding(open, resolveHostVersion())).pipe(
                Effect.flatMap((incumbent) =>
                  typeof incumbent === "number"
                    ? Effect.fail(error)
                    : Effect.promise(() => reuse(incumbent)),
                ),
              );
            }),
          ),
          frontend,
        ),
        Deferred.await(latch).pipe(Effect.tap(() => Effect.sync(() => onShutdown?.()))),
      );
    }),
  );

const installedTrayExecutable = () =>
  join(dirname(hostOwnership.executablePath), "tray", "Pe.Host.Tray.exe");

function installedTrayArguments(file: ServiceFile, show: boolean): string[] {
  return [
    "--parent-pid",
    String(file.pid),
    "--parent-start",
    file.processStartUtc,
    "--service-file",
    serviceFilePath(productRoot(), hostOwnership.serviceName),
    ...(show ? ["--show"] : []),
  ];
}

/** Claim-owned child: EOF asks the shim to dispose, and the finalizer awaits its actual exit. */
export async function startInstalledTray(
  handle: ServiceHostHandle,
  show = false,
): Promise<() => Promise<void>> {
  let stopping = false;
  let retries = 0;
  let recovery: ReturnType<typeof setTimeout> | undefined;
  let current: { child: ReturnType<typeof spawn>; exited: Promise<void> };
  const recover = () => {
    if (stopping || recovery) return;
    if (retries >= 3) {
      console.warn("pe-host tray recovery exhausted; tray unavailable until the host restarts");
      return;
    }
    recovery = setTimeout(
      () => {
        recovery = undefined;
        if (!stopping)
          void launch().catch((error) => {
            console.warn(`pe-host tray recovery: ${String(error)}`);
            recover();
          });
      },
      1_000 * 2 ** retries++,
    );
  };
  const launch = async () => {
    const child = spawn(
      installedTrayExecutable(),
      installedTrayArguments(handle.serviceFile, show),
      { windowsHide: true, stdio: ["pipe", "ignore", "ignore"] },
    );
    child.stdin?.on("error", (error) => console.warn(`pe-host tray pipe: ${String(error)}`));
    const exited = new Promise<void>((resolve) => {
      child.once("close", (code, signal) => {
        if (code !== 0) console.warn(`pe-host tray exited: ${code ?? signal}`);
        resolve();
        recover();
      });
    });
    current = { child, exited };
    await new Promise<void>((resolve, reject) => {
      child.once("spawn", resolve);
      child.once("error", reject);
      child.once("close", () => reject(Error("Tray exited before startup")));
    });
  };
  try {
    await launch();
  } catch (error) {
    stopping = true;
    if (recovery) clearTimeout(recovery);
    throw error;
  }
  return async () => {
    stopping = true;
    if (recovery) clearTimeout(recovery);
    const { child, exited } = current;
    child.stdin?.end();
    // A shim that does not dispose on EOF must not hold the host: the installer stub gives a
    // handed-off host 120 s to exit, and a successor's claim waits on this pid. Bounded, then killed.
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const timer = new Promise<"timeout">((resolve) => {
      timeout = setTimeout(() => resolve("timeout"), 5_000);
    });
    const outcome = await Promise.race([exited, timer]);
    clearTimeout(timeout);
    if (outcome === "timeout") {
      console.warn("pe-host tray did not exit on EOF within 5 s; killing it");
      child.kill();
      await exited;
    }
  };
}
