import { expect, test } from "vite-plus/test";

import { actionOutcome, stateWord } from "./receipt";

const row = (kind: "operation" | "workflow", state: string) =>
  ({ id: "a1", key: "instances.open", kind, state }) as never;

test("one projection: an operation's success is a reply received, never a certified mutation", () => {
  expect(stateWord(row("operation", "succeeded"))).toBe("reply received");
  expect(stateWord(row("workflow", "succeeded"))).toBe("succeeded");
  expect(actionOutcome(row("operation", "succeeded"))).toEqual({
    kind: "receipt",
    label: "instances.open reply received · action a1",
  });
  expect(actionOutcome(row("operation", "running")).kind).toBe("busy");
  expect(actionOutcome(row("operation", "unknown")).kind).toBe("advisory");
  expect(actionOutcome(row("workflow", "failed")).kind).toBe("error");
});
