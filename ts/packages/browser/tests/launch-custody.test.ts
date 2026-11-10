import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, expect, test } from "vite-plus/test";
import { connectBrowser } from "../src/browser.ts";
import { launchGuarded } from "../src/platform.ts";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

// The native guardian's job is the shape `vp run` gives a task: KILL_ON_JOB_CLOSE and no breakaway.
test.skipIf(process.platform !== "win32")(
  "a session launch survives the job of the process that launched it",
  async () => {
    const root = await mkdtemp(join(tmpdir(), "pe-launch-custody-"));
    roots.push(root);
    const home = join(root, "home");
    const idFile = join(root, "id.txt");
    const profile = join(root, "launcher-profile");
    await mkdir(profile, { recursive: true });
    await writeFile(join(root, "launcher.lock"), "launcher");
    const launcher = await launchGuarded({
      id: "launcher",
      directory: join(root, "job"),
      executable: process.execPath,
      args: [
        fileURLToPath(new URL("./fixtures/session-launcher.ts", import.meta.url)),
        home,
        idFile,
      ],
      profile,
      temporary: false,
      lock: join(root, "launcher.lock"),
    });
    let id = "";
    for (const deadline = Date.now() + 60_000; !id && Date.now() < deadline; )
      id = await readFile(idFile, "utf8").catch(async () => {
        await new Promise((done) => setTimeout(done, 200));
        return "";
      });
    expect(id).not.toBe("");
    await new Promise((done) => setTimeout(done, 1000));
    // Terminates every process still in the launcher's job.
    await launcher.stop();
    const session = await connectBrowser(id, { home });
    try {
      expect((await session.targets()).length).toBeGreaterThan(0);
    } finally {
      await session.close();
    }
  },
);
