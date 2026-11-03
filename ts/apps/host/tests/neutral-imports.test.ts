import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { expect, test } from "vite-plus/test";

const webSource = join(import.meta.dirname, "../../web/src");
const neutralModules = readdirSync(webSource, { recursive: true, withFileTypes: true })
  .filter((entry) => entry.isFile() && entry.name === "neutral.ts")
  .map((entry) => join(entry.parentPath, entry.name));

test.each(neutralModules)(
  "Node ESM imports neutral module %s from the host",
  (file) => {
    const output = execFileSync(
      process.execPath,
      [
        "--experimental-transform-types",
        "--input-type=module",
        "--eval",
        `const module = await import(${JSON.stringify(pathToFileURL(file).href)}); console.log(Object.keys(module).length);`,
      ],
      { cwd: join(import.meta.dirname, ".."), encoding: "utf8" },
    );
    expect(Number(output.trim())).toBeGreaterThan(0);
  },
  30_000,
);
