import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, vi } from "vite-plus/test";

// The installed host shipped without the platform package once: the import itself is what fails.
vi.mock("@llamaindex/liteparse", () => {
  throw new Error("Failed to load native module for win32-x64.");
});

test("a LiteParse binary that does not load fails the read_document call, not the process", async () => {
  const unhandled: unknown[] = [];
  const record = (reason: unknown) => unhandled.push(reason);
  process.on("unhandledRejection", record);
  const dir = mkdtempSync(join(tmpdir(), "read-document-native-"));
  try {
    const { runReadDocument } = await import("../src/shared/read-document.ts");
    // unhandledRejection fires once the microtask queue drains, so wait a macrotask before looking.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(unhandled).toEqual([]);

    const file = join(dir, "any.pdf");
    writeFileSync(file, "%PDF-1.4\n");
    for (const _ of [1, 2])
      await expect(runReadDocument({ path: file })).rejects.toThrow(
        /read_document: the LiteParse native binary did not load on /,
      );
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(unhandled).toEqual([]);
  } finally {
    process.off("unhandledRejection", record);
    rmSync(dir, { recursive: true, force: true });
  }
});
