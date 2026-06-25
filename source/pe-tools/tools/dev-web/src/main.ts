import { spawn, type ChildProcess } from "node:child_process";
import net from "node:net";
import path from "node:path";

type AgentName = "pea" | "peco";

interface DevWebOptions {
  agent: AgentName;
  host: string;
  frontendPort: number;
  workbenchPort: number;
  token: string;
  takeover: boolean;
  watch: boolean;
  forwardedArgs: string[];
}

const repoPeToolsRoot = path.resolve(import.meta.dirname, "..", "..", "..");

async function main(args: string[]): Promise<void> {
  const options = parseArgs(args);
  if (options.takeover) {
    await releasePort(options.frontendPort);
    await releasePort(options.workbenchPort);
  } else {
    await assertPortFree(options.frontendPort);
    await assertPortFree(options.workbenchPort);
  }

  const backend = startBackend(options);
  const workbenchUrl = `http://${options.host}:${options.workbenchPort}`;
  await waitForWorkbenchApi(backend, workbenchUrl, options.token);
  const frontend = startFrontend(options);
  const children = [backend, frontend];
  console.log(`${options.agent} web dev ${frontendUrl(options)}`);
  console.log(`${options.agent} workbench API ${workbenchUrl}`);

  await waitForExit(children);
}

function parseArgs(args: string[]): DevWebOptions {
  const agent = args.shift();
  if (agent !== "pea" && agent !== "peco")
    throw new Error("Usage: dev-web <pea|peco> web [options]");
  if (args[0] === "web") args.shift();

  const forwardedArgs: string[] = ["web"];
  let host = "127.0.0.1";
  let frontendPort = 5173;
  let workbenchPort = 43112;
  let token = "dev-loopback";
  let takeover = true;
  let watch = true;

  for (let index = 0; index < args.length; index++) {
    const arg = args[index]!;
    if (arg === "--host") {
      host = readValue(args, ++index, arg);
      forwardedArgs.push(arg, host);
    } else if (arg === "--port") {
      frontendPort = readPort(readValue(args, ++index, arg), arg);
    } else if (arg === "--workbench-port") {
      workbenchPort = readPort(readValue(args, ++index, arg), arg);
    } else if (arg === "--workbench-token") {
      token = readValue(args, ++index, arg);
    } else if (arg === "--no-takeover") {
      takeover = false;
    } else if (arg === "--no-watch") {
      watch = false;
    } else if (arg === "--watch") {
      watch = true;
    } else {
      forwardedArgs.push(arg);
    }
  }

  forwardedArgs.push("--host", host);
  forwardedArgs.push("--workbench-port", String(workbenchPort));
  forwardedArgs.push("--workbench-token", token);
  return { agent, host, frontendPort, workbenchPort, token, takeover, watch, forwardedArgs };
}

function readValue(args: string[], index: number, name: string): string {
  const value = args[index];
  if (!value || value.startsWith("-")) throw new Error(`Missing value for ${name}.`);
  return value;
}

function readPort(value: string, name: string): number {
  const port = Number(value);
  if (!Number.isInteger(port) || port <= 0 || port > 65535)
    throw new Error(`${name} must be a TCP port from 1 to 65535.`);
  return port;
}

function startBackend(options: DevWebOptions): ChildProcess {
  const appDirectory = path.join(
    repoPeToolsRoot,
    "apps",
    options.agent === "pea" ? "pea" : "pe-code",
  );
  const nodeArgs = [
    ...(options.watch ? ["--watch"] : []),
    "--import",
    "jiti/register",
    "src/main.ts",
    ...options.forwardedArgs,
  ];
  return spawnLogged(options.agent, "node", nodeArgs, {
    cwd: appDirectory,
    env: { ...process.env, PE_WORKBENCH_DEV_TOKEN: options.token },
  });
}

function startFrontend(options: DevWebOptions): ChildProcess {
  return spawnLogged(
    "web",
    "pnpm",
    [
      "--dir",
      repoPeToolsRoot,
      "--filter",
      "website",
      "exec",
      "vp",
      "dev",
      "--host",
      options.host,
      "--port",
      String(options.frontendPort),
      "--strictPort",
    ],
    {
      cwd: repoPeToolsRoot,
      env: {
        ...process.env,
        PE_WORKBENCH_AGENT_URL: `http://${options.host}:${options.workbenchPort}`,
        PE_WORKBENCH_DEV_TOKEN: options.token,
      },
    },
  );
}

function frontendUrl(options: DevWebOptions): string {
  const url = new URL(`http://${options.host}:${options.frontendPort}`);
  url.searchParams.set("w", String(options.workbenchPort));
  if (options.token !== "dev-loopback") url.searchParams.set("t", options.token);
  return url.toString();
}

async function waitForWorkbenchApi(
  backend: ChildProcess,
  workbenchUrl: string,
  token: string,
): Promise<void> {
  const url = `${workbenchUrl}/workbench/threads?token=${encodeURIComponent(token)}`;
  const started = Date.now();
  while (Date.now() - started < 20_000) {
    if (backend.exitCode !== null)
      throw new Error(`Backend exited before ${workbenchUrl} was ready.`);
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1_000) });
      if (response.ok) return;
    } catch {
      // Backend not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for ${workbenchUrl}.`);
}

function spawnLogged(
  label: string,
  command: string,
  args: string[],
  options: { cwd: string; env: NodeJS.ProcessEnv },
): ChildProcess {
  const spawnCommand = windowsCommand(command);
  const spawnArgs = windowsArgs(command, args);
  const child = spawn(spawnCommand, spawnArgs, {
    cwd: options.cwd,
    env: options.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout?.on("data", (chunk) => prefixLines(label, chunk, false));
  child.stderr?.on("data", (chunk) => prefixLines(label, chunk, true));
  child.on("error", (error) => console.error(`[${label}] ${error.message}`));
  return child;
}

function windowsCommand(command: string): string {
  if (process.platform !== "win32") return command;
  return command === "pnpm" ? "cmd.exe" : command;
}

function windowsArgs(command: string, args: string[]): string[] {
  if (process.platform !== "win32" || command !== "pnpm") return args;
  return ["/d", "/s", "/c", "pnpm.cmd", ...args];
}

function prefixLines(label: string, chunk: Buffer, stderr: boolean): void {
  const write = stderr
    ? process.stderr.write.bind(process.stderr)
    : process.stdout.write.bind(process.stdout);
  for (const line of chunk.toString("utf8").split(/\r?\n/)) {
    if (line.length > 0) write(`[${label}] ${line}\n`);
  }
}

async function waitForExit(children: ChildProcess[]): Promise<void> {
  let exiting = false;
  const shutdown = () => {
    if (exiting) return;
    exiting = true;
    for (const child of children) killChild(child);
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);

  await new Promise<void>((resolve) => {
    for (const child of children) {
      child.once("exit", (code) => {
        if (!exiting && code !== 0 && code !== null) process.exitCode = code;
        shutdown();
        resolve();
      });
    }
  });
}

function killChild(child: ChildProcess): void {
  if (child.killed || child.exitCode !== null) return;
  if (process.platform === "win32" && child.pid) {
    spawn("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    return;
  }
  child.kill("SIGTERM");
}

async function assertPortFree(port: number): Promise<void> {
  if (await canListen(port)) return;
  throw new Error(
    `Port ${port} is already in use. Re-run without --no-takeover to stop the owner.`,
  );
}

async function releasePort(port: number): Promise<void> {
  if (await canListen(port)) return;
  if (process.platform !== "win32")
    throw new Error(`Port ${port} is already in use and takeover is only implemented for Windows.`);
  for (const pid of await windowsPidsForPort(port)) {
    console.log(`taking over port ${port} from PID ${pid}`);
    await taskkill(pid);
  }
  await waitUntil(
    async () => canListen(port),
    3_000,
    `Timed out waiting for port ${port} to release.`,
  );
}

function canListen(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.listen(port, "127.0.0.1", () => server.close(() => resolve(true)));
  });
}

function windowsPidsForPort(port: number): Promise<number[]> {
  return new Promise((resolve, reject) => {
    const child = spawn("netstat.exe", ["-ano", "-p", "tcp"], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => (stdout += chunk));
    child.stderr?.on("data", (chunk) => (stderr += chunk));
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || `netstat exited ${code}`));
        return;
      }
      const pids = new Set<number>();
      for (const line of stdout.split(/\r?\n/)) {
        const parts = line.trim().split(/\s+/);
        if (parts.length < 5) continue;
        if (!parts[1]?.endsWith(`:${port}`)) continue;
        const pid = Number(parts[4]);
        if (Number.isInteger(pid) && pid > 0) pids.add(pid);
      }
      resolve([...pids]);
    });
  });
}

function taskkill(pid: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("taskkill.exe", ["/PID", String(pid), "/T", "/F"], {
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    child.stderr?.on("data", (chunk) => (stderr += chunk));
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr.trim() || `taskkill exited ${code} for PID ${pid}`));
    });
  });
}

async function waitUntil(
  check: () => Promise<boolean>,
  timeoutMs: number,
  message: string,
): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(message);
}

try {
  await main(process.argv.slice(2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
