import { Effect } from "effect";
import { NodeServices } from "@effect/platform-node";
import { rhvacOpen } from "../src/rhvac-ops.ts";

/** Explicit real-Jet integration helper; the owning host supplies its existing platform layer. */
export const readRhvacFixture = (path: string) =>
  Effect.runPromise(rhvacOpen({ path }).pipe(Effect.provide(NodeServices.layer)));

export const originalProcess = {
  pid: 42,
  processStartUtc: "1970-01-01T00:00:01.0000000Z",
  executable: "C:/Revit.exe",
};
export const sdkEnvelope = (result: unknown) =>
  JSON.stringify({
    result,
    resolved: null,
    diagnostics: [],
    binary: {},
    command: {},
    nextSteps: [],
    guide: "op",
    related: [],
  });
export const sdkSessions = async () =>
  sdkEnvelope({ sessions: [{ case: "controlled-active", process: originalProcess }] });
