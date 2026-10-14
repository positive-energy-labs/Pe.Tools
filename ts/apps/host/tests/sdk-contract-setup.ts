// Every host test: an envelope the host parses must have a shape the SDK was recorded sending.
import { afterEach, vi } from "vite-plus/test";

// Host code may swallow the refusal (a reader that catches, a retry loop); the test still fails here.
const drift = vi.hoisted(() => [] as string[]);

vi.mock("../src/pe-revit-launch.ts", async (load) => {
  const real = await load<typeof import("../src/pe-revit-launch.ts")>();
  const { recordedProblems: problemsOf } = await import("./sdk-replay.ts");
  const check = (args: readonly string[], stdout: string) => {
    const problems = problemsOf(args, stdout);
    if (!problems.length) return;
    const message = `Fake SDK envelope drifted from the recording:\n  ${problems.join("\n  ")}`;
    drift.push(message);
    throw new Error(message);
  };
  return {
    ...real,
    validatePeRevitEnvelope: (stdout: string, args: readonly string[], launch: never) => {
      const valid = real.validatePeRevitEnvelope(stdout, args, launch);
      check(args, valid);
      return valid;
    },
    parsePeRevitEnvelope: (stdout: string, args: readonly string[], launch: never) => {
      const envelope = real.parsePeRevitEnvelope(stdout, args, launch);
      check(args, stdout);
      return envelope;
    },
  };
});

afterEach(() => {
  if (drift.length) throw new Error([...new Set(drift.splice(0))].join("\n"));
});
