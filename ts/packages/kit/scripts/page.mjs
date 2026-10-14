import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";

const page = new URL("../../../../examples/pages/voltage-drop/", import.meta.url);
const read = (name) => readFile(new URL(name, page), "utf8");
const [template, calc, app, css, script] = await Promise.all([
  read("index.source.html"),
  read("calc.mjs"),
  read("page.js"),
  readFile(new URL("../dist/pe-kit.css", import.meta.url), "utf8"),
  readFile(new URL("../dist/pe-kit.js", import.meta.url), "utf8"),
]);
const sha = createHash("sha256").update(script).update(css).digest("hex");
const safeScript = (text) => text.replace(/<\/script/gi, "<\\/script");
const html = template
  .replace(
    "<!-- KIT -->",
    () =>
      `<meta name="pe-kit-sha256" content="${sha}"><style>${css}</style><script>${safeScript(script)}</script>`,
  )
  .replace(
    "<!-- SOURCE -->",
    () =>
      `<script id="page-source" type="application/json">${safeScript(JSON.stringify({ calc, app }))}</script>`,
  )
  .replace(
    "<!-- PAGE -->",
    () => `<script>${safeScript(calc.replace(/^export /gm, ""))}\n${safeScript(app)}</script>`,
  );
await writeFile(new URL("index.html", page), html);
console.log(`Portable Page: ${Buffer.byteLength(html)} bytes; kit sha256 ${sha}`);
