// Same-camera pictures of PSC1 artifacts in /space (owned headless Chromium through @pe/browser). No Revit: the host
// serves each artifact from its scene cache by id. Every artifact gets the same URL viewport and pane size, so the
// camera is identical; all context representations of one request share its reach crop (the scene bounds).
// usage: node tools/space-proof/space-picture.ts <origin> <viewport> <outDir> <label>=<artifactId> [...]
//   viewport  orbit:perspective:yaw,elev,zoom@x,y,z (agent-contracts page-keys viewportCodec)
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { openBrowser } from "../../ts/packages/browser/src/index.ts";

const [origin, viewport, outDir, ...pairs] = process.argv.slice(2);
if (!origin || !viewport || !outDir || !pairs.length) throw Error("usage: space-picture.ts <origin> <viewport> <outDir> <label>=<id> ...");
await mkdir(outDir, { recursive: true });
const size = { width: 2560, height: 1440 };
const receipts: unknown[] = [];
const browser = await openBrowser({ mode: "headless" });
try {
  for (const pair of pairs) {
    const [label, id] = pair.split("=") as [string, string];
    const page = await browser.page({ url: "about:blank" });
    try {
      await page.send("Emulation.setDeviceMetricsOverride", { ...size, deviceScaleFactor: 1, mobile: false });
      await page.send("Page.navigate", { url: `${origin}/` });
      await new Promise((r) => setTimeout(r, 3000));
      await page.evaluate(() => {
        localStorage.setItem("pe.toolsWidth", "2300");
        return true;
      });
      const url = `${origin}/space?scene=${id}&viewport=${encodeURIComponent(viewport)}`;
      await page.send("Page.navigate", { url });
      const until = Date.now() + 180_000;
      let state: { ready: boolean; clip: { x: number; y: number; width: number; height: number } | null; text: string } | null = null;
      while (Date.now() < until) {
        await new Promise((r) => setTimeout(r, 1000));
        state = await page.evaluate(() => {
          const pane = document.querySelector('[data-pane-id="space-picture"]')?.getBoundingClientRect();
          const text = document.body?.textContent ?? "";
          return {
            ready: !!pane && !!document.querySelector("canvas") && !document.querySelector("[data-scene-pending]") && /elements\s*[\d,]+/.test(text),
            clip: pane ? { x: pane.x, y: pane.y, width: pane.width, height: pane.height } : null,
            text: (text.match(/scene.{0,120}/) ?? [""])[0],
          };
        });
        if (state.ready) break;
      }
      if (!state?.ready) throw Error(`${label}: /space did not settle: ${JSON.stringify(state)}`);
      await new Promise((r) => setTimeout(r, 4000)); // let the last frame paint
      const shot = (await page.send("Page.captureScreenshot", { format: "png", ...(state.clip ? { clip: { ...state.clip, scale: 1 } } : {}) })) as { data: string };
      const file = resolve(outDir, `${label}.png`);
      await writeFile(file, Buffer.from(shot.data, "base64"));
      receipts.push({ label, id, url, viewport, size, clip: state.clip, text: state.text });
      console.log(`${label}: ${file}`);
    } finally {
      await page.close();
    }
  }
} finally {
  await writeFile(resolve(outDir, "space-pictures.json"), JSON.stringify(receipts, null, 1));
  await browser.close();
}
