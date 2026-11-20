// @vitest-environment jsdom
import { expect, test, vi } from "vite-plus/test";
import { waitFor } from "@testing-library/react";
import { globSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Places, focus, readFocus } from "./places";
import { hostList } from "./places.test-support";
import type { Readings } from "#/host/resource-stream";

const tab = {
  id: "00000000-0000-4000-8000-000000000001",
  route: "fans",
  link: "/fans",
  at: "2026-11-13T00:00:00Z",
};
test("malformed publication metadata cannot replace the decoded host list", async () => {
  const host = hostList();
  host.seed([tab]);
  let accept: Parameters<Readings["subscribe"]>[1] = () => {};
  const places = new Places(host.client, {
    ...host.stream,
    subscribe: (request, listener) => {
      accept = listener;
      return host.stream.subscribe(request, listener);
    },
  });
  const stop = places.subscribe(() => {});
  try {
    await waitFor(() => expect(places.read().ready).toBe(true));
    expect(() => accept({ kind: "snapshot", key: "places", value: null })).not.toThrow();
    expect(places.read().tabs).toEqual([tab]);
  } finally {
    stop();
  }
});
test("a second client on the host stream sees a Place added by the first", async () => {
  const host = hostList();
  const a = new Places(host.client, host.stream),
    b = new Places(host.client, host.stream);
  const stops = [a.subscribe(() => {}), b.subscribe(() => {})];
  try {
    await waitFor(() => expect(a.read().ready && b.read().ready).toBe(true));
    a.save([tab]);
    await waitFor(() => expect(b.read().tabs).toEqual([tab]));
    expect(host.read()).toEqual([tab]);
  } finally {
    stops.forEach((stop) => stop());
  }
});
test("web source contains no retired browser list key", () => {
  const source = join(import.meta.dirname, "..");
  const matches = globSync("**/*", { cwd: source, withFileTypes: true })
    .flatMap((entry) => (entry.isFile() ? [join(entry.parentPath, entry.name)] : []))
    .filter((path) => readFileSync(path, "utf8").includes("pe" + ".places"));
  expect(matches).toEqual([]);
});
test("two windows can focus different Places without writing the host list", () => {
  const storage = () => {
    const values = new Map<string, string>();
    return {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        values.set(key, value);
      },
      removeItem: (key: string) => {
        values.delete(key);
      },
    };
  };
  const a = storage(),
    b = storage();
  try {
    vi.stubGlobal("sessionStorage", a);
    focus("first");
    vi.stubGlobal("sessionStorage", b);
    focus("second");
    expect(readFocus()).toBe("second");
    vi.stubGlobal("sessionStorage", a);
    expect(readFocus()).toBe("first");
  } finally {
    vi.unstubAllGlobals();
  }
});
