import { expect, test } from "vite-plus/test";
import { setup } from "../../../apps/host/tests/schedule-test-fixture.ts";
import { peaTurns } from "./pea-turn.fixture.ts";

async function fixture() {
  const f = await setup();
  const turns = peaTurns();
  const work = { key: f.scope, revision: (await f.view()).revision };
  const command = async (id: string, token: string | undefined, preview = false) => {
    const response = await fetch(`${f.base}/actions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-pe-context": token ?? process.env.PE_CONTEXT!,
      },
      body: JSON.stringify({
        id,
        key: preview ? "schedule.grid.push.preview" : "schedule.grid.push",
        target: { kind: "document", ref: f.b },
        input: { work },
      }),
    });
    const body = await response.json();
    return response.ok ? f.owner().wait(id) : body;
  };
  return { ...f, ...turns, command };
}

test("same Pea thread plans in N and applies in a freshly minted N+1", async () => {
  const f = await fixture();
  const first = f.newTurn("reviewed");
  const plan = await f.command("plan", first.token, true);
  expect(plan, JSON.stringify(plan)).toMatchObject({ state: "succeeded" });
  const next = f.newTurn("reviewed");
  expect(next.run.turn).not.toBe(first.run.turn);
  expect(next.token).not.toBe(first.token);
  // No window stands between a reviewed Plan and its Apply (ADR 0038): the next turn applies at once.
  const applied = await f.command("apply", next.token);
  expect(applied, JSON.stringify(applied)).toMatchObject({
    state: "succeeded",
    result: { applied: 1 },
  });
  expect(applied.caller.context).not.toBe(plan.caller.context);
  expect(applied.caller.run).toEqual(next.run);
  expect(f.sent.filter((s) => s.key === "schedule.cells.apply")).toHaveLength(1);
  expect((await f.view()).doc.cells["1::2"].edit).toBeNull();
});

test.each(["foreign", "delegated", "human-to-pea", "pea-to-human"] as const)(
  "%s cannot apply another principal's plan over HTTP",
  async (mode) => {
    const f = await fixture();
    const parent = f.newTurn("parent");
    const plan = await f.command("plan", mode === "human-to-pea" ? undefined : parent.token, true);
    expect(plan, JSON.stringify(plan)).toMatchObject({ state: "succeeded" });
    const applyToken =
      mode === "pea-to-human"
        ? undefined
        : mode === "human-to-pea"
          ? parent.token
          : f.newTurn("other", mode === "delegated" ? parent.run : undefined).token;
    const refused = await f.command("apply", applyToken);
    expect(refused, JSON.stringify(refused)).toMatchObject({
      state: "failed",
      refusal: { code: "preview.caller" },
    });
    expect(f.sent.filter((s) => s.key === "schedule.cells.apply")).toHaveLength(0);
  },
);

test("closed old turn stays refused after a new turn opens", async () => {
  const f = await fixture();
  const old = f.newTurn("reviewed");
  expect(await f.command("plan", old.token, true)).toMatchObject({ state: "succeeded" });
  f.newTurn("reviewed");
  const refused = await f.command("late-apply", old.token);
  expect(JSON.stringify(refused)).toContain("run.closed");
  expect(f.sent.filter((s) => s.key === "schedule.cells.apply")).toHaveLength(0);
});

// Port of R7 from d65a96e7:ts/apps/host/tests/kernel-write-safety.journey.test.ts.
test("R7 Schedule HTTP applies atomically reserve one Plan", async () => {
  const f = await fixture();
  const turn = f.newTurn("exclusive-schedule");
  expect(await f.command("exclusive-plan", turn.token, true)).toMatchObject({ state: "succeeded" });
  const rows = await Promise.all([
    f.command("first-apply", turn.token),
    f.command("second-apply", turn.token),
  ]);
  expect(rows.map((row) => row.state).sort()).toEqual(["failed", "succeeded"]);
  expect(rows.find((row) => row.state === "failed")).toMatchObject({ notDispatched: true, steps: [] });
  expect(f.sent.filter((call) => call.key === "schedule.cells.apply")).toHaveLength(1);
});
