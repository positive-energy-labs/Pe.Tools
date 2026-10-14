import { execFile } from "node:child_process";

export type RedirectionTrust = "enforced" | "audit" | "off";

/** ProcessRedirectionTrustPolicy flags: bit 0 EnforceRedirectionTrust, bit 1 AuditRedirectionTrust. */
export const redirectionTrustOf = (flags: number): RedirectionTrust =>
  flags & 1 ? "enforced" : flags & 2 ? "audit" : "off";

// Node has no FFI and the SEA ships none, so a PowerShell one-shot calls GetProcessMitigationPolicy
// (kernel32, policy 16) by pid. `readAutostart` in machine.ts already spawns PowerShell the same way.
const script = (pid: number) =>
  `$ErrorActionPreference='Stop'; Add-Type 'using System; using System.Runtime.InteropServices; public class G { [DllImport("kernel32.dll",SetLastError=true)] public static extern IntPtr OpenProcess(uint a, bool i, int p); [DllImport("kernel32.dll")] public static extern bool CloseHandle(IntPtr h); [DllImport("kernel32.dll",SetLastError=true)] public static extern bool GetProcessMitigationPolicy(IntPtr h, int p, ref uint b, UIntPtr s); }'; $h=[G]::OpenProcess(0x1000,$false,${pid}); if($h -eq [IntPtr]::Zero){throw 'open failed'}; [uint32]$f=0; $ok=[G]::GetProcessMitigationPolicy($h,16,[ref]$f,[UIntPtr]::new(4)); [G]::CloseHandle($h)|Out-Null; if(-not $ok){throw 'policy read failed'}; $f`;

/** Null when the policy cannot be read (not Windows, or the process refused the query). */
export async function readRedirectionTrust(pid = process.pid): Promise<RedirectionTrust | null> {
  if (process.platform !== "win32") return null;
  try {
    const stdout = await new Promise<string>((resolve, reject) =>
      execFile(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-Command", script(pid)],
        { windowsHide: true, timeout: 15_000 },
        (error, out) => (error ? reject(error) : resolve(out)),
      ),
    );
    const flags = Number.parseInt(stdout.trim(), 10);
    return Number.isNaN(flags) ? null : redirectionTrustOf(flags);
  } catch {
    return null;
  }
}

let own: Promise<RedirectionTrust | null> | undefined;
/** This host's own policy, read once per process; the startup log and the machine reading share it. */
export const hostRedirectionTrust = () => (own ??= readRedirectionTrust());
