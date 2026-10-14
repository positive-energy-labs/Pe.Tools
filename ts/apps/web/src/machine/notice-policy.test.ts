import { expect, test } from "vite-plus/test";
import type { MachineNotice } from "@pe/agent-contracts";

import {
  SNOOZE_MS,
  acknowledge,
  admit,
  emptyLedger,
  loadLedger,
  saveLedger,
  snooze,
  threadOf,
  wake,
  type NoticeView,
} from "./notice-policy";

const turn = (id: string, revision = 1, thread = "t1"): MachineNotice => ({
  id,
  revision,
  title: "Pea finished · Wiring",
  body: "Done.",
  href: `/pea?thread=${thread}`,
  act: { kind: "reply", threadId: thread },
});
const elsewhere: NoticeView = { visible: true, focused: true, pathname: "/machine", thread: null };
const onThread = (thread: string): NoticeView => ({
  visible: true,
  focused: true,
  pathname: "/pea",
  thread,
});
const NOW = 1_000_000;

test("a notice names its thread from its door, else from its link", () => {
  expect(threadOf(turn("a"))).toBe("t1");
  expect(threadOf({ id: "b", revision: 1, title: "", body: "", href: "/pea?thread=t%202" })).toBe(
    "t 2",
  );
  expect(threadOf({ id: "c", revision: 1, title: "", body: "" })).toBeNull();
});

test("no notice for the thread you are looking at, and only while you are", () => {
  const n = turn("a");
  expect(admit(emptyLedger, n, onThread("t1"), NOW)).toBe("looking");
  expect(admit(emptyLedger, n, onThread("t2"), NOW)).toBe("show");
  expect(admit(emptyLedger, n, elsewhere, NOW)).toBe("show");
  expect(admit(emptyLedger, n, { ...onThread("t1"), focused: false }, NOW)).toBe("show");
  expect(admit(emptyLedger, n, { ...onThread("t1"), visible: false }, NOW)).toBe("show");
  // A notice with no thread is never suppressed by a view that has none.
  const bare = { id: "u", revision: 1, title: "Pe.Tools updated", body: "" };
  expect(admit(emptyLedger, bare, onThread("t1"), NOW)).toBe("show");
});

test("an acknowledged revision never shows again, its successor does", () => {
  const seen = acknowledge(emptyLedger, turn("a", 2));
  expect(admit(seen, turn("a", 1), elsewhere, NOW)).toBe("acknowledged");
  expect(admit(seen, turn("a", 2), elsewhere, NOW)).toBe("acknowledged");
  expect(admit(seen, turn("a", 3), elsewhere, NOW)).toBe("show");
  expect(admit(seen, turn("b", 1), elsewhere, NOW)).toBe("show");
});

test("a snoozed notice is held for an hour, then comes back once", () => {
  const held = snooze(emptyLedger, turn("a"), NOW);
  expect(admit(held, turn("a"), elsewhere, NOW + 1)).toBe("snoozed");
  expect(wake(held, NOW + SNOOZE_MS - 1).due).toEqual([]);
  const woken = wake(held, NOW + SNOOZE_MS);
  expect(woken.due).toEqual([turn("a")]);
  expect(wake(woken.ledger, NOW + SNOOZE_MS * 2).due).toEqual([]);
  expect(admit(woken.ledger, turn("a"), elsewhere, NOW + SNOOZE_MS)).toBe("show");
});

test("the ledger survives a reload and a damaged one reads empty", () => {
  const store = new Map<string, string>();
  const storage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
  };
  const ledger = snooze(acknowledge(emptyLedger, turn("a")), turn("b"), NOW);
  saveLedger(storage, ledger);
  expect(loadLedger(storage)).toEqual(ledger);
  store.set([...store.keys()][0]!, "{not json");
  expect(loadLedger(storage)).toEqual(emptyLedger);
  store.set([...store.keys()][0]!, JSON.stringify({ acked: { a: "x" }, snoozed: 3 }));
  expect(loadLedger(storage)).toEqual(emptyLedger);
});
