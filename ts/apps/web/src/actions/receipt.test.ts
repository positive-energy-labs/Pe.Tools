import { expect, test } from "vite-plus/test";
import { actionReceiptSchema, type ActionReceipt } from "@pe/agent-contracts";

import { actionOutcome, stateWord } from "./receipt";

const row = (kind: ActionReceipt["kind"], state: ActionReceipt["state"]) =>
  actionReceiptSchema.parse({
    id: "a1",
    key: "instances.open",
    kind,
    state,
    caller: { kind: "human", via: "local" },
    basis: { kind: "human" },
    destination: { kind: "host" },
    request: {},
    bases: {},
    steps: [],
    preparation: { state: "ready", value: {} },
    recovery: [],
    startedAt: "2026-10-14T04:00:00.000Z",
    publication: { state: "unrequested" },
    ...(state === "succeeded" || state === "incomplete" ? { result: {} } : {}),
    ...(state !== "running" && state !== "succeeded"
      ? { error: "native reply unavailable", status: 503 }
      : {}),
  });

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

test.each(["cancelled", "incomplete"] as const)(
  "a contract receipt that is %s stays advisory and names the original action",
  (state) => {
    expect(actionOutcome(row("operation", state))).toEqual({
      kind: "advisory",
      label: `instances.open ${state} · action a1`,
    });
  },
);
