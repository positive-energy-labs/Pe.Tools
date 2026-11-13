import { expect, test } from "vite-plus/test";
import { bindWork } from "@pe/agent-contracts";
import { createApplicationWorkRegistry } from "./application-work-registry";

test("pending input survives the last Place and only its own acknowledgement removes it", () => {
  const registry = createApplicationWorkRegistry(), key = bindWork("test", null, "one");
  const first = registry.acquire(key);
  const id = first.entry.retain({ kind: "apply", press: "p", expectedRevision: 0, patches: [] }, "Edit");
  first.entry.refuse(id, "Offline"); first.release();
  const next = registry.acquire(key);
  expect(next.entry.pending()).toMatchObject([{ id: "p", status: "refused", reason: "Offline" }]);
  expect(() => { next.entry.pending()[0]!.input.expectedRevision = 99; }).toThrow();
  expect(next.entry.pending()[0]!.input.expectedRevision).toBe(0);
  next.entry.accept("other"); expect(next.entry.pending()).toHaveLength(1);
  next.entry.accept("p"); expect(next.entry.pending()).toEqual([]);
  next.release();
  const fresh = registry.acquire(key);
  expect(fresh.entry).not.toBe(next.entry); fresh.release();
});

test("a late acknowledgement releases retained input after the last Place leaves", () => {
  const registry = createApplicationWorkRegistry(), key = bindWork("test", null, "late");
  const first = registry.acquire(key);
  first.entry.retain({ kind: "apply", press: "late", expectedRevision: 0, patches: [] }, "Edit");
  first.release(); first.entry.accept("late");
  const next = registry.acquire(key);
  expect(next.entry).not.toBe(first.entry); next.release();
});
