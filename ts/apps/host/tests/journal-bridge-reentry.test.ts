import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";
import { ActionJournal } from "../src/action-journal.ts";
import type { CommandExecutor } from "../src/command-executor.ts";
import { fixtureCommand, invokeFixtureCommand } from "./command-fixture.ts";

// The bridge journals a `queue` receipt before every dispatch (bridge.ts `recordBridgeQueue`), and
// dispatch evidence for an owned step (`markDispatched`). An admission that awaits the bridge while
// holding the journal's write lock waits on itself: the 4f3b0d24 cold-catalog hang.
const settles = <A>(work: Promise<A>) =>
  Promise.race([
    work,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(Error("deadlock: admission never settled")), 2000),
    ),
  ]);
const human = { caller: { kind: "human", via: "local" }, basis: { kind: "human" } } as const;
const admission = (id: string) =>
  ({ id, key: `test.${id}`, target: { kind: "host" }, input: {} }) as const;
const plain = () =>
  fixtureCommand(
    [],
    async () => null,
    async () => ({ ok: true }),
  );

async function withJournal(run: (journal: ActionJournal) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), "pe-bridge-reentry-"));
  try {
    await run(new ActionJournal(join(dir, "journal.jsonl")));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("a cold catalog read inside command definition settles admission", () =>
  withJournal(async (journal) => {
    const base = plain();
    const entry: CommandExecutor = {
      ...base,
      definition: async (context) => {
        await journal.recordQueue("host.ops.catalog", "catalog-read", "session-a", "started", 1);
        return typeof base.definition === "function" ? base.definition(context) : base.definition;
      },
    };
    const row = await settles(invokeFixtureCommand(journal, admission("definition"), human, entry));
    expect(row.state).not.toBe("failed");
    expect((await settles(journal.wait("definition"))).state).toBe("succeeded");
  }));

test("a bridge read inside command binding settles admission", () =>
  withJournal(async (journal) => {
    const base = plain();
    const entry: CommandExecutor = {
      ...base,
      bind: async (context) => {
        await journal.recordQueue("host.ops.catalog", "bind-read", "session-a", "started", 1);
        return base.bind(context);
      },
    };
    await settles(invokeFixtureCommand(journal, admission("binding"), human, entry));
    expect((await settles(journal.wait("binding"))).state).toBe("succeeded");
  }));

test("a dispatched step's evidence never waits behind another admission's bridge read", () =>
  withJournal(async (journal) => {
    const binding = Promise.withResolvers<void>();
    const dispatched = Promise.withResolvers<void>();
    // A's native step dispatches while B's binding waits in the same session queue behind it.
    const first = fixtureCommand(
      [{ kind: "session", session: "fixture-native" }],
      async () => null,
      (execution) =>
        execution.step("native", "test.native", {}, async (requestId) => {
          await binding.promise;
          await journal.markDispatched(requestId);
          dispatched.resolve();
          return { ok: true };
        }),
    );
    const base = plain();
    const second: CommandExecutor = {
      ...base,
      bind: async (context) => {
        binding.resolve();
        await dispatched.promise;
        return base.bind(context);
      },
    };
    await settles(invokeFixtureCommand(journal, admission("first"), human, first));
    await settles(invokeFixtureCommand(journal, admission("second"), human, second));
    expect((await settles(journal.wait("first"))).steps[0]?.dispatchedAt).toBeDefined();
    expect((await settles(journal.wait("second"))).state).toBe("succeeded");
  }));
