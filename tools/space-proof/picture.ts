// Same-camera /ducts pictures of one opened system under each context representation, in owned headless Chromium
// through @pe/browser (never a preview tab: it fires no requestAnimationFrame). Read-only against the native session.
// usage (node >= 22, from anywhere): node tools/space-proof/picture.ts <origin> <target.json> <system> <outDir> [reps]
//   target.json  {"kind":"open","ref":{"session":"<bridge session>","openId":"<openId>"}}
//   reps         comma list from link-boxes,triangle-boxes,oriented,meshes (default link-boxes,triangle-boxes,oriented)
// Each representation gets a fresh navigation at the same viewport size; the picture fits the camera to the focus
// instances only (scene/framing.ts framingPoints), so the camera is the same whatever context is drawn. Writes
// <outDir>/<system>-<rep>.png and <outDir>/<system>-pictures.json (URL, canvas size, overlay text, timings).
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { openBrowser } from "../../ts/packages/browser/src/index.ts";

const [origin, targetFile, system, outDir, repsArg] = process.argv.slice(2);
if (!origin || !targetFile || !system || !outDir) throw Error("usage: picture.ts <origin> <target.json> <system> <outDir> [reps]");
// The UI offers only the default and full meshes (comparison buttons withheld); other representations render from artifacts.
const reps = (repsArg ?? "link-boxes").split(",");
// The picture's comparison control (scene/picture/model.tsx): the advisory label per representation, and the
// button that reaches it from the interim default. Meshes go through "Read detailed context".
const LABEL: Record<string, string> = {
  "link-boxes": "Link-frame envelopes",
  "triangle-boxes": "Building envelopes",
  oriented: "Simplified context",
  meshes: "Detailed context",
};
const PATH: Record<string, string[]> = {
  "link-boxes": [],
  "triangle-boxes": ["Use building envelopes"],
  oriented: ["Use building geometry"],
  meshes: ["Read detailed context"],
};
const target = JSON.parse(await readFile(targetFile, "utf8"));
const url = `${origin}/ducts?target=${encodeURIComponent(JSON.stringify(target))}&system=${encodeURIComponent(JSON.stringify([system]))}`;
const size = { width: 2560, height: 1440 };
await mkdir(outDir, { recursive: true });
const stem = system.replaceAll(" ", "");
const receipts: unknown[] = [];
const browser = await openBrowser({ mode: "headless" });
try {
  for (const rep of reps) {
    const started = Date.now();
    const page = await browser.page({ url: "about:blank" });
    // Every host call the page makes, so a re-capture loop names its trigger (Chadds SA 7 triangle-boxes, 2026-10-31).
    const calls: unknown[] = [];
    const t0 = Date.now();
    await page.send("Network.enable", {});
    const unsubscribe = page.subscribe((event) => {
      const e = event as { method?: string; params?: { request?: { url?: string; postData?: string; headers?: Record<string, string> }; requestId?: string; response?: { status?: number; url?: string } } };
      const url = e.params?.request?.url ?? e.params?.response?.url ?? "";
      if (!/\/call|\/captures|\/events|space-scenes/.test(url)) return;
      if (e.method === "Network.requestWillBeSent")
        calls.push({ t: (Date.now() - t0) / 1000, id: e.params?.requestId, url, body: (e.params?.request?.postData ?? "").slice(0, 600) });
      else if (e.method === "Network.responseReceived")
        calls.push({ t: (Date.now() - t0) / 1000, id: e.params?.requestId, status: e.params?.response?.status });
    });
    try {
      await page.send("Emulation.setDeviceMetricsOverride", { ...size, deviceScaleFactor: 1, mobile: false });
      // Pane sizes are the product's own persisted widths (workbench pe.toolsWidth, ducts proto-e-sidebar): set once,
      // the same for every representation, so the picture pane is wide and the camera (fit to focus and aspect) is equal.
      await page.send("Page.navigate", { url: `${origin}/` });
      await new Promise((r) => setTimeout(r, 3000));
      await page.evaluate(() => {
        localStorage.setItem("pe.toolsWidth", "2300");
        localStorage.setItem("proto-e-sidebar", "280");
        return true;
      });
      await page.send("Page.navigate", { url });
      const settle = async (label: string, timeoutMs: number) => {
        const until = Date.now() + timeoutMs;
        let last: unknown = null;
        while (Date.now() < until) {
          // Short evaluates only: never wait inside one.
          last = await page.evaluate((want: string) => {
            // The advisory names the drawn representation (model.tsx); a busy control means a read is in flight.
            const text = document.body?.textContent ?? "";
            // The advisory and controls live in the folded "scene completeness" floater: open it once.
            const fold = document.querySelector<HTMLButtonElement>('button[aria-label="scene completeness"]');
            if (fold && !text.includes(want) && fold.getAttribute("aria-expanded") !== "true") fold.click();
            const canvas = document.querySelector("canvas");
            const pending = !!document.querySelector("[data-scene-pending]");
            const busy = !!document.querySelector('button[aria-busy="true"]');
            const pane = document.querySelector('[data-pane-id="e-picture"]')?.getBoundingClientRect();
            const clip = pane ? { x: pane.x, y: pane.y, width: pane.width, height: pane.height } : null;
            return { ready: !!canvas && !pending && !busy && text.includes(want), text: text.slice(0, 400), pending, busy, clip, href: location.href };
          }, label);
          if ((last as { ready: boolean }).ready) return last;
          await new Promise((r) => setTimeout(r, 1000));
        }
        throw Error(`${system} ${rep}: not settled on "${label}" within ${timeoutMs} ms: ${JSON.stringify(last)}`);
      };
      await settle(LABEL["link-boxes"]!, 300_000);
      for (const button of PATH[rep] ?? []) {
        const clicked = await page.evaluate((name: string) => {
          const b = document.querySelector<HTMLButtonElement>(`[aria-label="${name}"]`);
          b?.click();
          return !!b;
        }, button);
        if (!clicked) throw Error(`${system} ${rep}: no "${button}" button`);
        await new Promise((r) => setTimeout(r, 1500));
      }
      const state = await settle(LABEL[rep]!, 240_000); // cold triangle-boxes 79 s, meshes 64 s on Chadds SA 7 (10-28)
      await new Promise((r) => setTimeout(r, 2000)); // let the last frame paint
      const clip = (state as { clip: { x: number; y: number; width: number; height: number } | null }).clip;
      const shot = (await page.send("Page.captureScreenshot", { format: "png", ...(clip ? { clip: { ...clip, scale: 1 } } : {}) })) as { data: string };
      const file = resolve(outDir, `${stem}-${rep}.png`);
      await writeFile(file, Buffer.from(shot.data, "base64"));
      receipts.push({ system, rep, file, url, viewport: size, state, seconds: (Date.now() - started) / 1000 });
      console.log(`${system} ${rep}: ${file} (${((Date.now() - started) / 1000).toFixed(1)} s)`);
    } finally {
      unsubscribe();
      await writeFile(resolve(outDir, `${stem}-${rep}-calls.json`), JSON.stringify(calls, null, 1));
      await page.close();
    }
  }
} finally {
  await writeFile(resolve(outDir, `${stem}-pictures.json`), JSON.stringify(receipts, null, 1));
  await browser.close();
}
