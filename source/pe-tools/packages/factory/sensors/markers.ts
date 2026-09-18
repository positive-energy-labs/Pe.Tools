import { spawnSync } from "node:child_process";

const count = (name: string) => {
  const result = spawnSync("git", ["grep", "-c", "-F", `${name}:`, "--", "."], {
    encoding: "utf8",
  });
  if (result.status !== 0 && result.status !== 1) throw new Error(result.stderr.trim());
  return result.stdout
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .reduce((sum, line) => sum + Number(line.slice(line.lastIndexOf(":") + 1)), 0);
};

console.log(
  JSON.stringify({ todo: count("TODO"), shim: count("SHIM"), footgun: count("FOOTGUN") }),
);
