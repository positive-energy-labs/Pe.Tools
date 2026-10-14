import { spawn } from "node:child_process";
import { expect, test } from "vite-plus/test";
import { readRedirectionTrust, redirectionTrustOf } from "../src/redirection-trust.ts";

test("policy flags name enforce before audit", () => {
  expect(redirectionTrustOf(0)).toBe("off");
  expect(redirectionTrustOf(1)).toBe("enforced");
  expect(redirectionTrustOf(2)).toBe("audit");
  expect(redirectionTrustOf(3)).toBe("enforced");
});

test.runIf(process.platform === "win32")(
  "a process's own RedirectionGuard policy is read by pid, enforced or not",
  async () => {
    const guarded = spawn(
      "powershell.exe",
      [
        "-NoProfile",
        "-Command",
        "Add-Type 'using System; using System.Runtime.InteropServices; public class G { [DllImport(\"kernel32.dll\")] public static extern bool SetProcessMitigationPolicy(int p, ref uint f, UIntPtr s); }'; [uint32]$f=1; if (-not [G]::SetProcessMitigationPolicy(16,[ref]$f,[UIntPtr]::new(4))) { exit 3 }; 'ready'; Start-Sleep 60",
      ],
      { stdio: ["ignore", "pipe", "ignore"], windowsHide: true },
    );
    try {
      await new Promise<void>((resolve, reject) => {
        guarded.stdout!.on("data", (chunk) => String(chunk).includes("ready") && resolve());
        guarded.once("exit", (code) => reject(new Error(`guard setup exited ${code}`)));
      });
      expect(await readRedirectionTrust(guarded.pid!)).toBe("enforced");
      expect(["off", "audit", "enforced"]).toContain(await readRedirectionTrust());
    } finally {
      guarded.kill();
    }
  },
  30_000,
);
