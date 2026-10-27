import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, vi } from "vite-plus/test";
import type { Footprint } from "@pe/agent-contracts";
import { ActionJournal } from "../src/action-journal.ts";

test("SDK directory effects queue descendant files and directories without locking adjacent roots", async () => {
  const root = await mkdtemp(join(tmpdir(), "pe-directory-effect-"));
  const journal = new ActionJournal(join(root, "journal.jsonl"));
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  const prepared: string[] = [];
  const submit = (id: string, footprint: Footprint) =>
    journal.admit(
      {
        id,
        kind: "operation",
        key: "test.install",
        destination: { kind: "host" },
        input: {},
        bases: {},
        caller: { kind: "human", via: "local" },
        basis: { kind: "human" },
        footprint,
      },
      async () => {
        prepared.push(id);
        return null;
      },
      async (execution) =>
        execution.step("file", "write", {}, async () => {
          if (id === "install") await blocked;
          return { written: id };
        }),
    );
  try {
    await submit("install", [{ kind: "directory", path: "C:/Addins/2025" }]);
    await vi.waitFor(() => expect(prepared).toContain("install"));
    await submit("file", [{ kind: "file", path: "c:/addins/2025/Pe/loader.dll" }]);
    await submit("child", [{ kind: "directory", path: "C:/Addins/2025/Bridge" }]);
    await submit("adjacent", [{ kind: "file", path: "C:/Addins/20250/other.dll" }]);
    expect((await journal.wait("adjacent")).state).toBe("succeeded");
    expect(prepared).toEqual(["install", "adjacent"]);
    await submit("parent", [{ kind: "directory", path: "C:/Addins" }]);
    release();
    for (const id of ["install", "file", "child", "parent"])
      expect((await journal.wait(id)).state).toBe("succeeded");
  } finally {
    release();
    await Promise.all((await journal.list()).map((row) => journal.wait(row.id)));
    await rm(root, { recursive: true, force: true });
  }
});
