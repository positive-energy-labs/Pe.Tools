// Scratch runner: serve proof.html with Vite, call the page's own window.__measure. Never committed.
import { createServer } from "vite-plus";
import tailwind from "@tailwindcss/vite";
import { openBrowser } from "@pe/browser";
import { fileURLToPath } from "node:url";
import { writeFileSync, readFileSync } from "node:fs";
const [label, out] = [process.argv[2]!, process.argv[3]!];
const root = fileURLToPath(new URL("../..", import.meta.url));
const server = await createServer({ configFile: false, root, plugins: [tailwind() as never],
  define: { __PE_WEB_RECEIPT_BUILD__: JSON.stringify({ version: "fixture", build: "proof", commit: "source" }) },
  resolve: { alias: { "#": root + "/src" }, dedupe: ["react", "react-dom"] },
  server: { host: "127.0.0.1", port: 0 }, logLevel: "error",
});
const browser = await openBrowser({ mode: "headless" });
try {
  await server.listen();
  const page = await browser.page();
  const errors: string[] = [];
  page.subscribe((e: any) => { if (e.method === "Runtime.exceptionThrown") errors.push(String(e.params.exceptionDetails?.exception?.description ?? e.params.exceptionDetails?.text).slice(0, 300)); });
  await page.send("Runtime.enable"); await page.send("Network.enable"); await page.send("Page.enable");
  await page.send("Network.setBlockedURLs", { urls: ["https://fonts.googleapis.com/*", "https://fonts.gstatic.com/*"] });
  await page.send("Page.navigate", { url: server.resolvedUrls!.local[0] + "src/__proof__/proof.html" });
  const t = Date.now(); let ready = false;
  while (Date.now() - t < 90_000) { ready = await page.evaluate(() => typeof (window as any).__ready === "function" && (window as any).__ready() === true).catch(() => false); if (ready) break; await new Promise((r) => setTimeout(r, 300)); }
  await page.evaluate(async () => { await (window as any).__act?.(); return null; }).catch((e: unknown) => errors.push("act " + String(e)));
  await new Promise((r) => setTimeout(r, 800));
  const measure = await page.evaluate(async () => { await document.fonts.ready; await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))); return JSON.parse(JSON.stringify((window as any).__measure())); });
  const shot = await page.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
  writeFileSync(`${out}/${label}.png`, Buffer.from((shot as any).data, "base64"));
  writeFileSync(`${out}/${label}.json`, JSON.stringify({ ready, errors, measure }, null, 1));
  console.log("RESULT " + JSON.stringify({ ready, errors: errors.slice(0, 4) }));
} finally { await browser.close(); await server.close(); }
