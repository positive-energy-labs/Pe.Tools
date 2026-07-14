import { execFile } from "node:child_process";
import { Effect } from "effect";

// ponytail: transitional Pe.Tools-only shim — retire (kill) legacy C# Pe.Host processes left
// running from the pre-VersionedApp layout so their file locks release and the port frees up
// before this host binds. The durable mechanism is host self-update (app.ts D3 follow-up);
// DELETE this module once the install base is past the legacy layout (~5 releases, added at
// 0.6.11-beta.3 era / 2026-07-14).

/** Legacy = a Pe.Host.exe running OUTSIDE the versioned root (old flat bin\host layout). */
export function isLegacyHostPath(executablePath: string): boolean {
  const normalized = executablePath.toLowerCase();
  return normalized.endsWith("\\pe.host.exe") && !normalized.includes("\\bin\\host\\versions\\");
}

const listHostProcesses = (): Promise<ReadonlyArray<{ pid: number; path: string }>> =>
  new Promise((resolve) => {
    execFile(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "Get-CimInstance Win32_Process -Filter \"Name='Pe.Host.exe'\" | Select-Object ProcessId,ExecutablePath | ConvertTo-Json -Compress",
      ],
      { windowsHide: true, timeout: 15_000 },
      (error, stdout) => {
        if (error || !stdout.trim()) return resolve([]);
        try {
          const parsed: unknown = JSON.parse(stdout);
          const rows = Array.isArray(parsed) ? parsed : [parsed];
          resolve(
            rows.flatMap((row) => {
              const record = row as { ProcessId?: number; ExecutablePath?: string | null };
              return typeof record.ProcessId === "number" && record.ExecutablePath
                ? [{ pid: record.ProcessId, path: record.ExecutablePath }]
                : [];
            }),
          );
        } catch {
          resolve([]);
        }
      },
    );
  });

/**
 * Best-effort, installed-lane-only: kill legacy-layout Pe.Host processes before this host binds.
 * Never touches versioned-root hosts (including ourselves) and swallows every failure — a legacy
 * host we cannot kill is the pre-existing status quo, not a reason to refuse to start.
 */
export const retireLegacyHosts = Effect.promise(async () => {
  if (process.env.PE_LANE?.trim().toLowerCase() !== "installed") return;
  for (const proc of await listHostProcesses()) {
    if (proc.pid === process.pid || !isLegacyHostPath(proc.path)) continue;
    try {
      process.kill(proc.pid);
      console.log(`retire-legacy-host: stopped pid ${proc.pid} at ${proc.path}`);
    } catch {
      console.log(`retire-legacy-host: could not stop pid ${proc.pid} at ${proc.path}`);
    }
  }
});
