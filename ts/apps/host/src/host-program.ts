import { createHash } from "node:crypto";
import { productPathNames } from "@pe/host-contracts/contracts";
import type { ReceiptStamp } from "@pe/agent-contracts";
import { HostInputContext } from "./input-context.ts";
import {
  nativeCatalogIdentity,
  openRecordingReader,
  openRecordingWriter,
  type HostInputLane,
} from "./native-recording.ts";
import { InvalidRead } from "./native-reads.ts";

import { linkedCatalog } from "@pe/agent-contracts/pe-api";
import { execFile, spawn } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { Context, Deferred, Effect, Layer, type Scope } from "effect";
import { ReceiptExport, admittedReceiptStamps, recordUpdateFact } from "./receipt-export.ts";
import { serviceFilePath, type ServiceFile } from "@pe/host-contracts/pe-service";
import type { ServiceHostHandle } from "@pe/host-contracts/pe-service-host";
import { openWindow, prepareHostBinding, resolveHostVersion } from "./host-lifecycle.ts";
import { makeHttpLive, resolveWebRoot } from "./app.ts";
import { hostCapabilities, hostOwnership } from "./host-ownership.ts";
import { trayOwnerArguments } from "@pe/host-contracts/service-identity";
import { makeInstalledUpdateReader } from "./update-route.ts";
import { ActionJournalService } from "./receipt-services.ts";
import { installedForeignAddins } from "./foreign-addins.ts";

export type HostInputSelection =
  | { readonly kind: "live"; readonly capture: "automatic" | "off" }
  | { readonly kind: "recording"; readonly directory: string; readonly at: string | null; readonly bindings?: ReadonlyMap<string, string> };

/** One exact process flag: --recording <directory>; all other host flags keep their existing owner. */
export const recordingInputSelection = (argv: readonly string[]): Effect.Effect<HostInputSelection | undefined, InvalidRead> => {
  const flags = argv.filter((arg) => arg.toLowerCase().startsWith("--recording"));
  if (!flags.length) return Effect.succeed(undefined);
  // Historical entry cannot inherit the live launcher's incumbent-eviction authority.
  if (argv.includes("--take-over-host"))
    return Effect.fail(new InvalidRead({ message: "Recording cannot take over another host", status: 400, problem: "recording.argument" }));
  const directory = argv[argv.indexOf("--recording") + 1];
  if (flags.length !== 1 || flags[0] !== "--recording" || !directory?.trim() || directory.startsWith("-") || directory.includes("\0"))
    return Effect.fail(new InvalidRead({ message: "Use --recording <directory> exactly once", status: 400, problem: "recording.argument" }));
  return Effect.try({
    try: (): HostInputSelection => ({ kind: "recording", directory: resolve(directory), at: null }),
    catch: () => new InvalidRead({ message: "Invalid --recording directory", status: 400, problem: "recording.argument" }),
  });
};

/** Identity comes from the already admitted artifact stamp, never current HEAD or a path. */
export const hostInputs = (stamp: ReceiptStamp | null, selection: HostInputSelection) => Effect.gen(function* () {
  if (selection.kind === "live" && selection.capture === "off")
    return yield* HostInputContext.pipe(Effect.provide(HostInputContext.layer({ kind: "live" })));
  if (!stamp) return yield* new InvalidRead({ message: "Recording requires an admitted host build", status: 409, problem: "recording.identity" });
  const identity = { build: JSON.stringify({ version: stamp.version, build: stamp.build, commit: stamp.commit }), catalog: nativeCatalogIdentity() };
  const bounds = { maxBytes: 256 * 1024 * 1024, maxTakings: 10_000 };
  if (selection.kind === "recording") {
    if (selection.at !== null) return yield* new InvalidRead({ message: "Timeline recording points are not available yet", status: 409, problem: "recording.point" });
    const reader = yield* openRecordingReader(selection.directory, identity, bounds);
    return yield* HostInputContext.pipe(Effect.provide(HostInputContext.layer({ kind: "recording", recordingStore: reader, at: null, bindings: selection.bindings && new Map(selection.bindings) })));
  }
  const directory = join(hostOwnership.rootPath, productPathNames.stateDirectoryName, "recordings", createHash("sha256").update(identity.build).digest("hex"), identity.catalog, hostOwnership.serviceName, "history");
  // Automatic capture is ancillary to live input: a store that cannot open (full or I/O) stops
  // recording before its first taking, not the host. Identity and tamper problems stay strict.
  const lane = yield* openRecordingWriter(directory, identity, bounds).pipe(
    Effect.map((writer): HostInputLane => ({ kind: "live", captureStore: writer })),
    Effect.catch((error) =>
      error.problem === "recording.full" || error.problem === "recording.io"
        ? Effect.succeed<HostInputLane>({ kind: "live", captureSetup: { at: 1, stoppedAt: Date.now(), reason: "setup", site: "builtin", op: "capture.setup" } })
        : Effect.fail(error),
    ),
  );
  return yield* HostInputContext.pipe(Effect.provide(HostInputContext.layer(lane)));
});
/** The shared host lifecycle used by both installed startup and source web development. */
export const hostProgram = (
  web?: (
    handle: ServiceHostHandle,
    ready: Deferred.Deferred<string>,
  ) => Effect.Effect<never, Error, Scope.Scope>,
  onShutdown?: () => void,
  inputSelection: HostInputSelection = { kind: "live", capture: "automatic" },
) =>
  Effect.scoped(
    Effect.gen(function* () {
      linkedCatalog();
      // One exporter for the launch: its scope unbinds the native producers and drains pending sends.
      const stamps = admittedReceiptStamps();
      const inputs = yield* hostInputs(stamps.host, inputSelection);
      const receipts = yield* Layer.build(ActionJournalService.live(stamps.host));
      Context.get(receipts, ActionJournalService).bindInputContext(inputs);
      const telemetry = Context.get(
        yield* Layer.build(
          ReceiptExport.layer(stamps).pipe(Layer.provide(Layer.succeedContext(receipts))),
        ),
        ReceiptExport,
      );
      yield* Effect.promise(() =>
        telemetry.record({
          kind: "usage",
          event: "app_boot",
          counters: inputs.lane.kind === "live" && hostOwnership.lane === "installed" ? installedForeignAddins() : {},
        }),
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
      // A historical launch never reuses or retires an incumbent with an unknown input graph.
      // It requests its own ephemeral listener; the existing service claim still refuses another owner.
      const binding = inputs.lane.kind === "live"
        ? yield* Effect.promise(() => prepareHostBinding(open, resolveHostVersion()))
        : 0;
      if (typeof binding !== "number") {
        yield* Effect.promise(() => reuse(binding));
        return;
      }
      const port = binding;

      const latch = yield* Deferred.make<void>();
      const handle = yield* Deferred.make<ServiceHostHandle>();
      const webUrl = web && inputs.lane.kind === "live" ? yield* Deferred.make<string>() : undefined;
      // The update reader's handoff is a Promise-world callback: it only settles this signal, and
      // the fiber below sleeps and settles the latch, so the exit is owned by the launch scope.
      const handoff = yield* Deferred.make<void>();
      const updateReader = inputs.lane.kind === "live" ? makeInstalledUpdateReader(
        (fact) => recordUpdateFact(telemetry, fact),
        () => void Deferred.doneUnsafe(handoff, Effect.void),
      ) : undefined;
      yield* Effect.forkScoped(
        Deferred.await(handoff).pipe(
          // Let the POST/receipt frame flush before the launch scope tears the server down.
          Effect.andThen(Effect.sleep("1 second")),
          Effect.andThen(Deferred.succeed(latch, undefined)),
        ),
      );
      const HttpLive = makeHttpLive({
        inputs,
        port,
        webUrl,
        capabilities: hostCapabilities,
        lifecycle: {
          latch,
          handle,
          startTray:
            inputs.lane.kind === "live" && hostOwnership.lane === "installed"
              ? (handle) => startInstalledTray(handle, showTray)
              : undefined,
        },
        updateReader,
        receipts: telemetry,
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
            Effect.provideContext(receipts),
            Effect.catchTag("ServeError", (error) => {
              const cause = error.cause;
              if (
                inputs.lane.kind !== "live" ||
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
    ...trayOwnerArguments(hostOwnership),
    "--parent-pid",
    String(file.pid),
    "--parent-start",
    file.processStartUtc,
    "--service-file",
    serviceFilePath(hostOwnership.rootPath, hostOwnership.serviceName),
    ...(show ? ["--show"] : []),
  ];
}

/** Claim-owned child: EOF asks the shim to dispose, and the finalizer awaits its actual exit. */
async function startInstalledTray(
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
