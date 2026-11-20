import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, test } from "vite-plus/test";
import { readServiceFile } from "@pe/host-contracts/pe-service";
import { sourceHostServiceName, stateRoot } from "@pe/host-contracts/service-identity";

test("the dev tray host recovers after a competing supervisor outlasts the first claim", async () => {
  const cwd = resolve(import.meta.dirname, "..");
  const sourceRoot = resolve(cwd, "../../..");
  const name = sourceHostServiceName(sourceRoot);
  const isolated = await mkdtemp(join(tmpdir(), "pe-dev-host-restart-"));
  const productHome = join(isolated, "product");
  const appBase = stateRoot("dev", sourceRoot, productHome);
  const serviceDir = join(appBase, "state", "service");
  const lock = join(serviceDir, `${name}.lock`);
  await mkdir(serviceDir, { recursive: true });
  await writeFile(
    lock,
    JSON.stringify({
      pid: process.pid,
      token: randomUUID(),
      acquiredUtc: new Date().toISOString(),
    }),
    { flag: "wx" },
  );

  // Exact backend child entry used by dev-watch.ts. IPC lets this test retire only its own child.
  const host = spawn(process.execPath, ["--import", "jiti/register", "src/dev.ts", "--no-tray"], {
    cwd,
    env: {
      ...process.env,
      PE_LANE: "dev",
      PE_TOOLS_SOURCE_ROOT: sourceRoot,
      PE_TOOLS_PRODUCT_HOME: productHome,
      PE_TOOLS_SHARED_ROOT: undefined,
      LOCALAPPDATA: join(isolated, "local"),
      PE_SESSION_REGISTRY_ROOT: join(isolated, "sdk", "registry"),
      PE_SESSION_FILES_ROOT: join(isolated, "sdk", "files"),
      PE_SERVICE_STATE_ROOT: join(isolated, "sdk", "services"),
      PE_TOOLS_HOST_SERVICE_NAME: name,
      PE_TOOLS_HOST_BASE_URL: undefined,
      PE_TOOLS_FRONTEND_BASE_URL: undefined,
      PE_SERVICE_LEASE_PATH: undefined,
      PE_SERVICE_LEASE_TOKEN: undefined,
    },
    stdio: ["ignore", "pipe", "pipe", "ipc"],
    windowsHide: true,
  });
  const exited = new Promise<string>((done) => {
    host.once("exit", (code, signal) => done(`exit ${code ?? signal}`));
    host.once("error", (error) => done(error.message));
  });
  let output = "";
  const read = (chunk: Buffer) => {
    output += String(chunk);
  };
  host.stdout!.on("data", read);
  host.stderr!.on("data", read);
  try {
    await expect.poll(() => output, { timeout: 150_000 }).toContain("busy in another supervisor");
    try {
      expect(await readServiceFile(appBase, name)).toBeNull();
    } finally {
      await rm(lock);
    }

    // Fail immediately if the tray's backend dies. Otherwise wait for the same PID to own the
    // receipt and answer at the published endpoint, then for its frontend to come up.
    const recovered = expect
      .poll(
        async () => {
          const service = await readServiceFile(appBase, name);
          if (!service || service.pid !== host.pid || !output.includes("Browser: http"))
            return false;
          return fetch(`http://127.0.0.1:${service.port}/host/status`, {
            signal: AbortSignal.timeout(1_000),
          }).then(
            (response) => response.ok,
            () => false,
          );
        },
        { timeout: 80_000 },
      )
      .toBe(true);
    const outcome = await Promise.race([recovered.then(() => "healthy"), exited]);
    expect(outcome, output).toBe("healthy");
    console.log(
      "Competing lease released. The same dev host PID recovered and started its frontend.",
    );
  } finally {
    await rm(lock, { force: true });
    if (host.connected) host.disconnect();
    const kill = setTimeout(() => host.kill(), 20_000);
    await exited;
    clearTimeout(kill);
    await rm(isolated, { recursive: true, force: true });
  }
}, 255_000);
