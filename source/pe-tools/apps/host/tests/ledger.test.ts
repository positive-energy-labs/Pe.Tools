import { expect, test } from "vite-plus/test";
import { makeLedger } from "../src/ledger.ts";

type Ev = { kind: string };

test("replay after a held key returns only what came later; a foreign or evicted key resets", async () => {
  const ledger = makeLedger<Ev>({ name: "t-ring", capacity: 3 });
  const a = ledger.emit({ kind: "a" });
  ledger.emit({ kind: "b" });
  const c = ledger.emit({ kind: "c" });

  const tail = await ledger.replay(`${a.epoch}:${a.seq}`);
  expect(tail.reset).toBe(false);
  expect(tail.entries.map((e) => e.kind)).toEqual(["b", "c"]);

  const other = await ledger.replay(`someone-else:${c.seq}`);
  expect(other.reset).toBe(true);
  expect(other.entries.map((e) => e.kind)).toEqual(["a", "b", "c"]);

  ledger.emit({ kind: "d" }); // evicts a
  const evicted = await ledger.replay(`${a.epoch}:${a.seq - 1}`);
  expect(evicted.reset).toBe(true);
  const upToDate = await ledger.replay(`${a.epoch}:${a.seq}`);
  expect(upToDate.reset).toBe(false);
  expect(upToDate.entries.map((e) => e.kind)).toEqual(["b", "c", "d"]);
});

test("a reset on a ledger with a snapshot emits the snapshot into the ring at its own seq", async () => {
  let taken = 0;
  const ledger = makeLedger<Ev>({
    name: "t-snap",
    capacity: 10,
    snapshot: async () => ({ kind: `snapshot-${++taken}` }),
  });
  ledger.emit({ kind: "before" });
  const first = await ledger.replay();
  expect(first.reset).toBe(true);
  expect(first.entries.map((e) => e.kind)).toEqual(["snapshot-1"]);
  const after = ledger.emit({ kind: "after" });
  expect(after.seq).toBe(first.entries[0]!.seq + 1);

  const tail = await ledger.replay(`${after.epoch}:${first.entries[0]!.seq}`);
  expect(tail.reset).toBe(false);
  expect(tail.entries.map((e) => e.kind)).toEqual(["after"]);
  expect(taken).toBe(1);
});
