import { expect, test, vi } from "vite-plus/test";

import { updateVerb } from "../src/update-route.ts";

vi.mock("../src/pe-revit-launch.ts", async (original) => ({
  ...(await original<typeof import("../src/pe-revit-launch.ts")>()),
  peRevitLauncher: () => ({ cmd: process.execPath, args: [] }),
}));

// A detached `update apply` prints its envelope at handoff and the installer stub keeps the stdout
// pipe open while it waits for this host to exit. The runner must resolve on the envelope, not on
// pipe close, or the host and the stub wait on each other (0.7.4 login update, 2026-10-09).
test("a detached run resolves on its envelope while the pipe stays open", async () => {
  const envelope = JSON.stringify({
    result: { state: "running", legs: [{ name: "handoff", status: "ok" }] },
    resolved: null,
    diagnostics: [],
    binary: { origin: "test" },
    command: { cwd: "x" },
    nextSteps: [],
    guide: "",
    related: [],
    exitCode: 4,
  });
  // The mocked launcher selects an owned Node child; the verb is a script that
  // prints the envelope handed to it and then holds the pipe open like the stub does.
  const started = Date.now();
  const result = await Promise.race([
    updateVerb(
      ["-e", "process.stdout.write(process.argv.at(-1)); setTimeout(() => {}, 4000)", envelope],
      true,
    ),
    new Promise<"slow">((resolve) => setTimeout(() => resolve("slow"), 3000)),
  ]);
  expect(result).not.toBe("slow");
  expect(Date.now() - started).toBeLessThan(3000);
});
