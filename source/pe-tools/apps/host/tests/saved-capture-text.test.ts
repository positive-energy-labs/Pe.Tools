import { expect, test } from "vite-plus/test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { TakeoffCaptures } from "../src/takeoff-captures.ts";

/** The owner returns the file's own bytes, and answers only for an ID it already validates. */
test("savedText returns the stored bytes verbatim and refuses an ID it does not own", async () => {
  const root = await mkdtemp(join(tmpdir(), "pe-capture-text-"));
  try {
    await mkdir(root, { recursive: true });
    const id = "b".repeat(64);
    // Malformed JSON, irregular whitespace, a BOM and CRLF — none of it survives a parse.
    const stored = '﻿{\r\n  "a":   1,\r\n  "b": ,\r\n}\r\n   ';
    await writeFile(join(root, `${id}.json`), stored, "utf8");
    const captures = new TakeoffCaptures(root);

    const read = await captures.savedText(id);
    expect(read.text).toBe(stored);
    expect(read.path).toBe(join(root, `${id}.json`));
    // The parsed reader cannot serve this file at all; only the text reader can.
    await expect(captures.saved(id)).rejects.toBeTruthy();

    // Path escape and shape violations are refused by the same validation `saved()` uses.
    for (const bad of ["../secret", "not-a-capture-id", `${id}/x`, ""])
      await expect(captures.savedText(bad)).rejects.toBeTruthy();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
