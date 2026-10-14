import { readFile, writeFile } from "node:fs/promises";

const page = new URL("../../../../examples/pods/snowdon-circuits/pages/tour/", import.meta.url);
const read = async (name) => (await readFile(new URL(name, page), "utf8")).replaceAll("\r\n", "\n");
const [template, calc, circuits, app] = await Promise.all([
  read("index.source.html"),
  read("calc.mjs"),
  read("circuits.mjs"),
  read("page.js"),
]);
const safeScript = (text) => text.replace(/<\/script/gi, "<\\/script");
const html = template
  .replace("<!-- KIT -->", () => '<script src="/pages/pe.js"></script>')
  .replace(
    "<!-- SOURCE -->",
    () =>
      `<script id="page-source" type="application/json">${safeScript(JSON.stringify({ calc, circuits, app }))}</script>`,
  )
  .replace(
    "<!-- PAGE -->",
    () =>
      `<script>${safeScript(calc.replace(/^export /gm, ""))}\n${safeScript(circuits.replace(/^import[^\n]*\n/gm, "").replace(/^export /gm, ""))}\n${safeScript(app)}</script>`,
  );
await writeFile(new URL("index.html", page), html);
console.log(`Hosted Page: ${Buffer.byteLength(html)} bytes; portable export is owned by the host`);
