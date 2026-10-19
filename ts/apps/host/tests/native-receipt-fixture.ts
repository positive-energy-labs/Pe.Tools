import type { ObservedActive, Resolved } from "@pe/host-contracts/pe-revit-contract";
import { Effect } from "effect";
import { NodeServices } from "@effect/platform-node";
import { rhvacOpen } from "../src/rhvac-ops.ts";
import { hostOwnership } from "../src/host-ownership.ts";
import { replay, sdkBinary, sdkCommand } from "./sdk-replay.ts";

/** Explicit real-Jet integration helper; the owning host supplies its existing platform layer. */
export const readRhvacFixture = (path: string) =>
  Effect.runPromise(rhvacOpen({ path }).pipe(Effect.provide(NodeServices.layer)));

export const originalProcess = {
  pid: 42,
  processStartUtc: "1970-01-01T00:00:01.0000000Z",
  executable: "C:/Revit.exe",
};
export const sdkEnvelope = (result: unknown, resolved: Resolved | null = null) =>
  JSON.stringify({
    result,
    resolved,
    diagnostics: [],
    binary: sdkBinary,
    command: sdkCommand,
    nextSteps: [],
    guide: "op",
    related: [],
    exitCode: 0,
  });
const observedProcess: ObservedActive = {
  case: "observed-active",
  execution: null,
  process: originalProcess,
  bridge: { bridge: "missing-endpoint" },
  observedAtUtc: originalProcess.processStartUtc,
  shape: {
    payload: "installed",
    reload: "none",
    posture: "foreground",
    quarantine: false,
    purpose: "interactive",
  },
  year: 2025,
};
export const sdkResolved: Resolved = {
  payload: hostOwnership.lane === "dev" ? "checkout" : "installed",
  sourceRoot: hostOwnership.sourceRoot,
  installedRoot: null,
  pid: originalProcess.pid,
  processStartUtc: originalProcess.processStartUtc,
  id: null,
  how: null,
  buildStamp: null,
  observedAtUtc: originalProcess.processStartUtc,
  origin: null,
};
export const sdkSessions = async (args: readonly string[] = []) =>
  args[0] === "doc"
    ? replay("doc-list", {
        result: { documents: [] },
        resolved: {
          ...sdkResolved,
          pid: args.includes("--pid") ? Number(args[args.indexOf("--pid") + 1]) : 42,
        },
      })
    : replay("session-list", {
        result: {
          sessions: [
            observedProcess,
            { ...observedProcess, process: { ...originalProcess, pid: 43 } },
          ],
          registryRoot: "test",
          unreadableReceipts: [],
        },
      });
