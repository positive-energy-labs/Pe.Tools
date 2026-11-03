import { readFile, writeFile } from "node:fs/promises";

const pod = new URL("../../../../examples/pods/snowdon-circuits/", import.meta.url);
const page = new URL("pages/tour/", pod);
const read = async (name, base = page) =>
  (await readFile(new URL(name, base), "utf8")).replaceAll("\r\n", "\n");
const [template, calc, circuits, styles, instruments, app] = await Promise.all([
  read("index.source.html"),
  read("calc.mjs"),
  read("circuits.mjs"),
  read("styles.mjs"),
  read("instruments.mjs"),
  read("page.js"),
]);
// This authored graph contains only local, single-line imports. React and kit belong to each shell.
const body = (source) => source.replace(/^import[^\n]*\n/gm, "").replace(/^export /gm, "");
const shared = [calc, circuits, styles, instruments].map(body).join("\n");
const sources = { calc, circuits, styles, instruments, app };
const safeScript = (text) => text.replace(/<\/script/gi, "<\\/script");
const html = template
  .replace("<!-- KIT -->", () => '<script src="/pages/pe.js"></script>')
  .replace(
    "<!-- SOURCE -->",
    () =>
      `<script id="page-source" type="application/json">${safeScript(JSON.stringify(sources))}</script>`,
  )
  .replace("<!-- PAGE -->", () => `<script>${safeScript(shared)}\n${safeScript(app)}</script>`);

// Pod routes publish through publish-pod-route.ts and the generic buildRouteArtifact producer.
for (const [destination, text] of [[new URL("index.html", page), html]]) {
  if (process.argv.includes("--check")) {
    if ((await readFile(destination, "utf8")).replaceAll("\r\n", "\n") !== text)
      throw Error(`${destination.pathname} is stale; run pnpm --filter @pe/kit codegen:pages`);
  } else await writeFile(destination, text);
}
console.log(`Hosted Page: ${Buffer.byteLength(html)} bytes; portable export is owned by the host`);
