import { mkdtemp, stateFixture } from "../../../tests/isolated-home/storage.ts";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Context, Effect, Exit, Layer, Scope } from "effect";
import { expect, test } from "vite-plus/test";
import { z } from "zod";
import {
  persistedActionReceiptSchema,
  persistedReceiptSchema,
  type Claim,
} from "@pe/agent-contracts";
import { command } from "@pe/host-internal/command-executor";
import { ActionJournalService } from "../src/receipt-services.ts";
import { settle } from "./effect-test.ts";

// K1c option B: only a running action holds a claim. A running launch still refuses a rival
// (journal-open-means-running.test.ts, "a running action still ... holds its claim"). Rows are
// synthetic, shaped like drive1 case 4: launch f5a57ec9 (Revit 53292) and journaled stop 35493ce7.
const slot: Claim = { kind: "session-slot", selector: { year: "2025", selection: {} } };
const human = { kind: "human" as const, via: "cli" as const };
const launch = {
  id: "launch",
  key: "instances.start",
  state: "succeeded",
  result: null,
  startedAt: "2026-11-18T09:11:00Z",
  effects: [
    { kind: "session", session: "new:launch" },
    { kind: "session", session: "53292:2026-11-18T09:11:25.4947946Z" },
  ],
  claims: [slot],
  steps: [
    {
      id: "s1",
      key: "instances.start",
      kind: "native",
      input: {},
      transport: "sdk",
      state: "succeeded",
      result: {},
      dispatchedAt: "2026-11-18T09:11:01Z",
    },
  ],
};
// Written before K1c: a stop step that recorded `releases` for the launch's slot.
const stop = {
  id: "stop",
  key: "instances.stop",
  state: "succeeded",
  result: null,
  startedAt: "2026-11-18T09:12:00Z",
  effects: [],
  claims: [],
  steps: [
    {
      id: "s2",
      key: "instances.stop",
      kind: "native",
      input: {},
      transport: "sdk",
      state: "succeeded",
      result: {},
      dispatchedAt: "2026-11-18T09:12:01Z",
      releases: [{ action: "launch", claim: slot }],
    },
  ],
};

async function journalFile(rows: object[]) {
  const dir = await mkdtemp(join(tmpdir(), "pe-running-only-"));
  const uuid = (n: number) => `40000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  const lines: object[] = [{ version: 8 }];
  rows.forEach((row, i) => {
    const value = persistedActionReceiptSchema.parse({
      target: { kind: "host" },
      input: {},
      caller: human,
      basis: null,
      prepared: { state: "unprepared" },
      recovery: [],
      ...row,
    });
    lines.push(
      { mapping: [JSON.stringify(["action", value.id]), uuid(i * 3 + 1)] },
      { mapping: [JSON.stringify(["action-request", value.id]), uuid(i * 3 + 2)] },
      {
        receipt: persistedReceiptSchema.parse({
          schema: 1,
          id: uuid(i * 3 + 3),
          revision: 1,
          at: value.startedAt,
          stamp: null,
          join: { actionId: uuid(i * 3 + 1), requestId: uuid(i * 3 + 2) },
          body: { kind: "action", value },
        }),
      },
    );
  });
  await writeFile(
    join(dir, "partition-operations.json"),
    lines.map((line) => JSON.stringify(line)).join("\n") + "\n",
  );
  return dir;
}

async function journalAt(dir: string) {
  const host = Scope.makeUnsafe();
  const journal = Context.get(
    await settle(Layer.buildWithScope(ActionJournalService.live(null, stateFixture(dir)), host)),
    ActionJournalService,
  );
  const ran: string[] = [];
  journal.bindCommands({
    probe: async () => null,
    resolve: () =>
      command(
        {
          says: "Claim the 2025 slot",
          needs: "nothing",
          effect: "command",
          dirties: [],
          input: z.record(z.string(), z.unknown()),
        },
        z.null(),
        {
          bind: async () => ({ effects: [], claims: [slot] }),
          run: (ctx) => Effect.sync(() => ran.push(ctx.admission.id)).pipe(Effect.as(null)),
        },
      ),
  });
  const start = (id: string) =>
    journal
      .invoke(
        { id, key: "scripting.execute", target: { kind: "host" }, input: {} },
        { caller: human, basis: null },
      )
      .then(
        (admitted) => journal.wait(admitted.id),
        (error: unknown) => error,
      );
  return { journal, start, ran, close: () => settle(Scope.close(host, Exit.void)) };
}

test("case 4(b): a succeeded launch whose Revit ended outside the host holds no claim, before and after a reload", async () => {
  const dir = await journalFile([launch]);
  for (const id of ["second", "after-reload"]) {
    const f = await journalAt(dir);
    try {
      expect(await f.start(id)).toMatchObject({ state: "succeeded" });
      expect(f.ran).toEqual([id]);
    } finally {
      await f.close();
    }
  }
});

test("a journal written before K1c, with `releases` on a step, still loads and keeps it", async () => {
  const f = await journalAt(await journalFile([launch, stop]));
  try {
    expect((await f.journal.list(undefined, "stop"))[0]?.steps[0]).toMatchObject({
      releases: [{ action: "launch", claim: slot }],
    });
    expect(await f.start("second")).toMatchObject({ state: "succeeded" });
  } finally {
    await f.close();
  }
});
