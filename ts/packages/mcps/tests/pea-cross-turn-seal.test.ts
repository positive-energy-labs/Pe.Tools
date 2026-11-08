import { expect, test, vi } from "vite-plus/test";
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
  const pending = f.command("apply", next.token);
  // A refusal must fail immediately, rather than looking like a stalled consent window.
  await vi.waitFor(async () => {
    const receipt = (await f.owner().list()).find((row) => row.id === "apply");
    if (receipt?.state === "failed") throw Error(JSON.stringify(receipt));
    expect(f.runs.commandWindow("apply")).toBeDefined();
  });
  f.runs.decide(next.run.thread, f.runs.commandWindow("apply")!.requestId, "allow_now");
  const applied = await pending;
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
test("R7 Schedule HTTP applies atomically reserve one Plan while consent waits", async () => {
  const f = await fixture();
  const turn = f.newTurn("exclusive-schedule");
  expect(await f.command("exclusive-plan", turn.token, true)).toMatchObject({ state: "succeeded" });
  const before = f.sent.length;
  const first = f.command("first-apply", turn.token);
  let second: ReturnType<typeof f.command> | undefined;
  try {
    await vi.waitFor(() => expect(f.runs.commandWindow("first-apply")).toBeDefined());
    second = f.command("second-apply", turn.token);
    await vi.waitFor(async () =>
      expect((await f.owner().list()).find((row) => row.id === "second-apply")).toBeDefined(),
    );
    const rows = (await f.owner().list()).filter((row) =>
      ["first-apply", "second-apply"].includes(row.id),
    );
    expect(rows.filter((row) => row.refusal?.kind === "claimed")).toHaveLength(1);
    expect(rows.find((row) => row.id === "second-apply")).toMatchObject({
      state: "failed",
      notDispatched: true,
      steps: [],
      refusal: {
        kind: "claimed",
        by: "first-apply",
        claim: { kind: "receipt", id: "exclusive-plan" },
      },
    });
    expect(f.sent.slice(before)).toEqual([]);
    expect(f.sent.filter((call) => call.key === "schedule.cells.apply")).toHaveLength(0);
    f.runs.decide(turn.run.thread, f.runs.commandWindow("first-apply")!.requestId, "allow_now");
    expect(await first).toMatchObject({ state: "succeeded", result: { applied: 1 } });
    expect(await second).toMatchObject({ state: "failed", refusal: { kind: "claimed" } });
    expect(f.sent.filter((call) => call.key === "schedule.cells.apply")).toHaveLength(1);
  } finally {
    f.runs.closeAll();
    await Promise.allSettled([first, ...(second ? [second] : [])]);
  }
});
