import { expect, test } from "vite-plus/test";
import type { Machine } from "@pe/agent-contracts";

import { MACHINE_SEEDS } from "#/open/seeds";

import { machineOf } from "./model";
import { updateStatus, type UpdateStatus } from "./update-state";

const seed = (name: keyof typeof MACHINE_SEEDS): Machine => machineOf(MACHINE_SEEDS[name])!;
const withUpdate = (machine: Machine, update: Partial<Machine["update"]>): Machine => ({
  ...machine,
  update: { ...machine.update, ...update },
});
const states = (machine: Machine, checking = false): UpdateStatus["state"] =>
  updateStatus(machine, checking).state;

test("an up-to-date or unread machine is idle, and a press in flight is checking", () => {
  const upToDate = seed("no-revit");
  expect(states(upToDate)).toBe("idle");
  expect(states(upToDate, true)).toBe("checking");
  expect(states(withUpdate(upToDate, { plan: null }))).toBe("idle");
  // A check that never answered and left no plan is the only idle that failed.
  const failed = updateStatus(
    withUpdate(upToDate, {
      plan: null,
      planLeg: { observedAtUtc: null, attemptedAtUtc: "t", error: "feed unavailable" },
    }),
    false,
  );
  expect(failed).toEqual({ state: "failed", during: "check", message: "feed unavailable" });
});

test("a newer version is available while something blocks it, ready when one press away", () => {
  expect(states(seed("blocked-plan"))).toBe("available");
  const ready = updateStatus(seed("waiting-plan"), false);
  expect(ready.state).toBe("ready");
  expect(ready.state === "ready" && ready.plan.latest).toBe("0.7.1");
  // Pressing Recheck on an available plan is still a check in flight.
  expect(states(seed("waiting-plan"), true)).toBe("checking");
});

test("an admitted apply is downloading until a later leg runs, then applying with that leg said", () => {
  const handoff = seed("receipt-handoff");
  const receipt = handoff.update.receipt!;
  const running = (legs: typeof receipt.legs) =>
    withUpdate(handoff, { receipt: { ...receipt, legs } });
  const leg = (name: string, status: string) => ({
    name,
    status,
    observedAtUtc: "2026-10-08T17:20:04.000Z",
    detail: null,
    exitCode: null,
  });
  expect(updateStatus(handoff, false)).toEqual({
    state: "applying",
    to: "0.7.1",
    leg: "handoff",
  });
  expect(states(running([]))).toBe("downloading");
  expect(states(running([leg("download", "running")]))).toBe("downloading");
  expect(states(running([leg("download", "ok"), leg("stop:2501", "running")]))).toBe("applying");
  // Consent admitted, the first receipt not yet read: the apply has begun with its download.
  const admitted = withUpdate(seed("waiting-plan"), {
    admittedPlanId: seed("waiting-plan").update.plan!.planId,
  });
  expect(states(admitted)).toBe("downloading");
});

test("a refused or failed apply stays failed with the last leg's words until a new plan waits", () => {
  const handoff = seed("receipt-handoff");
  const receipt = handoff.update.receipt!;
  const failedLeg = { ...receipt.legs[0]!, status: "failed", detail: "digest mismatch" };
  const failed = withUpdate(handoff, {
    receipt: { ...receipt, state: "failed", legs: [failedLeg] },
  });
  expect(updateStatus(failed, false)).toEqual({
    state: "failed",
    during: "apply",
    message: "digest mismatch",
  });
  const refused = withUpdate(handoff, { receipt: { ...receipt, state: "refused", legs: [] } });
  expect(updateStatus(refused, false)).toEqual({
    state: "failed",
    during: "apply",
    message: "The update was refused.",
  });
  // A different plan that waits on this person supersedes the old failure.
  const retry = withUpdate(failed, {
    plan: { ...seed("waiting-plan").update.plan!, planId: "plan-newer" },
  });
  expect(states(retry)).toBe("ready");
  expect(states(withUpdate(handoff, { receipt: { ...receipt, state: "ok" } }))).toBe("idle");
});
