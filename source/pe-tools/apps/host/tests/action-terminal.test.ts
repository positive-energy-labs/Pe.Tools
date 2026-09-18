/**
 * One table over every terminal-state site of the action journal: completion (an executor returns or
 * throws), recovery (native receipts settle uncertain steps), and restart (a running row is reloaded).
 * Each step's effect answers with a chosen outcome; the executor keeps going after a step error so a
 * row can hold any mix of step states.
 */
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, expect, test } from "vite-plus/test";
import type { ActionReceipt, ActionStep } from "@pe/agent-contracts";
import { ActionIncomplete, ActionJournal } from "../src/action-journal.ts";
import { BridgeError } from "../src/bridge.ts";

type Outcome = "succeeded" | "failed" | "cancelled" | "unknown";
type End = "return" | "rethrow" | "incomplete" | "hostError";
type Terminal = { state: ActionReceipt["state"]; notDispatched: boolean };

const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});
async function journalPath() {
  const dir = await mkdtemp(join(tmpdir(), "pe-terminal-"));
  dirs.push(dir);
  return join(dir, "actions.json");
}
const admission = (id: string) => ({
  id,
  kind: "workflow" as const,
  key: "test.terminal",
  actor: "human" as const,
  destination: { kind: "host" as const },
  input: {},
  bases: {},
});
const answer = (outcome: Outcome) => {
  if (outcome === "succeeded") return { ok: true };
  if (outcome === "failed") throw new BridgeError("refused", 409, { notDispatched: true });
  if (outcome === "cancelled") throw new BridgeError("cancelled", 499);
  throw new BridgeError("reply lost", 503);
};
const terminal = (row: ActionReceipt): Terminal => ({
  state: row.state,
  notDispatched: "notDispatched" in row && row.notDispatched === true,
});

async function complete(steps: Outcome[], end: End, prepareFails = false) {
  const journal = new ActionJournal(await journalPath());
  const id = randomUUID();
  await journal.admit(
    admission(id),
    async () => {
      if (prepareFails) throw Error("preparation refused");
      return {};
    },
    async (execution) => {
      let last: unknown;
      for (const [index, outcome] of steps.entries())
        try {
          await execution.step("native", `step-${index}`, { index }, async () => answer(outcome));
        } catch (error) {
          last = error;
        }
      if (end === "return") return "done";
      if (end === "rethrow") throw last;
      if (end === "incomplete") throw new ActionIncomplete("partial", { partial: true });
      throw Error("host code failed");
    },
  );
  return journal.wait(id);
}

// Completion: steps (in order) and how the executor ends.
const completion: [Outcome[], End, Terminal][] = [
  [[], "return", { state: "succeeded", notDispatched: false }],
  [["succeeded"], "return", { state: "succeeded", notDispatched: false }],
  [["failed"], "return", { state: "succeeded", notDispatched: false }],
  [["failed"], "rethrow", { state: "failed", notDispatched: true }],
  [["cancelled"], "rethrow", { state: "cancelled", notDispatched: false }],
  [["unknown"], "rethrow", { state: "unknown", notDispatched: false }],
  [["succeeded", "failed"], "rethrow", { state: "incomplete", notDispatched: false }],
  [["succeeded", "cancelled"], "rethrow", { state: "cancelled", notDispatched: false }],
  [["succeeded", "unknown"], "rethrow", { state: "unknown", notDispatched: false }],
  [["succeeded"], "incomplete", { state: "incomplete", notDispatched: false }],
  [["succeeded", "unknown"], "incomplete", { state: "unknown", notDispatched: false }],
  // TODAY: an error in host code after a known effect reads as an uncertain effect.
  [["succeeded"], "hostError", { state: "unknown", notDispatched: false }],
  // TODAY: an error in host code before any step reads as uncertain although nothing dispatched.
  [[], "hostError", { state: "unknown", notDispatched: false }],
  [[], "incomplete", { state: "unknown", notDispatched: false }],
  // TODAY: a later refusal or cancel hides an earlier uncertain step.
  [["unknown", "failed"], "rethrow", { state: "failed", notDispatched: true }],
  [["unknown", "cancelled"], "rethrow", { state: "cancelled", notDispatched: false }],
  // TODAY: an executor that swallows an uncertain step still settles succeeded.
  [["unknown"], "return", { state: "succeeded", notDispatched: false }],
];
test.each(completion)("completion %j then %s", async (steps, end, expected) => {
  expect(terminal(await complete(steps, end))).toEqual(expected);
});
test("completion: a preparation that throws is failed and not dispatched", async () => {
  expect(terminal(await complete([], "return", true))).toEqual({
    state: "failed",
    notDispatched: true,
  });
});

// Recovery: an unknown row whose unknown steps the native receipt settles, in order.
const recovery: [Outcome[], Outcome[], Terminal | "throws"][] = [
  [["unknown"], ["unknown"], { state: "unknown", notDispatched: false }],
  [["unknown"], ["failed"], { state: "failed", notDispatched: true }],
  [["unknown"], ["cancelled"], { state: "cancelled", notDispatched: false }],
  // Recovery cannot know the executor finished after its effects; resume settles it.
  [["unknown"], ["succeeded"], { state: "unknown", notDispatched: false }],
  [["succeeded", "unknown"], ["succeeded"], { state: "unknown", notDispatched: false }],
  // TODAY: recover throws a ZodError. The completion copied nativeOutcome/issues/evidence onto the
  // unknown row, and the cancelled receipt schema admits none of them.
  [["succeeded", "unknown"], ["cancelled"], "throws"],
  // TODAY: a known effect followed by a proven refusal stays uncertain after recovery.
  [["succeeded", "unknown"], ["failed"], { state: "unknown", notDispatched: false }],
  [["unknown", "unknown"], ["failed", "cancelled"], { state: "cancelled", notDispatched: false }],
  [["unknown", "unknown"], ["failed", "failed"], { state: "failed", notDispatched: true }],
];
test.each(recovery)("recovery %j settled as %j", async (steps, settled, expected) => {
  const path = await journalPath();
  const journal = new ActionJournal(path);
  const id = randomUUID();
  await journal.admit(
    admission(id),
    async () => ({}),
    async (execution) => {
      let last: unknown;
      for (const [index, outcome] of steps.entries())
        try {
          await execution.step("native", `step-${index}`, { index }, async () => answer(outcome));
        } catch (error) {
          last = error;
        }
      throw last;
    },
  );
  expect((await journal.wait(id)).state).toBe("unknown");
  let next = 0;
  const recovering = journal.recover(id, async (step: ActionStep) => {
    const outcome = settled[next++]!;
    const base = { id: step.id, kind: step.kind, key: step.key, input: step.input };
    const settledStep: ActionStep =
      outcome === "succeeded"
        ? { ...base, state: "succeeded", result: { ok: true } }
        : outcome === "failed"
          ? { ...base, state: "failed", error: "refused", status: 409, notDispatched: true }
          : outcome === "cancelled"
            ? { ...base, state: "cancelled", error: "cancelled", status: 499 }
            : step;
    return { step: settledStep, evidence: { outcome } };
  });
  if (expected === "throws") await expect(recovering).rejects.toThrow();
  else expect(terminal(await recovering)).toEqual(expected);
});

// Restart: a row still running when the host stops, reloaded from disk.
async function restart(steps: ActionStep["state"][], prepared: boolean) {
  const path = await journalPath();
  const id = randomUUID();
  const row = {
    ...admission(id),
    request: {},
    steps: steps.map((state, index) => ({
      id: randomUUID(),
      kind: "native",
      key: `step-${index}`,
      input: { index },
      state,
      ...(state === "succeeded" ? { result: { ok: true } } : {}),
    })),
    preparation: prepared ? { state: "ready", value: {} } : { state: "unprepared" },
    recovery: [],
    publication: { state: "unrequested" },
    startedAt: new Date().toISOString(),
    state: "running",
  };
  delete (row as { input?: unknown }).input;
  await writeFile(path, JSON.stringify({ version: 3, actions: [row] }));
  const journal = new ActionJournal(path);
  const reloaded = (await journal.list(undefined, id))[0]!;
  expect(JSON.parse(await readFile(path, "utf8")).actions[0].state).toBe(reloaded.state);
  return reloaded;
}
const restarts: [ActionStep["state"][], boolean, Terminal][] = [
  [["running"], true, { state: "unknown", notDispatched: false }],
  [["succeeded", "running"], true, { state: "unknown", notDispatched: false }],
  // TODAY: a restart before any step, or between known steps, reads as uncertain.
  [[], true, { state: "unknown", notDispatched: false }],
  [["succeeded"], true, { state: "unknown", notDispatched: false }],
  // TODAY: a restart before preparation froze leaves an unknown row that recover and resume both refuse.
  [[], false, { state: "unknown", notDispatched: false }],
];
test.each(restarts)("restart with steps %j, prepared %s", async (steps, prepared, expected) => {
  expect(terminal(await restart(steps, prepared))).toEqual(expected);
});
