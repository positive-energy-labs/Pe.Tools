import { spawn } from "node:child_process";
import { once } from "node:events";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { expect, test } from "vite-plus/test";

test("source edits restart the child, but retirement exits the entire watcher", async () => {
  const root = mkdtempSync(join(resolve(import.meta.dirname, ".."), ".watch-test-"));
  mkdirSync(join(root, "scripts"));
  mkdirSync(join(root, "src"));
  copyFileSync(
    new URL("../scripts/dev-watch.ts", import.meta.url),
    join(root, "scripts/dev-watch.ts"),
  );
  writeFileSync(join(root, "retire"), "");
  writeFileSync(
    join(root, "src/dev.ts"),
    `
    import { appendFileSync, watch } from "node:fs";
    appendFileSync("events", "started\\n");
    process.once("disconnect", () => {
      appendFileSync("events", "stopped\\n");
      process.exit(0);
    });
    watch("retire", () => process.send("retired", () => process.exit(0)));
  `,
  );
  const launcher = spawn(process.execPath, ["--import", "jiti/register", "scripts/dev-watch.ts"], {
    cwd: root,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const exited = once(launcher, "exit");
  let output = "";
  launcher.stdout.on("data", (chunk) => {
    output += chunk;
  });
  launcher.stderr.on("data", (chunk) => {
    output += chunk;
  });
  const events = () => {
    try {
      return readFileSync(join(root, "events"), "utf8");
    } catch {
      return "";
    }
  };
  try {
    await expect.poll(events, { timeout: 15_000 }).toBe("started\n");
    writeFileSync(join(root, "src/edit.ts"), "// source edit\n");
    await expect.poll(events, { timeout: 15_000 }).toBe("started\nstopped\nstarted\n");
    writeFileSync(join(root, "retire"), "retire");
    await expect.poll(() => launcher.exitCode, { timeout: 10_000 }).toBe(0);
    await exited;
    expect(output).toContain("Dev session retired. Host, frontend, and watcher stopped.");
    writeFileSync(join(root, "src/edit.ts"), "// later edit\n");
    expect(events()).toBe("started\nstopped\nstarted\n");
  } finally {
    if (launcher.exitCode === null) {
      launcher.kill();
      await exited;
    }
    rmSync(root, { recursive: true, force: true });
  }
}, 45_000);
