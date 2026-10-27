import { z } from "zod";
import { win32 } from "node:path";
import { sdkInstallationSchema, type Caller, type Consumed } from "@pe/agent-contracts";
import { bootstrapAlignmentSchema, bootstrapBlockers } from "@pe/host-contracts/pe-api";
import {
  GENERATED_FROM,
  bootstrapInstallArgv,
  bootstrapVerifyArgv,
  sessionListArgv,
  type BootstrapResult,
  type SessionListResult,
} from "@pe/host-contracts/pe-revit-contract";
import type { ActionJournal } from "./action-journal.ts";
import { command, refused } from "./command-executor.ts";
import { requireHuman } from "./control.ts";
import type { SdkReceiptReader } from "./native-receipts.ts";
import { readSdk, runSdk, sdkEnvelope } from "./sdk-dispatch.ts";

const readBootstrapSdk: SdkReceiptReader = (args) => readSdk(args, "2 minutes");

/** The SDK owns its installation directory; never reproduce its filenames or infer a destination. */
export async function readBootstrapInstallation(year: string, read = readBootstrapSdk) {
  const observed = await sdkEnvelope<BootstrapResult>(bootstrapVerifyArgv({ year }), read);
  if (observed.binary.informationalVersion?.split("+")[0] !== GENERATED_FROM)
    throw refused(
      `The answering SDK is not this host's pinned ${GENERATED_FROM}; installation refused.`,
    );
  const result = observed.result;
  const action = result?.actions?.[0];
  if (
    ![0, 3].includes(observed.exitCode) ||
    observed.diagnostics.length ||
    result?.verb !== "verify" ||
    result.years.length !== 1 ||
    result.years[0] !== year ||
    result.actions.length !== 1 ||
    action?.year !== year ||
    action.op !== "check" ||
    !["ok", "missing", "differs"].includes(action.status) ||
    !win32.isAbsolute(action.dest) ||
    !win32.isAbsolute(result.addinsBase)
  )
    throw refused(
      "The SDK's exact bootstrap installation destination is unavailable; installation refused.",
    );
  const directory = win32.dirname(action.dest);
  if (
    win32.basename(directory) !== year ||
    win32.normalize(win32.dirname(directory)).toLowerCase() !==
      win32.normalize(result.addinsBase).toLowerCase()
  )
    throw refused(
      "The SDK bootstrap installation destination does not match the chosen year; installation refused.",
    );
  return sdkInstallationSchema.parse({
    year,
    directory,
    image: {
      assembly: observed.binary.assembly,
      sha256: observed.binary.sha256,
      version: observed.binary.informationalVersion,
    },
  });
}

export async function readBootstrapIdle(read = readBootstrapSdk): Promise<true> {
  const census = await sdkEnvelope<SessionListResult>(sessionListArgv({ all: true }), read);
  if (
    census.exitCode !== 0 ||
    census.diagnostics.length ||
    census.result.processReadErrors.length ||
    census.result.unreadableReceipts.length
  )
    throw refused("The complete Revit census is unavailable; installation refused.");
  const open = bootstrapBlockers(census.result.sessions);
  if (open.length) throw refused(`Close every Revit before aligning add-ins: ${open.join("; ")}.`);
  return true;
}

const preparedBootstrap = z.strictObject({
  year: z.string(),
  sdkVersion: z.literal(GENERATED_FROM),
  installation: sdkInstallationSchema,
});
/** The engine re-reads both typed probes at the final checkpoint; the domain does not compare them. */
export const bootstrapExecutor = (read = readBootstrapSdk) =>
  command(
    {
      says: "Align Revit add-ins with this build",
      needs: "nothing",
      principal: ["human"],
      effect: "command",
      dirties: [],
      input: bootstrapAlignmentSchema,
    },
    preparedBootstrap,
    {
      bind: async ({ admission: { input } }) => {
        if (input.confirmedVersion !== GENERATED_FROM)
          throw refused(
            `Confirm this host's pinned SDK ${GENERATED_FROM}, not ${input.confirmedVersion}.`,
          );
        const installation = await readBootstrapInstallation(input.year, read);
        await readBootstrapIdle(read);
        const consumes: Consumed[] = [
          { kind: "sdk-installation", probe: { year: input.year }, expected: installation },
          { kind: "sdk-idle", probe: {}, expected: true },
        ];
        return {
          effects: [{ kind: "directory", path: installation.directory }],
          consumes,
          prepare: async () => ({ year: input.year, sdkVersion: GENERATED_FROM, installation }),
        };
      },
      run: async (_context, execution) => {
        const { year, sdkVersion } = execution.prepared;
        const installed = await runSdk(
          execution,
          "machine.bootstrap.install",
          { argv: bootstrapInstallArgv({ year }) },
          read,
        );
        const verified = await runSdk(
          execution,
          "machine.bootstrap.verify",
          { argv: bootstrapVerifyArgv({ year }) },
          read,
          {
            check: (envelope) => {
              const result = (envelope as { result: BootstrapResult }).result;
              if (
                result.years.length !== 1 ||
                result.years[0] !== year ||
                !result.actions.length ||
                result.actions.some((action) => action.year !== year || action.status !== "ok")
              )
                throw refused("Bootstrap verification failed; inspect the SDK envelope.");
            },
          },
        );
        return { year, sdkVersion, installed, verified };
      },
    },
  );

export async function alignBootstrap(raw: unknown, caller: Caller, owner: ActionJournal) {
  requireHuman(caller, "/pe/machine/bootstrap", "Align Revit add-ins with this build");
  const input = bootstrapAlignmentSchema.parse(raw);
  const admitted = await owner.invoke(
    { id: input.id, key: "machine.bootstrap", target: { kind: "host" }, input },
    { caller, basis: { kind: "human" } },
  );
  return owner.wait(admitted.id);
}
