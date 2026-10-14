import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { expect, test } from "vite-plus/test";
import { relaunchOutOfGuard } from "../src/redirection-trust.ts";

test("only an enforced host relaunches, once; a still-enforced child continues guarded", () => {
  const root = mkdtempSync(join(tmpdir(), "pe-relaunch-"));
  const marker = join(root, "sub", "guard-relaunch.stamp");
  const launches: string[] = [];
  const log: string[] = [];
  const run = (trust: "enforced" | "audit" | "off" | null) =>
    relaunchOutOfGuard({
      trust,
      exe: "C:\Pe\Pe.Host.exe",
      marker,
      log: (l) => log.push(l),
      launch: (e) => launches.push(e),
    });
  try {
    expect([run("off"), run("audit"), run(null)]).toEqual([false, false, false]);
    expect(launches).toEqual([]);
    expect(run("enforced")).toBe(true);
    expect(launches).toEqual(["C:\Pe\Pe.Host.exe"]);
    expect(run("enforced")).toBe(false);
    expect(launches).toHaveLength(1);
    expect(log.at(-1)).toContain("continuing guarded");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test.runIf(process.platform === "win32")(
  "a guarded process hands off through explorer and the child reads unguarded",
  () => {
    const root = mkdtempSync(join(tmpdir(), "pe-relaunch-"));
    try {
      const mod = pathToFileURL(
        join(import.meta.dirname, "..", "src", "redirection-trust.ts"),
      ).href;
      const script = join(root, "t.ps1");
      writeFileSync(
        script,
        String.raw`
Add-Type -TypeDefinition 'using System; using System.IO; using System.Runtime.InteropServices; public class C { [DllImport("kernel32.dll")] static extern bool GetProcessMitigationPolicy(IntPtr h, int p, out uint f, int s); [DllImport("kernel32.dll")] static extern IntPtr GetCurrentProcess(); public static void Main() { uint f; GetProcessMitigationPolicy(GetCurrentProcess(), 16, out f, 4); File.WriteAllText(Path.Combine(Path.GetDirectoryName(System.Reflection.Assembly.GetExecutingAssembly().Location), "child.txt"), f.ToString()); } }' -OutputType ConsoleApplication -OutputAssembly "$env:PE_T_ROOT\child.exe"
Add-Type 'using System; using System.Runtime.InteropServices; public class G { [DllImport("kernel32.dll")] public static extern bool SetProcessMitigationPolicy(int p, ref uint f, UIntPtr s); }'
[uint32]$f=1; if (-not [G]::SetProcessMitigationPolicy(16,[ref]$f,[UIntPtr]::new(4))) { exit 3 }
& '${process.execPath.replaceAll("'", "''")}' --input-type=module -e "import('${mod}').then(m => { console.log('EXIT=' + m.relaunchOutOfGuard({ trust: 'enforced', exe: process.env.PE_T_EXE, marker: process.env.PE_T_ROOT + '/m.stamp' })) })"
`,
        "utf8",
      );
      const result = spawnSync(
        "powershell.exe",
        ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script],
        {
          env: { ...process.env, PE_T_ROOT: root, PE_T_EXE: join(root, "child.exe") },
          encoding: "utf8",
          timeout: 60_000,
          windowsHide: true,
        },
      );
      expect(result.stdout + result.stderr).toContain("EXIT=true");
      const child = join(root, "child.txt");
      for (let i = 0; i < 100 && !existsSync(child); i++)
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
      expect(readFileSync(child, "utf8")).toBe("0");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
  90_000,
);
