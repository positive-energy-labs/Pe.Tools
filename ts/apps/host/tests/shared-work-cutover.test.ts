import { expect, test } from "vite-plus/test";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileRouteDocumentStore } from "../src/route-document-store.ts";

test("startup cutover preserves exact source bytes and performs no lazy old-cell interpretation", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pe-work-cutover-"));
  try {
    const targetKey = "family/target:c:\\model.rfa",
      route = "family";
    const path = join(
      dir,
      createHash("sha256").update(`${route}:${targetKey}`).digest("hex") + ".json",
    );
    const bytes =
      JSON.stringify(
        {
          format: "route-state-record-v1",
          targetKey,
          route,
          value: {
            version: 1,
            revision: 8,
            doc: { cells: { width: { staged: { value: 200 } } }, reading: "evidence" },
          },
        },
        null,
        2,
      ) + "\n";
    await writeFile(path, bytes);
    const store = fileRouteDocumentStore(dir);
    expect(await readFile(path + ".pre-shared-work", "utf8")).toBe(bytes);
    expect(await store.getState({ targetKey, route })).toMatchObject({
      revision: 8,
      doc: {
        cells: { width: { edit: { value: 200, by: "unknown", base: null } } },
        reading: "evidence",
      },
    });
    expect(await readFile(path, "utf8")).not.toContain('"staged"');
    fileRouteDocumentStore(dir);
    expect(await readFile(path + ".pre-shared-work", "utf8")).toBe(bytes);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
