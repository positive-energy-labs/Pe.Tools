import { expect, test, vi } from "vite-plus/test";
import { POLL_PERIOD_MS, machineForRead } from "../src/machine.ts";

const at = (ms: number) => new Date(ms).toISOString();
const machine = (observedAtUtc: string | null) =>
  ({ legs: observedAtUtc ? { sessions: { observedAtUtc, attemptedAtUtc: observedAtUtc, error: null } } : {} }) as never;
const now = Date.parse("2026-11-10T08:00:00.000Z");

test("a catalog read reuses a census younger than one poll period and starts no pass", async () => {
  const held = machine(at(now - POLL_PERIOD_MS + 1));
  const refresh = vi.fn(async () => machine(at(now)));
  expect(await machineForRead(held, refresh, now)).toBe(held);
  expect(refresh).not.toHaveBeenCalled();
});

test("an older census, or one that never read its sessions, is refreshed as before", async () => {
  const refresh = vi.fn(async () => machine(at(now)));
  await machineForRead(machine(at(now - POLL_PERIOD_MS)), refresh, now);
  await machineForRead(machine(null), refresh, now);
  expect(refresh).toHaveBeenCalledTimes(2);
});
