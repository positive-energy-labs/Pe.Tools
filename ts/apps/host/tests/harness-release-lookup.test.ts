import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { expect, test } from "vite-plus/test";
import { adapterCli } from "../src/harness/adapter.ts";

function home() {
  const root = mkdtempSync(join(tmpdir(), "pe-release-"));
  const user = join(root, "home");
  const releases = join(user, ".codex", "packages", "standalone", "releases");
  for (const version of ["0.9.0", "0.10.0", "0.10.0-rc.1"]) {
    mkdirSync(join(releases, version, "bin"), { recursive: true });
    writeFileSync(join(releases, version, "bin", "codex.exe"), "");
  }
  // A release folder without the exe is not an install.
  mkdirSync(join(releases, "0.12.0"), { recursive: true });
  mkdirSync(join(root, "local"));
  return { root, user, releases, env: { USERPROFILE: user, LOCALAPPDATA: join(root, "local") } };
}

test.runIf(process.platform === "win32")(
  "Codex's physical release folder is found, highest version wins, prerelease loses to its release",
  () => {
    const h = home();
    try {
      expect(adapterCli("codex", h.env)).toBe(join(h.releases, "0.10.0", "bin", "codex.exe"));
    } finally {
      rmSync(h.root, { recursive: true, force: true });
    }
  },
);

test.runIf(process.platform === "win32")(
  "the release folder is found by a process under RedirectionGuard beside an untraversable junction",
  () => {
    const h = home();
    try {
      const current = join(h.releases, "..", "current");
      spawnSync("cmd.exe", ["/c", "mklink", "/J", current, join(h.releases, "0.9.0")], {
        windowsHide: true,
      });
      // install.ts imports only node builtins; adapter.ts's pnpm-linked deps are themselves untraversable under the guard.
      const adapter = pathToFileURL(
        join(import.meta.dirname, "..", "src", "harness", "install.ts"),
      ).href;
      const script = join(h.root, "probe.ps1");
      writeFileSync(
        script,
        String.raw`
Add-Type 'using System; using System.Runtime.InteropServices; public class G { [DllImport("kernel32.dll")] public static extern bool SetProcessMitigationPolicy(int p, ref uint f, UIntPtr s); }'
[uint32]$f=1; if (-not [G]::SetProcessMitigationPolicy(16,[ref]$f,[UIntPtr]::new(4))) { exit 3 }
& '${process.execPath.replaceAll("'", "''")}' --input-type=module -e "import('${adapter}').then(m => console.log('FOUND ' + m.codexStandaloneRelease(process.env.PE_T_HOME)))"
`,
        "utf8",
      );
      const result = spawnSync(
        "powershell.exe",
        ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script],
        {
          env: { ...process.env, PE_T_HOME: h.env.USERPROFILE },
          encoding: "utf8",
          timeout: 30_000,
          windowsHide: true,
        },
      );
      expect(result.stdout + result.stderr).toContain(
        `FOUND ${join(h.releases, "0.10.0", "bin", "codex.exe")}`,
      );
    } finally {
      rmSync(h.root, { recursive: true, force: true });
    }
  },
  40_000,
);

test("Claude's official ~/.local/bin/claude.exe is a physical file, so it needs no release fallback", () => {
  const root = mkdtempSync(join(tmpdir(), "pe-claude-"));
  try {
    mkdirSync(join(root, ".local", "bin"), { recursive: true });
    writeFileSync(join(root, ".local", "bin", "claude.exe"), "");
    expect(adapterCli("claude", { USERPROFILE: root, LOCALAPPDATA: join(root, "l") })).toBe(
      join(root, ".local", "bin", "claude.exe"),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
