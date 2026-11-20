// Fixture linkage only, never J-V3 acceptance. No native/SDK transport.
import { mkdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { spawn, execFileSync } from "node:child_process";
import { createServer } from "vite-plus";
import { openBrowser } from "@pe/browser";
import { ductsDocumentSchema } from "@pe/ducts-contract/system-work";
import { ductsDesign } from "@pe/duct-systems-contract/ducts";
import { fansDocumentSchema } from "@pe/fans-contract/fans";
import { firmLayer, workLayer } from "@pe/ducts-host/ducts-inputs";
import { resolveCriteria } from "@pe/ducts-domain/calc/inputs";
import { designCalc } from "@pe/duct-systems-web/design-calc";
import { sheetCells } from "../../apps/web/src/route/slots/sheet/index.ts";

const dir = resolve("../.artifacts/runs/field-20261118/J-V3", String(Date.now()));
await mkdir(dir, { recursive: true });
const work = ductsDocumentSchema.parse({ criteria: { autoJoinGapIn: { edit: { value: 9, by: "human" } } } });
const tiers = [{ tier: "firm", home: "fixture-firm", name: "ducts", path: "fixture-firm/Settings/ducts.json", sha256: "fixture", json: { criteria: { autoJoinGapIn: 5 } } }];
const firm = firmLayer({ present: false } as never, tiers as never);
const read = { criteria: resolveCriteria(workLayer(ductsDesign(work, fansDocumentSchema.parse({}))), firm), settings: { ducts: tiers },
  firm: { present: true, version: "fixture", path: "fixture-firm/Settings/ducts.json" } };
const evidence = { head: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  when: new Date().toISOString(), lane: "fixture linkage only; never J-V3 acceptance", read, work };
const inputs = join(dir, "pricing.json");
await writeFile(inputs, JSON.stringify(evidence, null, 2));
if (process.argv.includes("--witness")) {
  const priced = read.criteria.autoJoinGapIn;
  const drawn = sheetCells(designCalc, { rows: [], work, read })
    .filter(c => c.binding.endsWith(".autoJoinGapIn"))
    .map(c => ({ binding: c.binding, value: c.value, source: c.source }));
  const ok = drawn.length === 1 && drawn[0].value === priced.value && drawn[0].source.toLowerCase() === priced.source.toLowerCase();
  const output = JSON.stringify({ lane: "deterministic witness, not browser", head: evidence.head, priced, drawn,
    result: ok ? "PROVEN witness" : "FALSIFIED MAP V3: sheet differs from pricing or duplicates the criterion" }, null, 2);
  await writeFile(join(dir, "output.log"), output);
  console.log(output, `\nJ-V3 evidence: ${dir}`);
  process.exit(ok ? 0 : 1);
}
let browser: Awaited<ReturnType<typeof openBrowser>> | undefined;
const server = await createServer({ configFile: false, root: resolve("."),
  optimizeDeps: { include: ["react", "react-dom/client", "@effect/atom-react", "@tanstack/react-router", "effect", "lucide-react", "zod", "@base-ui/react/dialog", "@base-ui/react/input", "@base-ui/react/popover", "@base-ui/react/tooltip", "@tanstack/react-hotkeys", "clsx", "tailwind-merge"] },
  esbuild: { jsx: "automatic" }, resolve: { dedupe: ["react", "react-dom"] },
  server: { host: "127.0.0.1", port: 0 }, plugins: [{ name: "jv3-fixture", configureServer(s) {
    s.middlewares.use(async (req, res, next) => {
      if (req.url === "/jv3-inputs") { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify({ read, work })); return; }
      if (req.url?.startsWith("/duct-systems")) {
        res.setHeader("Content-Type", "text/html");
        res.end(await s.transformIndexHtml("/duct-systems", '<html><body><div id="root"></div><script type="module" src="/tests/journey-fixtures/jv3-field-fixture.tsx"></script></body></html>')); return;
      }
      next();
    });
  } }] });
try {
  await server.listen();
  const web = new URL("/duct-systems", server.resolvedUrls!.local[0]).href;
  browser = await openBrowser({ mode: "headless" });
  const page = await browser.page();
  const target = page.targetId;
  await page.release();
  await writeFile(join(dir, "custody.json"), JSON.stringify({ head: evidence.head, web,
    browser: browser.info.id, target, native: false, simulated: true,
    command: "node --import jiti/register tests/journey-fixtures/jv3-field-host.ts" }, null, 2));
  const env = { ...process.env, E2E_LINKAGE_MODE: "fixture-linkage", E2E_TARGET: "", E2E_SESSION: "", E2E_WEB: web, CDP_PORT: new URL(browser.info.endpoint).port,
    CDP_TARGET: target, JV3_PRICING_FILE: inputs, E2E_LABEL: `base-${Date.now()}` };
  const child = spawn(process.execPath, ["--import", "jiti/register", "products/duct-systems/web/journeys/jv3-field.ts", "--seed", "20261118"], { env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true, timeout: 150_000 });
  let output = "";
  for (const stream of [child.stdout!, child.stderr!]) stream.on("data", b => { output += b; process.stdout.write(b); });
  process.exitCode = await new Promise<number>((done, reject) => { child.once("error", reject); child.once("exit", c => done(c ?? 1)); });
  await writeFile(join(dir, "output.log"), output);
} finally {
  await browser?.close();
  await server.close();
  await writeFile(join(dir, "cleanup.json"), JSON.stringify({ browserClosed: true, serverClosed: true, when: new Date().toISOString() }));
  console.log(`J-V3 evidence: ${dir}`);
}
