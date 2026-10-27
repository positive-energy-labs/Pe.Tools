import { Effect } from "effect";
import { z } from "zod";
import { NodeServices } from "@effect/platform-node";
import { win32 } from "node:path";
import { canonicalRouteInput, type Caller } from "@pe/agent-contracts";
import { bootstrapAlignmentSchema, bootstrapBlockers } from "@pe/host-contracts/pe-api";
import {
  GENERATED_FROM,
  bootstrapInstallArgv,
  bootstrapVerifyArgv,
  sessionListArgv,
  versionArgv,
  type BootstrapResult,
  type SessionListResult,
} from "@pe/host-contracts/pe-revit-contract";
import { ActionJournal } from "./action-journal.ts";
import { BridgeError } from "./bridge.ts";
import { requireHuman } from "./control.ts";
import { parsePeRevitEnvelope, peRevitLauncher } from "./pe-revit-launch.ts";
import { runPeRevitCli } from "./session-route.ts";
import type { SdkReceiptReader } from "./native-receipts.ts";

const readSdk: SdkReceiptReader = (args) =>
  Effect.runPromise(
    runPeRevitCli(args).pipe(Effect.provide(NodeServices.layer), Effect.timeout("2 minutes")),
  );
const refuse = (message: string) => new BridgeError(message, 409, { notDispatched: true });

/** Human confirmation is bound to the SDK image this host was built with, never PATH or latest. */
export const bootstrapExecutor =
  (read = readSdk): import("./command-executor.ts").CommandFactory =>
  (context) => {
    requireHuman(context.caller, "/pe/machine/bootstrap", "Align Revit add-ins with this build");
    const input = bootstrapAlignmentSchema.parse(context.admission.input);
    const envelope = async <T>(args: readonly string[]) =>
      parsePeRevitEnvelope<T>(await read(args), args, peRevitLauncher());
    if (input.confirmedVersion !== GENERATED_FROM)
      throw refuse(
        `Confirm this host's pinned SDK ${GENERATED_FROM}, not ${input.confirmedVersion}.`,
      );
    const installation = async () => {
      const observed = await envelope<BootstrapResult>(bootstrapVerifyArgv({ year: input.year }));
      if (observed.binary.informationalVersion?.split("+")[0] !== GENERATED_FROM)
        throw refuse(
          `The answering SDK is not this host's pinned ${GENERATED_FROM}; installation refused.`,
        );
      const result = observed.result;
      const action = result?.actions?.[0];
      if (
        ![0, 3].includes(observed.exitCode) ||
        observed.diagnostics.length ||
        result?.verb !== "verify" ||
        result.years.length !== 1 ||
        result.years[0] !== input.year ||
        result.actions.length !== 1 ||
        action?.year !== input.year ||
        action.op !== "check" ||
        !["ok", "missing", "differs"].includes(action.status) ||
        !win32.isAbsolute(action.dest) ||
        !win32.isAbsolute(result.addinsBase)
      )
        throw refuse(
          "The SDK's exact bootstrap installation destination is unavailable; installation refused.",
        );
      const directory = win32.dirname(action.dest);
      if (
        win32.basename(directory) !== input.year ||
        win32.normalize(win32.dirname(directory)).toLowerCase() !==
          win32.normalize(result.addinsBase).toLowerCase()
      )
        throw refuse(
          "The SDK bootstrap installation destination does not match the chosen year; installation refused.",
        );
      return { year: input.year, directory, binary: observed.binary };
    };
    // SDK bootstrap owns manifests, payloads and stale directories under its reported year root.
    // This human admin exception records that directory, never a copied list of SDK file names.
    const preflight = async () => {
      const binary = await envelope(versionArgv());
      if (
        binary.exitCode !== 0 ||
        binary.binary.informationalVersion?.split("+")[0] !== GENERATED_FROM
      )
        throw refuse(
          `The answering SDK is not this host's pinned ${GENERATED_FROM}; installation refused.`,
        );
      const census = await envelope<SessionListResult>(sessionListArgv({ all: true }));
      if (
        census.exitCode !== 0 ||
        census.diagnostics.length ||
        census.result.processReadErrors.length ||
        census.result.unreadableReceipts.length
      )
        throw refuse("The complete Revit census is unavailable; installation refused.");
      const open = bootstrapBlockers(census.result.sessions);
      if (open.length)
        throw refuse(`Close every Revit before aligning add-ins: ${open.join("; ")}.`);
    };
    let frozen: Awaited<ReturnType<typeof installation>>;
    return {
      definition: {
        says: "Align Revit add-ins with this build",
        needs: "nothing",
        effect: "command",
        dirties: [],
        input: bootstrapAlignmentSchema,
      },
      bind: async () => {
        frozen = await installation();
        return { effects: [{ kind: "directory", path: frozen.directory }] };
      },
      prepared: z.strictObject({
        year: z.string(),
        sdkVersion: z.string(),
        installation: z.object({ year: z.string(), directory: z.string(), binary: z.unknown() }),
      }),
      prepare: async () => {
        await preflight();
        return { year: input.year, sdkVersion: GENERATED_FROM, installation: frozen };
      },
      run: async (_context, execution) => {
        const frozen = (
          execution.prepared as { installation: Awaited<ReturnType<typeof installation>> }
        ).installation;
        const installed = await execution.step(
          "native",
          "machine.bootstrap.install",
          {
            argv: bootstrapInstallArgv({ year: input.year }),
            sdkVersion: GENERATED_FROM,
          },
          async () => {
            await preflight();
            if (canonicalRouteInput(await installation()) !== canonicalRouteInput(frozen))
              throw refuse(
                "The SDK bootstrap installation image or destination changed; submit a new command.",
              );
            const result = await envelope<BootstrapResult>(
              bootstrapInstallArgv({ year: input.year }),
            );
            if (result.exitCode !== 0 || !result.result.ok || result.diagnostics.length)
              throw new BridgeError(
                "Bootstrap installation did not complete; inspect the SDK envelope.",
                502,
                { dispatched: true, result },
              );
            return result;
          },
        );
        const verified = await execution.step(
          "native",
          "machine.bootstrap.verify",
          { argv: bootstrapVerifyArgv({ year: input.year }) },
          async () => {
            const result = await envelope<BootstrapResult>(
              bootstrapVerifyArgv({ year: input.year }),
            );
            if (
              result.exitCode !== 0 ||
              !result.result.ok ||
              result.diagnostics.length ||
              result.result.years.length !== 1 ||
              result.result.years[0] !== input.year ||
              !result.result.actions.length ||
              result.result.actions.some(
                (action) => action.year !== input.year || action.status !== "ok",
              )
            )
              throw new BridgeError(
                "Bootstrap verification failed; inspect the SDK envelope.",
                502,
                {
                  dispatched: true,
                  result,
                },
              );
            return result;
          },
        );
        return { year: input.year, sdkVersion: GENERATED_FROM, installed, verified };
      },
    };
  };

export async function alignBootstrap(
  raw: unknown,
  caller: Caller,
  owner: ActionJournal,
  read = readSdk,
) {
  requireHuman(caller, "/pe/machine/bootstrap", "Align Revit add-ins with this build");
  const input = bootstrapAlignmentSchema.parse(raw);
  const admitted = await owner.invoke(
    { id: input.id, key: "machine.bootstrap", target: { kind: "host" }, input },
    { caller, basis: { kind: "human" } },
    bootstrapExecutor(read),
  );
  return owner.wait(admitted.id);
}
