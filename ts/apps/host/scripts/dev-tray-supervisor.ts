import { spawn, type ChildProcess } from "node:child_process";
import { open, mkdir, unlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { existsSync, readdirSync, statSync } from "node:fs";
import { devTrayDirectory, readJson, writeAtomic } from "./dev-tray-session.ts";

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

async function ensureDevTray(sourceRoot: string) {
  const binary = join(
    sourceRoot,
    ".artifacts",
    "build",
    "Pe.Host.Tray",
    "Debug.R25",
    "Pe.Host.Tray.exe",
  );
  const sources = join(sourceRoot, "dotnet", "Pe.Host.Tray");
  const stamp = existsSync(binary) ? statSync(binary).mtimeMs : 0;
  if (
    readdirSync(sources)
      .filter((name) => /\.(cs|csproj)$/.test(name))
      .every((name) => statSync(join(sources, name)).mtimeMs <= stamp)
  )
    return;
  const code = await new Promise<number | null>((done, reject) => {
    const build = spawn(
      "dotnet",
      ["build", join(sources, "Pe.Host.Tray.csproj"), "-c", "Debug.R25", "--nologo"],
      { cwd: sourceRoot, stdio: "inherit", windowsHide: true },
    );
    build.once("error", reject);
    build.once("exit", done);
  });
  if (code !== 0) throw new Error("Dev tray isolated compile failed");
}

/** Own one icon for the checkout; backend and frontend incarnations are read by the native adapter. */
export async function createDevTraySupervisor(sourceRoot: string, showWindow = false) {
  const directory = devTrayDirectory(sourceRoot);
  const path = join(directory, "supervisor.json");
  await mkdir(directory, { recursive: true });
  try {
    const prior = (await readJson(path)) as {
      pid?: number;
      sourceRoot?: string;
      instanceId?: string;
    };
    if (prior.sourceRoot !== sourceRoot)
      throw new Error("Dev tray supervisor belongs to another checkout");
    if (prior.pid && alive(prior.pid)) {
      if (showWindow && prior.instanceId)
        await writeAtomic(join(directory, "show.json"), {
          instanceId: prior.instanceId,
          nonce: randomUUID(),
        });
      return null;
    }
    await unlink(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  await ensureDevTray(sourceRoot);
  const lease = await open(path, "wx");
  const instanceId = randomUUID();
  await lease.writeFile(
    JSON.stringify({
      schemaVersion: 1,
      sourceRoot,
      instanceId,
      pid: process.pid,
      processStartUtc: new Date(Date.now() - process.uptime() * 1000).toISOString(),
      showWindow,
    }),
  );
  await lease.close();
  let child: ChildProcess | undefined;
  let stopped = false;
  let starting = false;
  let attempts = 0;
  let incarnation = "";
  let stopPromise: Promise<void> | undefined;
  let resolveStopped!: () => void;
  const stoppedPromise = new Promise<void>((done) => {
    resolveStopped = done;
  });
  const refresh = async () => {
    if (stopped || starting) return;
    starting = true;
    try {
      try {
        const request = (await readJson(join(directory, "stop.json"))) as {
          instanceId?: string;
          nonce?: string;
        };
        if (
          request.instanceId === instanceId &&
          typeof request.nonce === "string" &&
          request.nonce
        ) {
          await stop();
          return;
        }
      } catch (error) {
        if (!(error instanceof SyntaxError) && (error as NodeJS.ErrnoException).code !== "ENOENT")
          throw error;
      }
      if (child) return;
      const pair = (await readJson(join(directory, "session.json"))) as {
        schemaVersion: number;
        sourceRoot: string;
        frontendPid: number;
        serviceFile: string;
        hostInstanceId: string;
      };
      const service = (await readJson(pair.serviceFile)) as {
        sourceRoot: string;
        lane: string;
        pid: number;
        instanceId: string;
      };
      if (
        pair.schemaVersion !== 1 ||
        resolve(pair.sourceRoot).toLowerCase() !== sourceRoot.toLowerCase() ||
        service.lane !== "dev" ||
        resolve(service.sourceRoot).toLowerCase() !== sourceRoot.toLowerCase() ||
        service.instanceId !== pair.hostInstanceId ||
        !alive(service.pid) ||
        !alive(pair.frontendPid)
      )
        return;
      if (incarnation !== pair.hostInstanceId) {
        incarnation = pair.hostInstanceId;
        attempts = 0;
      }
      if (attempts >= 3) return;
      attempts++;
      child = spawn(
        join(sourceRoot, ".artifacts", "build", "Pe.Host.Tray", "Debug.R25", "Pe.Host.Tray.exe"),
        ["--dev", "--supervisor-file", path],
        { stdio: ["pipe", "ignore", "inherit"], windowsHide: true },
      );
      child.stdin?.on("error", () => {});
      child.once("error", (error) => {
        console.error("Dev tray could not start", error);
        child = undefined;
      });
      child.once("exit", (code) => {
        console.log(`Dev tray exited (${code})`);
        child = undefined;
      });
      console.log(
        `Dev tray supervisor ${process.pid}, native child ${child.pid}, checkout ${sourceRoot}`,
      );
    } catch (error) {
      if (!(error instanceof SyntaxError) && (error as NodeJS.ErrnoException).code !== "ENOENT")
        console.error("Dev tray pair refused", error);
    } finally {
      starting = false;
    }
  };
  const timer = setInterval(() => void refresh(), 1_000);
  await refresh();
  function stop() {
    return (stopPromise ??= (async () => {
      stopped = true;
      clearInterval(timer);
      const owned = child;
      if (owned && owned.exitCode === null) {
        await new Promise<void>((done) => {
          const timeout = setTimeout(() => owned.kill(), 5_000);
          owned.once("exit", () => {
            clearTimeout(timeout);
            done();
          });
          owned.stdin?.end();
        });
      }
      const current = (await readJson(path)) as { instanceId: string };
      if (current.instanceId === instanceId) await unlink(path);
      resolveStopped();
    })());
  }
  return { stop, stopped: stoppedPromise };
}
