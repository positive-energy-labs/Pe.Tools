import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { Deferred, Effect, Layer, type Scope } from "effect";
import { capture } from "@pe/runtime";
import { hostProcessIdentity } from "@pe/host-contracts/contracts";
import { chooseServicePort } from "@pe/host-contracts/pe-service-host";
import { discoverService, serviceFilePath } from "@pe/host-contracts/pe-service";
import type { ServiceHostHandle } from "@pe/host-contracts/pe-service-host";
import { productRoot } from "@pe/host-contracts/service-identity";
import { resolveHostVersion } from "./host-lifecycle.ts";
import { makeHttpLive, resolveWebRoot } from "./app.ts";
import { hostCapabilities, hostOwnership } from "./host-ownership.ts";
import { updateWhenNoRevit } from "./update-route.ts";

const preferredPort = Number(new URL(hostProcessIdentity.defaultHostBaseUrl).port);

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
      // Desktop entry: a same-version host that already serves (started by Revit or an earlier
      // click) is the answer. Open it and exit; a second launch would otherwise evict it and drop
      // Revit's bridge. An older host (left running across an upgrade) is replaced as usual.
      const open = process.argv.includes("--open");
      if (open) {
        const live = yield* Effect.promise(() =>
          discoverService(productRoot(), hostOwnership.serviceName, { verifyOwner: true }),
        );
        if (live?.version === resolveHostVersion()) {
          console.log(`pe-host already serving on ${live.port} (pid ${live.pid}); opening it`);
          openBrowser(live.port);
          return;
        }
      }
      const port = yield* Effect.promise(() =>
        chooseServicePort(productRoot(), hostOwnership.serviceName, preferredPort),
      );

      const latch = yield* Deferred.make<void>();
      const handle = yield* Deferred.make<ServiceHostHandle>();
      const webUrl = web ? yield* Deferred.make<string>() : undefined;
      const HttpLive = makeHttpLive({
        port,
        webUrl,
        capabilities: hostCapabilities,
        lifecycle: {
          latch,
          handle,
          startTray: hostOwnership.lane === "installed" ? startInstalledTray : undefined,
        },
        webRoot: resolveWebRoot(),
      });

      yield* Effect.forkDetach(
        Deferred.await(latch).pipe(
          Effect.andThen(Effect.sync(() => setTimeout(() => process.exit(0), 5_000).unref())),
        ),
      );

      console.log(`pe-host binding http://127.0.0.1:${port || "dynamic"}`);
      if (open)
        // Open only once the claim holds, on the port the service file names.
        yield* Effect.forkDetach(
          Deferred.await(handle).pipe(
            Effect.tap((claimed) => Effect.sync(() => openBrowser(claimed.serviceFile.port))),
          ),
        );
      // A host nobody clicked (login, Revit) updates the machine when no Revit runs; a click asks in the app.
      else
        yield* Effect.forkDetach(
          Deferred.await(handle).pipe(
            Effect.andThen(Effect.promise(updateWhenNoRevit)),
            Effect.andThen((handedOff) =>
              handedOff ? Deferred.succeed(latch, undefined) : Effect.void,
            ),
          ),
        );
      const frontend =
        web && webUrl
          ? Effect.flatMap(Deferred.await(handle), (claimed) => web(claimed, webUrl))
          : Effect.never;
      yield* Effect.raceFirst(
        Effect.raceFirst(Layer.launch(HttpLive), frontend),
        Deferred.await(latch).pipe(Effect.tap(() => Effect.sync(() => onShutdown?.()))),
      );
    }),
  );

/** Claim-owned child: EOF asks the shim to dispose, and the finalizer awaits its actual exit. */
export async function startInstalledTray(handle: ServiceHostHandle): Promise<() => Promise<void>> {
  const child = spawn(
    join(dirname(hostOwnership.executablePath), "tray", "Pe.Host.Tray.exe"),
    [
      "--parent-pid",
      String(handle.serviceFile.pid),
      "--parent-start",
      handle.serviceFile.processStartUtc,
      "--service-file",
      serviceFilePath(productRoot(), hostOwnership.serviceName),
    ],
    { windowsHide: true, stdio: ["pipe", "ignore", "ignore"] },
  );
  child.stdin?.on("error", (error) => console.warn(`pe-host tray pipe: ${String(error)}`));
  const exited = new Promise<void>((resolve) => {
    child.once("close", (code, signal) => {
      if (code !== 0) console.warn(`pe-host tray exited: ${code ?? signal}`);
      resolve();
    });
  });
  await new Promise<void>((resolve, reject) => {
    child.once("spawn", resolve);
    child.once("error", reject);
  });
  return async () => {
    child.stdin?.end();
    await exited;
  };
}

/** Edge app mode is the desktop window (host ledger 2026-10-08): Edge ships with Windows, `--app`
 * drops the tabs and address bar, and the product's own profile keeps the window apart from the
 * user's browsing. The default browser is the fallback when Edge is absent. */
function openBrowser(port: number): void {
  const url = `http://127.0.0.1:${port}/`;
  const edge = [process.env["ProgramFiles(x86)"], process.env.ProgramFiles]
    .filter((root): root is string => root !== undefined)
    .map((root) => join(root, "Microsoft", "Edge", "Application", "msedge.exe"))
    .find((candidate) => existsSync(candidate));
  console.log(`pe-host opening ${url}${edge ? " in an Edge app window" : ""}`);
  // detached: on Windows a non-detached child dies with this process, and the reuse path exits at once.
  const [command, args] = edge
    ? [
        edge,
        [`--app=${url}`, `--user-data-dir=${join(productRoot(), "edge-app")}`, "--no-first-run"],
      ]
    : ["cmd.exe", ["/c", "start", "", url]];
  // windowsHide only for cmd: it passes SW_HIDE, which a GUI exe may apply to its first window.
  spawn(command, args, { detached: true, windowsHide: !edge, stdio: "ignore" }).unref();
}
