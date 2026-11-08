import { expect, test } from "vite-plus/test";
import { sameCaller, type Caller } from "../src/caller.ts";

const pea = (thread: string, context: string): Caller => ({
  kind: "pea",
  thread,
  context,
  run: { thread, turn: context },
  root: { thread: "root", turn: context },
});
test("principal comparison keeps thread ownership separate from turn evidence", () => {
  expect(sameCaller(pea("a", "one"), pea("a", "two"))).toBe(true);
  expect(sameCaller(pea("a", "one"), pea("child", "one"))).toBe(false);
  expect(sameCaller(undefined, undefined)).toBe(false);
  expect(sameCaller(pea("a", "one"), null)).toBe(false);
  expect(sameCaller({ kind: "human", via: "local" }, pea("a", "one"))).toBe(false);
});
test("human transport/login/device and other caller identities remain exact", () => {
  const human = { kind: "human", via: "local", login: "alice", device: "one" } as const;
  expect(sameCaller(human, { ...human })).toBe(true);
  for (const other of [
    { ...human, via: "cli" },
    { ...human, login: "bob" },
    { ...human, device: "two" },
  ] as Caller[])
    expect(sameCaller(human, other)).toBe(false);
  const external = { kind: "external-mcp", context: "one", label: "agent" } as const;
  expect(sameCaller(external, { label: "agent", context: "one", kind: "external-mcp" })).toBe(true);
  expect(sameCaller(external, { ...external, context: "two" })).toBe(false);
  expect(sameCaller({ kind: "service", service: "a" }, { kind: "service", service: "b" })).toBe(
    false,
  );
});
