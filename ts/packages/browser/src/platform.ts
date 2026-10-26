import { spawn, type ChildProcess } from "node:child_process";
import { access, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { BrowserError } from "./errors.ts";
import { windowsGuardianExecutable, assertPackagedProfileAvailable } from "./native-guardian.ts";
import { isSea } from "node:sea";
import { CLOSE_BUDGET_MS } from "./receipts.ts";
import { productRoot } from "@pe/host-contracts/service-identity";

export const browserHome = (home?: string) =>
  resolve(home ?? join(productRoot(), "state", "browser"));
export const defaultChromeProfile = () =>
  process.platform === "win32"
    ? join(
        process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local"),
        "Google",
        "Chrome",
        "User Data",
      )
    : process.platform === "darwin"
      ? join(homedir(), "Library", "Application Support", "Google", "Chrome")
      : join(process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "google-chrome");
export async function chromeExecutable(explicit?: string): Promise<string> {
  const candidates = explicit
    ? [explicit]
    : process.platform === "win32"
      ? [
          join(
            process.env.PROGRAMFILES ?? "C:/Program Files",
            "Google/Chrome/Application/chrome.exe",
          ),
          join(
            process.env["PROGRAMFILES(X86)"] ?? "C:/Program Files (x86)",
            "Microsoft/Edge/Application/msedge.exe",
          ),
        ]
      : process.platform === "darwin"
        ? ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"]
        : ["/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"];
  for (const candidate of candidates) {
    try {
      await access(candidate);
      return resolve(candidate);
    } catch {}
  }
  throw new BrowserError(
    "ExecutableNotFound",
    "Chrome executable not found; supply executablePath",
    { outcome: "not-sent" },
  );
}

export async function activeEndpoint(profile: string): Promise<string> {
  // ChromeDevTools/chrome-devtools-mcp BrowserManager.ts: explicit userDataDir discovery.
  // Only this endpoint file is read, never profile credentials or preferences.
  const [port, path] = (await readFile(join(profile, "DevToolsActivePort"), "utf8"))
    .trim()
    .split(/\r?\n/);
  if (
    !/^\d+$/.test(port ?? "") ||
    Number(port) < 1 ||
    Number(port) > 65535 ||
    !path?.startsWith("/devtools/browser/")
  )
    throw new Error("Invalid DevToolsActivePort");
  return `ws://127.0.0.1:${port}${path}`;
}

export async function assertProfileAvailable(profile: string): Promise<void> {
  if (isSea() && process.platform === "win32") {
    await assertPackagedProfileAvailable(profile);
    return;
  }
  let commands: string[] = [];
  if (process.platform === "win32") {
    const source = `[Console]::OutputEncoding=New-Object System.Text.UTF8Encoding($false);ConvertTo-Json -Compress -InputObject @(Get-CimInstance Win32_Process -Filter "Name='chrome.exe' OR Name='msedge.exe'" | Select-Object -ExpandProperty CommandLine)`;
    commands = await new Promise<string[]>((done, reject) => {
      const census = spawn(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-Command", source],
        { windowsHide: true, stdio: ["ignore", "pipe", "ignore"] },
      );
      let output = "";
      census.stdout?.on("data", (data) => {
        output += String(data);
      });
      const timer = setTimeout(() => {
        census.kill();
        reject(new Error("Profile process census timed out; launch refused"));
      }, 10000);
      census.once("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      census.once("exit", (code) => {
        clearTimeout(timer);
        if (code !== 0) reject(new Error("Profile process census failed; launch refused"));
        else {
          try {
            done(JSON.parse(output));
          } catch (error) {
            reject(error);
          }
        }
      });
    });
  } else if (process.platform === "linux") {
    for (const pid of await readdir("/proc"))
      if (/^\d+$/.test(pid)) {
        try {
          commands.push((await readFile(`/proc/${pid}/cmdline`, "utf8")).replaceAll("\0", " "));
        } catch {}
      }
  } else {
    try {
      await access(join(profile, "SingletonLock"));
      throw new BrowserError("ProfileBusy", "Chrome profile has an existing singleton lock", {
        outcome: "not-sent",
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  const normalized = resolve(profile).replaceAll("\\", "/").toLowerCase();
  if (
    commands.some(
      (command) => command && command.replaceAll("\\", "/").toLowerCase().includes(normalized),
    )
  )
    throw new BrowserError("ProfileBusy", "Chrome already uses the requested profile; use attach", {
      outcome: "not-sent",
    });
}

const quoteWindows = (arg: string) =>
  `"${arg.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, "$1$1")}"`;
export interface Guardian {
  process: ChildProcess;
  pid: number;
  stop(timeoutMs?: number): Promise<void>;
}
export async function launchGuarded(config: {
  id: string;
  directory: string;
  executable: string;
  args: string[];
  profile: string;
  temporary: boolean;
  lock: string;
}): Promise<Guardian> {
  await mkdir(config.directory, { recursive: true });
  let child: ChildProcess;
  if (process.platform === "win32") {
    const executable = await windowsGuardianExecutable(config.directory);
    // libuv's Windows child job must not kill the guardian with its keeper.
    child = spawn(
      executable,
      [
        config.executable,
        [config.executable, ...config.args].map(quoteWindows).join(" "),
        config.id,
        config.profile,
        String(config.temporary),
        config.lock,
        join(config.directory, "guardian-cleanup.txt"),
        String(CLOSE_BUDGET_MS),
      ],
      { detached: true, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] },
    );
  } else {
    const script = join(config.directory, "guardian.mjs");
    await writeFile(
      script,
      `import {spawn} from 'node:child_process';import fs from 'node:fs';const c=JSON.parse(process.argv[2]);const p=spawn(c.executable,c.args,{detached:true,stdio:'ignore'});console.log(p.pid);let stopped=false;function stop(){if(stopped)return;stopped=true;try{process.kill(-p.pid,'SIGKILL')}catch{};if(c.temporary&&fs.readFileSync(c.profile+'/.pe-browser-owner','utf8')===c.id)fs.rmSync(c.profile,{recursive:true,force:true});try{if(fs.readFileSync(c.lock,'utf8')===c.id)fs.unlinkSync(c.lock)}catch{};process.exit()}process.stdin.resume();process.stdin.on('end',stop);process.on('SIGTERM',stop);`,
    );
    child = spawn(process.execPath, [script, JSON.stringify(config)], {
      detached: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
  }
  let stderr = "";
  child.stderr?.on("data", (data) => {
    stderr = (stderr + String(data)).slice(-8000);
  });
  const pid = await new Promise<number>((accept, reject) => {
    let text = "";
    const timer = setTimeout(() => {
      child.stdin?.end();
      reject(new Error(`Guardian startup timed out: ${stderr}`));
    }, 15000);
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`Guardian exited ${code}: ${stderr}`));
    });
    child.stdout?.on("data", (data) => {
      text += String(data);
      const match = text.match(/(?:^|\n)(\d+)\r?\n/);
      if (match) {
        clearTimeout(timer);
        accept(Number(match[1]));
      }
    });
  });
  return {
    process: child,
    pid,
    stop: async (timeoutMs = CLOSE_BUDGET_MS) => {
      child.stdin?.end(`C${Math.max(1, Math.ceil(timeoutMs))}\n`);
      if (child.exitCode === null)
        await new Promise<void>((accept, reject) => {
          const timer = setTimeout(
            () =>
              reject(
                new BrowserError(
                  "CleanupTimeout",
                  `Native guardian did not finish within its ${timeoutMs}ms shutdown budget`,
                  { outcome: "unknown" },
                ),
              ),
            timeoutMs + 1000,
          );
          child.once("exit", () => {
            clearTimeout(timer);
            accept();
          });
        });
      if (process.platform === "win32") {
        let result: string;
        try {
          result = await readFile(join(config.directory, "guardian-cleanup.txt"), "utf8");
        } catch (cause) {
          throw new BrowserError(
            "CleanupFailed",
            `Native guardian exited without a cleanup certificate: ${stderr}`,
            { outcome: "unknown", cause },
          );
        }
        if (result !== "clean")
          throw new BrowserError("CleanupFailed", result, { outcome: "unknown" });
      }
    },
  };
}
