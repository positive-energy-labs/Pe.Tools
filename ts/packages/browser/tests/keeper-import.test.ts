import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { expect, test } from "vite-plus/test";

test("importing the keeper does not interpret the embedding process arguments", async () => {
  const { stdout, stderr } = await promisify(execFile)(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      "process.argv[2] = 'must-not-be-read-as-config'; await import(process.argv[1]);",
      new URL("../src/keeper.ts", import.meta.url).href,
    ],
    { cwd: fileURLToPath(new URL("../", import.meta.url)), timeout: 10000, windowsHide: true },
  );
  expect(stdout).toBe("");
  expect(stderr).toBe("");
});
