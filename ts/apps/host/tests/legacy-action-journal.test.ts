import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, writeFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, expect } from "vite-plus/test";
import { ActionJournal } from "../src/action-journal.ts";

// The no-legacy ruling retires import/archive, not current-epoch recovery authority.
// Current-row interrupted recovery stays covered by the action/recording witnesses.
test.each([4, 5, 6, 7])("journal epoch %s is discarded without conversion, archive or resumed authority", async version => {
  const dir = await mkdtemp(join(tmpdir(), "pe-retired-journal-"));
  try {
    const path = join(dir, "journal.jsonl");
    const oldAction = randomUUID();
    await writeFile(path, [JSON.stringify({ version }),
      JSON.stringify({ mapping: [JSON.stringify(["action", "old-action"]), oldAction] }),
      "unsupported old row payload", ""].join("\n"), "utf8");
    const owner = new ActionJournal(path, Date.now);
    expect(await owner.list()).toEqual([]);
    expect(await readdir(dir)).toEqual([]); // No archive or converted uncertain command survives.
    const current = await owner.actionJoin("old-action");
    expect(current.actionId).not.toBe(oldAction);
    expect((await readFile(path, "utf8")).split("\n")[0]).toBe('{"version":8}');
    expect(await new ActionJournal(path, Date.now).actionJoin("old-action")).toEqual(current);
    expect(await new ActionJournal(path, Date.now).list()).toEqual([]);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
