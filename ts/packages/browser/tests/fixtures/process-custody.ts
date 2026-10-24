import { execFile } from "node:child_process";
import { promisify } from "node:util";

export interface ProcessIdentity {
  pid: number;
  started: string;
  executable: string;
  command: string;
}

function powershell<T>(script: string, input?: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "$ErrorActionPreference='Stop';[Console]::OutputEncoding=New-Object System.Text.UTF8Encoding($false);[Console]::InputEncoding=New-Object System.Text.UTF8Encoding($false);" +
          script,
      ],
      { windowsHide: true, timeout: 10_000 },
      (error, stdout) => {
        if (error) reject(error);
        else {
          try {
            resolve(JSON.parse(stdout));
          } catch (error) {
            reject(error);
          }
        }
      },
    );
    child.stdin?.end(input === undefined ? "" : JSON.stringify(input));
  });
}

export async function processIdentities(pids: number[]): Promise<ProcessIdentity[]> {
  if (!pids.length) return [];
  if (pids.some((pid) => !Number.isSafeInteger(pid) || pid <= 0))
    throw new Error("Invalid process identity selector");
  if (process.platform !== "win32") {
    const result = await promisify(execFile)("ps", [
      "-p",
      pids.join(","),
      "-o",
      "pid=",
      "-o",
      "lstart=",
      "-o",
      "args=",
    ]).catch((error) => {
      if (error.code === 1 && !error.stdout.trim()) return { stdout: "" };
      throw error;
    });
    return result.stdout.split("\n").flatMap((line) => {
      const match = line.match(/^\s*(\d+)\s+(.{24})\s+(.*)$/);
      return match
        ? [
            {
              pid: Number(match[1]),
              started: match[2]!,
              executable: "posix-ps",
              command: match[3]!,
            },
          ]
        : [];
    });
  }
  return powershell(`ConvertTo-Json -Compress -InputObject @(Get-CimInstance Win32_Process -Filter '${pids.map((pid) => `ProcessId=${pid}`).join(" OR ")}' | ForEach-Object {
    $row=$_; $p=Get-Process -Id $row.ProcessId -ErrorAction SilentlyContinue;
    if($p) { try {
      $null=$p.Handle;
      if(!$p.HasExited) { @{pid=$p.Id;started=$p.StartTime.ToUniversalTime().Ticks.ToString();executable=$p.Path;command=$row.CommandLine} }
    } finally { $p.Dispose() } }
  })`);
}

export function sameProcess(expected: ProcessIdentity, actual: ProcessIdentity): boolean {
  return (
    expected.pid === actual.pid &&
    expected.started === actual.started &&
    expected.executable.toLowerCase() === actual.executable.toLowerCase() &&
    expected.command === actual.command
  );
}

/** Pin the Windows process handle before identity comparison; never kill by a historical PID. */
export async function rescueProcess(expected: ProcessIdentity): Promise<boolean> {
  // POSIX has no portable process handle here. A real survivor still fails acceptance; refuse PID-only rescue.
  if (process.platform !== "win32") return false;
  return powershell(
    `$expected=[Console]::In.ReadToEnd() | ConvertFrom-Json;
    $p=Get-Process -Id $expected.pid -ErrorAction SilentlyContinue; $killed=$false;
    if($p) { try {
      $null=$p.Handle;
      if(!$p.HasExited -and $p.StartTime.ToUniversalTime().Ticks.ToString() -eq $expected.started -and $p.Path -eq $expected.executable) {
        $p.Kill(); if(!$p.WaitForExit(5000)) { throw 'Owned process rescue did not finish' }; $killed=$true;
      }
    } finally { $p.Dispose() } }
    ConvertTo-Json -Compress -InputObject $killed`,
    expected,
  );
}
