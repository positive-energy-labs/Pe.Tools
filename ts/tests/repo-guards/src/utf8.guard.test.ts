import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { TextDecoder } from "node:util";
import { expect, it } from "vite-plus/test";

it("tracked UTF-8 text has no Windows ANSI round-trip sequences", () => {
  const root = resolve(import.meta.dirname, "../../../..");
  const files = execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8" }).split("\0").filter(Boolean);
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const offenders: string[] = [];
  // Exact lead pairs of the observed UTF-8 -> Windows-1252 corruption, including nested rounds.
  const corrupted = /(?:\u00c3[\u0080-\u00bf\u0192]|\u00c2[\u0080-\u00bf]|\u00e2[\u20ac\u2020])/u;
  for (const file of files) {
    const bytes = readFileSync(resolve(root, file));
    if (bytes.includes(0)) continue;
    let text: string;
    try { text = decoder.decode(bytes); } catch { continue; }
    text.split(/\r?\n/).forEach((line, index) => {
      if (corrupted.test(line)) offenders.push(`${file}:${index + 1}`);
    });
  }
  expect(offenders).toEqual([]);
});
