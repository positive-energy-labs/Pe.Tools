import { Effect } from "effect";
import { NodeServices } from "@effect/platform-node";
import type { Caller } from "@pe/agent-contracts";
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
export async function alignBootstrap(
  raw: unknown,
  caller: Caller,
  owner: ActionJournal,
  read = readSdk,
) {
  requireHuman(caller, "/pe/machine/bootstrap", "Align Revit add-ins with this build");
  const input = bootstrapAlignmentSchema.parse(raw);
  if (input.confirmedVersion !== GENERATED_FROM)
    throw refuse(
      `Confirm this host's pinned SDK ${GENERATED_FROM}, not ${input.confirmedVersion}.`,
    );
  const envelope = async <T>(args: readonly string[]) =>
    parsePeRevitEnvelope<T>(await read(args), args, peRevitLauncher());
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
    if (open.length) throw refuse(`Close every Revit before aligning add-ins: ${open.join("; ")}.`);
  };
  const admitted = await owner.admit(
    {
      id: input.id,
      kind: "workflow",
      key: "machine.bootstrap",
      caller,
      basis: { kind: "human" },
      destination: { kind: "host" },
      input,
      bases: {},
    },
    async () => {
      await preflight();
      return { year: input.year, sdkVersion: GENERATED_FROM };
    },
    async (execution) => {
      const installed = await execution.step(
        "native",
        "machine.bootstrap.install",
        {
          argv: bootstrapInstallArgv({ year: input.year }),
          sdkVersion: GENERATED_FROM,
        },
        async () => {
          await preflight();
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
          const result = await envelope<BootstrapResult>(bootstrapVerifyArgv({ year: input.year }));
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
            throw new BridgeError("Bootstrap verification failed; inspect the SDK envelope.", 502, {
              dispatched: true,
              result,
            });
          return result;
        },
      );
      return { year: input.year, sdkVersion: GENERATED_FROM, installed, verified };
    },
  );
  return owner.wait(admitted.id);
}
