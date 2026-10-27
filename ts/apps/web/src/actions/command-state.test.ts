import { expect, test } from "vite-plus/test";
import { commandStateWord } from "./receipt";

test("recording a native step is queued evidence until the executor stamps dispatch", () => {
  const progress = {
    state: "running" as const,
    prepared: { state: "ready" as const, value: {} },
    steps: [
      {
        id: "step",
        key: "family.apply",
        kind: "native" as const,
        state: "running" as const,
        input: {},
      },
    ],
  };
  expect(commandStateWord(progress)).toBe("authorized and queued");
  expect(
    commandStateWord({
      ...progress,
      steps: [{ ...progress.steps[0]!, dispatchedAt: "2026-10-26T12:00:00Z" }],
    }),
  ).toBe("running");
  expect(commandStateWord({ ...progress, state: "waiting" })).toBe("waiting for turn consent");
  expect(commandStateWord({ ...progress, prepared: { state: "unprepared" } })).toBe("preparing");
});
