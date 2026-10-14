import { mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";
import { ActionJournal } from "../src/action-journal.ts";

/** Field 2026-10-14: a 0.7.24 machine updated to 0.7.26 and the host died on every boot because
 * its journal was version 3. An older journal is archived beside itself; the host starts fresh. */
test("an older journal is archived and the host loads an empty one", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pe-journal-upgrade-"));
  const path = join(dir, "actions.json");
  const v3 = `${JSON.stringify({ version: 3, receipts: [{ legacy: true }], mappings: {} })}\n`;
  await writeFile(path, v3);
  const journal = new ActionJournal(path);
  expect(await journal.list()).toEqual([]);
  const names = await readdir(dir);
  const archived = names.find((n) => /^actions\.json\.v3\.\d+\.archived$/.test(n));
  expect(archived).toBeDefined();
  expect(await readFile(join(dir, archived!), "utf8")).toBe(v3);
  expect(names).not.toContain("actions.json");
});
