import { spawn } from "node:child_process";
import { access, copyFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { isSea } from "node:sea";
import { fileURLToPath } from "node:url";
import { BrowserError } from "./errors.ts";

export const guardianFileName = "Pe.Browser.Guardian.exe";

/** Build-time packaging and source development share the one native source. */
export async function buildWindowsGuardian(directory: string): Promise<string> {
  if (process.platform !== "win32")
    throw new Error("Native browser guardian builds require Windows");
  await mkdir(directory, { recursive: true });
  const executable = join(directory, guardianFileName);
  const compiler = join(
    process.env.SystemRoot ?? "C:/Windows",
    "Microsoft.NET/Framework64/v4.0.30319/csc.exe",
  );
  await new Promise<void>((accept, reject) => {
    const child = spawn(
      compiler,
      [
        "/nologo",
        "/target:exe",
        "/optimize+",
        "/reference:System.Management.dll",
        `/out:${executable}`,
        fileURLToPath(new URL("../native/Guardian.cs", import.meta.url)),
      ],
      { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
    );
    let output = "";
    child.stdout.on("data", (chunk) => {
      output += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      output += String(chunk);
    });
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0 ? accept() : reject(new Error(`Native guardian compilation failed: ${output}`)),
    );
  });
  await copyFile(
    new URL("../native/Pe.Browser.Guardian.exe.config", import.meta.url),
    executable + ".config",
  );
  return executable;
}

export async function windowsGuardianExecutable(sourceDirectory: string): Promise<string> {
  // Source checkout execution has no prepare step. SEA must use its shipped app-local helper,
  // never a compiler fallback or an environment-selected executable.
  if (!isSea()) return buildWindowsGuardian(sourceDirectory);
  const executable = join(dirname(process.execPath), guardianFileName);
  for (const asset of [executable, executable + ".config"]) {
    try {
      await access(asset);
    } catch (cause) {
      throw new BrowserError(
        "UnsupportedRuntime",
        `Packaged browser guardian asset is missing: ${asset}; repair the application payload`,
        { outcome: "not-sent", cause },
      );
    }
  }
  return executable;
}

export async function assertPackagedProfileAvailable(profile: string): Promise<void> {
  const executable = await windowsGuardianExecutable("");
  await new Promise<void>((accept, reject) => {
    const child = spawn(executable, ["--profile-available", profile], {
      windowsHide: true,
      stdio: ["ignore", "ignore", "pipe"],
    });
    let errors = "";
    child.stderr.on("data", (chunk) => {
      errors = (errors + String(chunk)).slice(-8000);
    });
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("Profile process census timed out; launch refused"));
    }, 10000);
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      if (code === 0) accept();
      else if (code === 2)
        reject(
          new BrowserError("ProfileBusy", "Chrome already uses the requested profile; use attach", {
            outcome: "not-sent",
          }),
        );
      else reject(new Error(`Profile process census failed; launch refused: ${errors}`));
    });
  });
}
