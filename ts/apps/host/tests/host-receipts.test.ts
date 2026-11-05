import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Effect, Exit } from "effect";
import { afterEach, expect, test } from "vite-plus/test";
import type { ReceiptStamp } from "@pe/agent-contracts";
import { HostReceipts } from "../src/gateway-owner.ts";

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
/** One host runtime: acquire the service in its own scope, act, and let the scope finalize. */
const runtime = <A>(
  dir: string,
  admitted: ReceiptStamp | null,
  use: (receipts: HostReceipts["Service"]) => Promise<A>,
) =>
  Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const receipts = yield* HostReceipts;
        return { receipts, value: yield* Effect.promise(() => use(receipts)) };
      }),
    ).pipe(Effect.provide(HostReceipts.layer(admitted, dir))),
  );

test("each runtime scope owns its journal; the log mirrors commits in order and drains on close", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pe-host-receipts-"));
  dirs.push(dir);
  const host = stamp("host");
  const first = await runtime(dir, host, async ({ journal, log }) => {
    await journal.recordQueue("test.a", "a", "s", "queued", 1);
    await journal.recordQueue("test.b", "b", "s", "queued", 2);
    return log.read(0).entries.map(({ event }) => event);
  });
  expect(first.value).toMatchObject([
    { kind: "receipt", receipt: { body: { op: "test.a" }, stamp: host } },
    { kind: "receipt", receipt: { body: { op: "test.b" }, stamp: host } },
  ]);
  // The released runtime refuses late work; its successor never borrows it.
  await expect(
    first.receipts.journal.recordQueue("test.late", "late", "s", "started", 1),
  ).rejects.toThrow("closed");
  const second = await runtime(dir, null, async ({ journal }) =>
    (await journal.read({ kinds: ["queue"] })).map((row) => row.stamp),
  );
  expect(second.receipts.journal).not.toBe(first.receipts.journal);
  expect(second.value).toEqual([host, host]);
  expect(second.receipts.log.read(0).entries).toHaveLength(2);
});

test("a non-host stamp fails runtime construction; no later stamp mutation exists", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pe-host-receipts-"));
  dirs.push(dir);
  const exit = await Effect.runPromiseExit(
    Effect.scoped(Effect.gen(function* () {
      return yield* HostReceipts;
    })).pipe(
      Effect.provide(HostReceipts.layer(stamp("web"), dir)),
    ),
  );
  expect(Exit.isFailure(exit) && String(exit.cause)).toContain("requires a host stamp");
});
