import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, expect, test } from "vite-plus/test";
import { connectBrowser, openBrowser, type BrowserPage } from "../src/browser.ts";
import { gestures } from "../src/gestures.ts";
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

const canvas =
  "data:text/html,<canvas width=300 height=200></canvas><script>const g=document.querySelector('canvas').getContext('webgl');(function f(){g.clear(g.COLOR_BUFFER_BIT);requestAnimationFrame(f)})()</script>";
const framesIn2s = (page: BrowserPage) =>
  page.evaluate(async () => {
    let frames = 0;
    let on = true;
    const tick = () => {
      frames++;
      if (on) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    await new Promise((done) => setTimeout(done, 2000));
    on = false;
    return frames;
  });

test("a visible window that leaves the screen keeps drawing", async () => {
  const session = await openBrowser({ mode: "visible" });
  try {
    const page = await session.page({ url: canvas });
    const { windowId } = (await session.sendRaw("Browser.getWindowForTarget", {
      targetId: page.targetId,
    })) as { windowId: number };
    await session.sendRaw("Browser.setWindowBounds", {
      windowId,
      bounds: { left: -5000, top: -5000 },
    });
    await new Promise((done) => setTimeout(done, 1000));
    expect(await framesIn2s(page)).toBeGreaterThan(60);
  } finally {
    await session.close();
  }
});

test("the launch viewport holds across screenshots and client reconnects", async () => {
  const want = { width: 1600, height: 900 };
  const session = await openBrowser({ viewport: want });
  try {
    const targetId = (await session.targets()).find((target) => target.type === "page")!.id;
    const read = async () => {
      const page = await session.page({ targetId });
      try {
        return await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
      } finally {
        await page.release();
      }
    };
    expect(session.info.viewport).toEqual(want);
    expect(await read()).toEqual(want);
    const page = await session.page({ targetId });
    const shots = await mkdtemp(join(tmpdir(), "pe-viewport-"));
    roots.push(shots);
    const g = gestures(page);
    expect((await g.shot(join(shots, "page.png"))).outcome).toBe("done");
    expect((await g.shot(join(shots, "body.png"), "body")).outcome).toBe("done");
    await page.release();
    expect(await read()).toEqual(want);
  } finally {
    await session.close();
  }
});
