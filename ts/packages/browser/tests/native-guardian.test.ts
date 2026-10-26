import { afterEach, expect, test, vi } from "vite-plus/test";
import {
  copyFile,
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { browserGuardianPlugin } from "../scripts/build-guardian.ts";
import { guardianFileName, assertPackagedProfileAvailable } from "../src/native-guardian.ts";
import { launchGuarded, type Guardian } from "../src/platform.ts";

const { runtime } = vi.hoisted(() => ({ runtime: { sea: false } }));
vi.mock("node:sea", () => ({ isSea: () => runtime.sea }));
const roots: string[] = [];
const guardians: Guardian[] = [];
const nodeExecutable = process.execPath;
afterEach(async () => {
  for (const guardian of guardians.splice(0))
    if (guardian.process.exitCode === null) await guardian.stop();
  runtime.sea = false;
  vi.unstubAllGlobals();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

async function config(root: string) {
  const directory = join(root, "session");
  const profile = join(root, "profile ü");
  await mkdir(profile, { recursive: true });
  const lock = join(root, "profile.lock");
  await writeFile(lock, "owned-test");
  await writeFile(join(profile, ".pe-browser-owner"), "owned-test");
  return {
    id: "owned-test",
    directory,
    executable: nodeExecutable,
    args: ["-e", "process.exit(0)"],
    profile,
    temporary: true,
    lock,
  };
}

test.skipIf(process.platform !== "win32")(
  "SEA refuses incomplete app-local assets without generating or compiling a replacement",
  async () => {
    const root = await mkdtemp(join(tmpdir(), "pe-guardian-missing-"));
    roots.push(root);
    const launch = await config(root);
    runtime.sea = true;
    vi.stubGlobal("process", { ...process, execPath: join(root, "pea.exe") });
    await expect(launchGuarded(launch)).rejects.toMatchObject({
      code: "UnsupportedRuntime",
      outcome: "not-sent",
    });
    expect(await readdir(launch.directory)).toEqual([]);
    await writeFile(join(root, guardianFileName), "incomplete payload");
    await expect(launchGuarded(launch)).rejects.toThrow(`${guardianFileName}.config`);
    expect(await readdir(launch.directory)).toEqual([]);
    expect(await readFile(launch.lock, "utf8")).toBe(launch.id);
  },
);

test.skipIf(process.platform !== "win32")(
  "pack hook delivers a runnable native helper and SEA joins it without PowerShell or compiler PATH",
  async () => {
    const root = await mkdtemp(join(tmpdir(), "pe-guardian-package-"));
    roots.push(root);
    await browserGuardianPlugin(root).closeBundle();
    expect((await readFile(join(root, guardianFileName))).subarray(0, 2).toString()).toBe("MZ");
    expect(await readFile(join(root, guardianFileName + ".config"), "utf8")).toContain(
      "Switch.System.IO.BlockLongPaths=false",
    );
    runtime.sea = true;
    vi.stubGlobal("process", {
      ...process,
      execPath: join(root, "Pe.Host.exe"),
      env: { ...process.env, PATH: "" },
    });
    const launch = await config(root);
    await assertPackagedProfileAvailable(launch.profile);
    const guardian = await launchGuarded(launch);
    guardians.push(guardian);
    await guardian.stop();
    expect(await readFile(join(launch.directory, "guardian-cleanup.txt"), "utf8")).toBe("clean");
    expect(await readdir(root)).not.toContain("profile ü");
    expect(await readdir(root)).not.toContain("profile.lock");
    expect(await readdir(launch.directory)).toEqual(
      expect.arrayContaining(["guardian-timeline.jsonl", "guardian-cleanup.txt"]),
    );
    expect(await readdir(launch.directory)).not.toContain(guardianFileName);
    const timeline = (await readFile(join(launch.directory, "guardian-timeline.jsonl"), "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(timeline.find((event) => event.phase === "job.empty")).toMatchObject({
      jobActive: 0,
      outstanding: [],
    });
    await unlink(join(root, guardianFileName + ".config"));
    await expect(assertPackagedProfileAvailable(launch.profile)).rejects.toThrow(
      "repair the application payload",
    );
  },
);

test.skipIf(process.platform !== "win32")(
  "prebuilt guardian keeps forced termination a cleanup failure after joining its handles",
  async () => {
    const root = await mkdtemp(join(tmpdir(), "pe-guardian-forced-"));
    roots.push(root);
    await browserGuardianPlugin(root).closeBundle();
    runtime.sea = true;
    vi.stubGlobal("process", { ...process, execPath: join(root, "pea.exe") });
    const launch = await config(root);
    // A real Win32_Process with Chrome's name tests WMI matching without borrowing a user browser.
    launch.executable = join(root, "chrome.exe");
    await copyFile(nodeExecutable, launch.executable);
    launch.args = [
      "-e",
      "setTimeout(() => {}, 60000)",
      "--",
      `--user-data-dir=${launch.profile.replaceAll("\\", "/").toUpperCase()}`,
    ];
    const guardian = await launchGuarded(launch);
    guardians.push(guardian);
    await expect(assertPackagedProfileAvailable(launch.profile)).rejects.toMatchObject({
      code: "ProfileBusy",
      outcome: "not-sent",
    });
    await expect(guardian.stop(1000)).rejects.toMatchObject({
      code: "CleanupFailed",
      outcome: "unknown",
    });
    const timeline = await readFile(join(launch.directory, "guardian-timeline.jsonl"), "utf8");
    expect(timeline).toContain('"phase":"job.empty"');
    expect(await readdir(root)).not.toContain("profile ü");
    expect(await readdir(root)).not.toContain("profile.lock");
  },
);
