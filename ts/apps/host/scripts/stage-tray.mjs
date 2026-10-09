// The tray belongs to the host payload; it has no independent service or startup entry.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../../../..");
const output = resolve(here, "../dist-installed/tray");
const result = spawnSync(
  "dotnet",
  [
    "publish",
    resolve(root, "dotnet/Pe.Host.Tray/Pe.Host.Tray.csproj"),
    "-c",
    "Release",
    "-r",
    "win-x64",
    "--self-contained",
    "true",
    "-p:PublishSingleFile=true",
    "-p:IncludeNativeLibrariesForSelfExtract=true",
    "-o",
    output,
  ],
  { cwd: root, stdio: "inherit", windowsHide: true },
);
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
const exe = resolve(output, "Pe.Host.Tray.exe");
assert(existsSync(exe) && statSync(exe).size > 0, `Tray publish did not produce ${exe}`);
console.log(`staged tray -> ${exe} (${statSync(exe).size} bytes)`);
