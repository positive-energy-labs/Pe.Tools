// @vitest-environment jsdom
import { expect, test } from "vite-plus/test";
import { waitFor } from "@testing-library/react";
import { spawnSync } from "node:child_process";
import { Places, focus, readFocus } from "./places";
import { hostList } from "./places.test-support";

const tab = { id: "00000000-0000-4000-8000-000000000001", route: "fans", link: "/fans", at: "2026-11-13T00:00:00Z" };
test("a second client on the host stream sees a Place added by the first", async () => {
  const host = hostList();
  const a = new Places(host.client, host.stream), b = new Places(host.client, host.stream);
  const stops = [a.subscribe(() => {}), b.subscribe(() => {})];
  try {
    await waitFor(() => expect(a.read().ready && b.read().ready).toBe(true));
    a.save([tab]);
    await waitFor(() => expect(b.read().tabs).toEqual([tab]));
    expect(host.read()).toEqual([tab]);
  } finally { stops.forEach(stop => stop()); }
});
test("web source contains no retired browser list key", () => {
  const result = spawnSync("rg", ["--files-with-matches", "pe" + "\\.places", "src"], { cwd: import.meta.dirname + "/../..", encoding: "utf8" });
  expect(result.stdout).toBe("");
  expect(result.status).toBe(1);
});
test("two windows can focus different Places without writing the host list", () => {
  const storage = () => {
    const values = new Map<string, string>();
    return { getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
      removeItem: (key: string) => { values.delete(key); } };
  };
  const a = storage(), b = storage();
  focus("first", a); focus("second", b);
  expect(readFocus(a)).toBe("first");
  expect(readFocus(b)).toBe("second");
});
