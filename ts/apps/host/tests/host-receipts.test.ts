import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Effect, Exit } from "effect";
import { TestClock } from "effect/testing";
import { afterEach, expect, test } from "vite-plus/test";
import type { ReceiptStamp } from "@pe/agent-contracts";
import { ActionJournalService, HostLogService } from "../src/receipt-services.ts";

const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});
const stamp = (component: ReceiptStamp["component"]): ReceiptStamp => ({
  installId: randomUUID(),
  processSessionId: randomUUID(),
  component,
  lane: "dev",
  version: "1.0.0",
  build: "test",
  commit: "0".repeat(40),
});
/** One host runtime: run the program in its own scope, and let the scope finalize. */
const runtime = <A>(
  dir: string,
  admitted: ReceiptStamp | null,
  program: Effect.Effect<A, never, ActionJournalService | HostLogService>,
) => Effect.runPromise(Effect.scoped(program).pipe(Effect.provide(ActionJournalService.live(admitted, dir))));

test("each runtime scope owns its journal; the log mirrors commits in order and drains on close", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pe-host-receipts-"));
  dirs.push(dir);
  const host = stamp("host");
  const first = await runtime(
    dir,
    host,
    Effect.gen(function* () {
      const journal = yield* ActionJournalService;
      const log = yield* HostLogService;
      yield* Effect.promise(() => journal.recordQueue("test.a", "a", "s", "queued", 1));
      yield* Effect.promise(() => journal.recordQueue("test.b", "b", "s", "queued", 2));
      return { journal, entries: log.read(0).entries.map(({ event }) => event) };
    }),
  );
  expect(first.entries).toMatchObject([
    { kind: "receipt", receipt: { body: { op: "test.a" }, stamp: host } },
    { kind: "receipt", receipt: { body: { op: "test.b" }, stamp: host } },
  ]);
  // The released runtime refuses late work; its successor never borrows it.
  await expect(first.journal.recordQueue("test.late", "late", "s", "started", 1)).rejects.toThrow("closed");
  const second = await runtime(
    dir,
    null,
    Effect.gen(function* () {
      const journal = yield* ActionJournalService;
      const log = yield* HostLogService;
      return {
        journal,
        stamps: (yield* Effect.promise(() => journal.read({ kinds: ["queue"] }))).map((row) => row.stamp),
        logged: log.read(0).entries.length,
      };
    }),
  );
  expect(second.journal).not.toBe(first.journal);
  expect(second.stamps).toEqual([host, host]);
  expect(second.logged).toBe(2);
});

test("a non-host stamp fails runtime construction; no later stamp mutation exists", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pe-host-receipts-"));
  dirs.push(dir);
  const exit = await Effect.runPromiseExit(
    Effect.scoped(Effect.gen(function* () {
      return yield* ActionJournalService;
    })).pipe(
      Effect.provide(ActionJournalService.live(stamp("web"), dir)),
    ),
  );
  expect(Exit.isFailure(exit) && String(exit.cause)).toContain("requires a host stamp");
});

test("journal facts and their mirrored log entries take the runtime Clock; advancing it rewrites nothing", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pe-host-receipts-"));
  dirs.push(dir);
  const first = "2030-01-01T00:00:00.000Z";
  const later = "2030-01-01T01:00:00.000Z";
  const { facts, mirrored } = await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const journal = yield* ActionJournalService;
        const log = yield* HostLogService;
        yield* TestClock.setTime(Date.parse(first));
        yield* Effect.promise(() => journal.recordQueue("test.a", "a", "s", "queued", 1));
        yield* TestClock.adjust("1 hour");
        yield* Effect.promise(() => journal.recordQueue("test.b", "b", "s", "queued", 2));
        return {
          facts: (yield* Effect.promise(() => journal.read({ kinds: ["queue"] }))).map((r) => r.at),
          mirrored: log.read(0).entries.map(({ at, event }) => [at, event.kind === "receipt" && event.receipt.at]),
        };
      }),
    ).pipe(Effect.provide(ActionJournalService.live(null, dir)), Effect.provide(TestClock.layer())),
  );
  expect(facts).toEqual([first, later]);
  expect(mirrored).toEqual([
    [first, first],
    [later, later],
  ]);
});
