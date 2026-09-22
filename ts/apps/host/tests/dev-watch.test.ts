import { spawn } from "node:child_process";
import { once } from "node:events";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { expect, test } from "vite-plus/test";

test("host and workspace package source edits restart the child, but retirement exits the watcher", async () => {
  const root = mkdtempSync(join(resolve(import.meta.dirname, ".."), ".watch-test-"));
  const host = join(root, "apps/host");
  mkdirSync(join(host, "scripts"), { recursive: true });
  mkdirSync(join(host, "src"));
  mkdirSync(join(root, "packages/mcps/src"), { recursive: true });
  copyFileSync(
    new URL("../scripts/dev-watch.ts", import.meta.url),
    join(host, "scripts/dev-watch.ts"),
  );
  writeFileSync(join(host, "retire"), "");
  writeFileSync(
    join(host, "src/dev.ts"),
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
    cwd: host,
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
      return readFileSync(join(host, "events"), "utf8");
    } catch {
      return "";
    }
  };
  try {
    await expect.poll(events, { timeout: 15_000 }).toBe("started\n");
    writeFileSync(join(host, "src/edit.ts"), "// host source edit\n");
    await expect.poll(events, { timeout: 15_000 }).toBe("started\nstopped\nstarted\n");
    writeFileSync(join(root, "packages/mcps/src/edit.ts"), "// package source edit\n");
    await expect
      .poll(events, { timeout: 15_000 })
      .toBe("started\nstopped\nstarted\nstopped\nstarted\n");
    writeFileSync(join(host, "retire"), "retire");
    await expect.poll(() => launcher.exitCode, { timeout: 10_000 }).toBe(0);
    await exited;
    expect(output).toContain("Dev session retired. Host, frontend, and watcher stopped.");
    writeFileSync(join(host, "src/edit.ts"), "// later edit\n");
    expect(events()).toBe("started\nstopped\nstarted\nstopped\nstarted\n");
  } finally {
    if (launcher.exitCode === null) {
      launcher.kill();
      await exited;
    }
    rmSync(root, { recursive: true, force: true });
  }
}, 45_000);
