import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, test } from "vite-plus/test";
import { readServiceFile } from "@pe/host-contracts/pe-service";
import { productRoot, sourceHostServiceName } from "@pe/host-contracts/service-identity";

test("dev takeover keeps the incumbent serving until the SDK claim can proceed", async () => {
  const state = mkdtempSync(join(tmpdir(), "pe-host-takeover-"));
  const previousLocalAppData = process.env.LOCALAPPDATA;
  process.env.LOCALAPPDATA = state;
  const name = `${sourceHostServiceName(resolve(import.meta.dirname, "../../../.."))}-no-revit`;
  const appBase = productRoot();
  const serviceDir = join(appBase, "state", "service");
  const lockPath = join(serviceDir, `${name}.lock`);
  const children: ChildProcess[] = [];
  const health = (url: string) =>
    fetch(`${url}/host/status`, { signal: AbortSignal.timeout(2_000) })
      .then((response) => response.status)
      .catch(() => 0);
  const launch = (takeOver: boolean) => {
    const child = spawn(
      process.execPath,
      [
        "--import",
        "jiti/register",
        "src/index.ts",
        "--no-revit",
        ...(takeOver ? ["--take-over-host"] : []),
      ],
      {
        cwd: resolve(import.meta.dirname, ".."),
        env: {
          ...process.env,
          PE_LANE: "dev",
          PE_SERVICE_LEASE_PATH: undefined,
          PE_SERVICE_LEASE_TOKEN: undefined,
        },
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      },
    );
    children.push(child);
    let output = "";
    child.stdout?.on("data", (data) => (output += String(data)));
    child.stderr?.on("data", (data) => (output += String(data)));
    return { child, output: () => output };
  };
  try {
    const first = launch(false);
    let incumbent = await readServiceFile(appBase, name);
    await expect
      .poll(
        async () => {
          incumbent = await readServiceFile(appBase, name);
          return incumbent?.pid;
        },
        { timeout: 30_000 },
      )
      .toBe(first.child.pid);
    const oldUrl = `http://127.0.0.1:${incumbent!.port}`;
    await expect.poll(() => health(oldUrl), { timeout: 15_000 }).toBe(200);

    mkdirSync(serviceDir, { recursive: true });
    writeFileSync(
      lockPath,
      JSON.stringify({
        pid: process.pid,
        token: "test-lock",
        acquiredUtc: new Date().toISOString(),
      }),
    );
    const second = launch(true);
    await expect
      .poll(() => second.output().includes("pe-host binding"), { timeout: 30_000 })
      .toBe(true);
    expect(await health(oldUrl)).toBe(200);

    rmSync(lockPath);
    let successor = await readServiceFile(appBase, name);
    await expect
      .poll(
        async () => {
          successor = await readServiceFile(appBase, name);
          return successor?.pid;
        },
        { timeout: 30_000 },
      )
      .toBe(second.child.pid);
    await expect
      .poll(() => health(`http://127.0.0.1:${successor!.port}`), { timeout: 15_000 })
      .toBe(200);
  } finally {
    rmSync(lockPath, { force: true });
    for (const child of children) {
      if (child.exitCode === null && child.signalCode === null) {
        const exited = once(child, "exit");
        child.kill();
        await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 2_000))]);
      }
    }
    if (previousLocalAppData === undefined) delete process.env.LOCALAPPDATA;
    else process.env.LOCALAPPDATA = previousLocalAppData;
    rmSync(state, { recursive: true, force: true });
  }
}, 75_000);
