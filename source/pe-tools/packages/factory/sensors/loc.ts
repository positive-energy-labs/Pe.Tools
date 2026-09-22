import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { extname } from "node:path";

const extensions = ["cs", "ts", "tsx", "md", "toml", "json", "ps1"];
const counts = Object.fromEntries(extensions.map((extension) => [extension, 0])) as Record<
  string,
  number
>;

for (const file of execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" })
  .split("\0")
  .filter(Boolean)) {
  const extension = extname(file).slice(1).toLowerCase();
  if (!(extension in counts)) continue;
  const text = readFileSync(file, "utf8");
  counts[extension] += text ? text.split(/\r?\n/).length - (text.endsWith("\n") ? 1 : 0) : 0;
}

console.log(
  JSON.stringify({
    total: Object.values(counts).reduce((sum, count) => sum + count, 0),
    ...counts,
  }),
);
