import { expect, test, vi } from "vite-plus/test";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileRouteDocumentStore } from "../src/route-document-store.ts";

const interleave = vi.hoisted(() => ({ afterWrite: null as (() => void) | null, failRename: false }));
vi.mock("node:fs", async (load) => {
  const real = await load<typeof import("node:fs")>();
  return {
    ...real,
    writeFileSync: (...args: Parameters<typeof real.writeFileSync>) => {
      real.writeFileSync(...args);
      const next = interleave.afterWrite;
      interleave.afterWrite = null;
      next?.();
    },
    renameSync: (...args: Parameters<typeof real.renameSync>) => {
      if (interleave.failRename) throw Object.assign(new Error("EBUSY: share locked"), { code: "EBUSY" });
      real.renameSync(...args);
    },
  };
});

test("two interleaved Work writers publish complete records without sharing staging files", async () => {
  const dir = mkdtempSync(join(tmpdir(), "pe-work-writers-"));
  try {
    const first = fileRouteDocumentStore(dir);
    const second = fileRouteDocumentStore(dir);
    const address = { targetKey: "same-work", route: "fans" };
    const value = { author: "first", body: "a".repeat(4096) };
    let competing: Promise<void> | undefined;
    // Finish another machine's write after the first stages bytes, before its rename.
    interleave.afterWrite = () => {
      competing = second.setState({
        ...address,
        value: { author: "second", body: "b".repeat(4096) },
      });
    };
    const writing = first.setState({ ...address, value });
    expect(competing).toBeDefined();
    await Promise.all([writing, competing]);
    const files = readdirSync(dir);
    expect(files).toHaveLength(1);
    expect(JSON.parse(readFileSync(join(dir, files[0]!), "utf8")).value).toEqual(value);
    expect(await first.getState(address)).toEqual(value);
  } finally {
    interleave.afterWrite = null;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a failed Work publish removes its own staging file", async () => {
  const dir = mkdtempSync(join(tmpdir(), "pe-work-failed-"));
  try {
    const store = fileRouteDocumentStore(dir);
    interleave.failRename = true;
    await expect(store.setState({ targetKey: "w", route: "fans", value: { a: 1 } })).rejects.toThrow("EBUSY");
    expect(readdirSync(dir)).toEqual([]);
  } finally {
    interleave.failRename = false;
    rmSync(dir, { recursive: true, force: true });
  }
});
