import { afterEach, expect, test } from "vite-plus/test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import {
  buildBuiltinClosure,
  buildBuiltinClosures,
  checkBuiltinClosure,
  writeBuiltinClosurePin,
} from "./route-source-hash.ts";
import { canonicalRouteJson } from "../../packages/agent-contracts/src/route-graph.ts";
import { builtinData } from "../../packages/agent-contracts/src/route-kernel.fixtures.ts";
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "route-u4-"));
  roots.push(root);
  const sources: Record<string, string> = {
    "entry.ts":
      'import config from "./config.json"; export { config }; import { body } from "./body"; import { schema } from "./schema"; import { render } from "./renderer"; import { seed } from "./seed"; import { codec } from "./codec"; import { migrate } from "./migration"; export const route = {body,schema,render,seed,codec,migrate};\n',
    "renderer.ts": 'import image from "./image.png"; export const render = () => image;\n',
    "config.json": '{"resolution":"v1"}\n',
  };
  for (const name of ["body", "schema", "seed", "codec", "migration"])
    sources[name + ".ts"] = `export const ${name === "migration" ? "migrate" : name} = () => 1;\n`;
  for (const [file, source] of Object.entries(sources)) writeFileSync(join(root, file), source);
  writeFileSync(join(root, "image.png"), Buffer.from([0, 255, 13, 10]));
  const options = {
    root,
    identityRoot: root,
    data: builtinData,
    variants: [
      { client: "web" as const, entry: join(root, "entry.ts") },
      { client: "pea" as const, entry: join(root, "entry.ts") },
    ],
  };
  return { root, sources, options, build: () => buildBuiltinClosure(options) };
}
test("actual resolver closes all module kinds; source, asset and imported JSON mutations change identity; EOLs do not", async () => {
  const f = fixture();
  const first = await f.build();
  expect(first.envelope.modules.map((m) => m.id)).toEqual(
    expect.arrayContaining([
      "body.ts",
      "schema.ts",
      "seed.ts",
      "codec.ts",
      "migration.ts",
      "renderer.ts",
      "image.png",
    ]),
  );
  expect(first.envelope.variants.map((v) => v.client)).toEqual(["pea", "web"]);
  expect(canonicalRouteJson(first)).not.toContain(f.root);
  for (const [file, source] of Object.entries(f.sources)) {
    writeFileSync(
      join(f.root, file),
      source + (file.endsWith("json") ? " " : "export const mutation = 42;\n"),
    );
    expect((await f.build()).fingerprint, file).not.toBe(first.fingerprint);
    writeFileSync(join(f.root, file), source);
  }
  writeFileSync(join(f.root, "image.png"), Buffer.from([0, 255, 10]));
  expect((await f.build()).fingerprint).not.toBe(first.fingerprint);
  writeFileSync(join(f.root, "image.png"), Buffer.from([0, 255, 13, 10]));
  for (const [file, source] of Object.entries(f.sources))
    writeFileSync(join(f.root, file), source.replaceAll("\n", "\r\n"));
  expect((await f.build()).fingerprint).toBe(first.fingerprint);
}, 60_000);
test("drift checks are read-only", async () => {
  const f = fixture();
  const first = await f.build();
  const path = join(f.root, "manifest.json");
  writeFileSync(path, canonicalRouteJson(first) + "\n");
  const before = readFileSync(path);
  checkBuiltinClosure(path, first);
  writeFileSync(join(f.root, "body.ts"), "export const body = () => 2;");
  const changed = await f.build();
  expect(() => checkBuiltinClosure(path, changed)).toThrow("drifted");
  expect(readFileSync(path)).toEqual(before);
});
test("explicit roots are portable and producer works in another process cwd", async () => {
  const f = fixture();
  const first = await f.build();
  expect((await fixture().build()).fingerprint).toBe(first.fingerprint);
  const producer = fileURLToPath(new URL("./route-source-hash.ts", import.meta.url));
  const jiti = new URL("../../node_modules/jiti/lib/jiti.mjs", import.meta.url).href;
  const runner = join(f.root, "probe.mjs");
  writeFileSync(
    runner,
    `import {createJiti} from ${JSON.stringify(jiti)}; const jiti=createJiti(import.meta.url); const {buildBuiltinClosure}=await jiti.import(${JSON.stringify(producer)}); console.log((await buildBuiltinClosure(${JSON.stringify(f.options)})).fingerprint);`,
  );
  mkdirSync(join(f.root, "elsewhere"));
  const cwd = process.cwd();
  expect(
    execFileSync(process.execPath, [runner], {
      cwd: join(f.root, "elsewhere"),
      encoding: "utf8",
    }).trim(),
  ).toBe(first.fingerprint);
  expect(process.cwd()).toBe(cwd);
}, 60_000);
test("computed imports refuse, external content integrity affects the envelope", async () => {
  const f = fixture();
  writeFileSync(
    join(f.root, "entry.ts"),
    "export const load = (path: string) => import(/* @vite-ignore */ path);",
  );
  await expect(f.build()).rejects.toThrow("Unresolved dynamic import");
  writeFileSync(join(f.root, "entry.ts"), 'export { body } from "external-library";');
  const build = (text: string) =>
    buildBuiltinClosure({
      ...f.options,
      externals: [{ id: "external-library", bytes: Buffer.from(text) }],
    });
  const first = await build("one");
  expect(first.envelope.externals).toHaveLength(1);
  expect((await build("two")).fingerprint).not.toBe(first.fingerprint);
  await expect(buildBuiltinClosure({ ...f.options, identityRoot: "relative" })).rejects.toThrow(
    "absolute path",
  );
});

test("builtin closures hash independently in declaration order", async () => {
  const f = fixture();
  const options = ["fans", "ducts"].map((key) => ({
    ...f.options,
    data: { ...builtinData, key, address: `/${key}`, work: { ...builtinData.work, route: key } },
  }));
  const closures = await buildBuiltinClosures(options);
  expect([...closures.keys()]).toEqual(["fans", "ducts"]);
  const alone = await buildBuiltinClosures([options[0]!]);
  expect(alone.get("fans")).toEqual(closures.get("fans"));
});

test("dev repairs stale builtin pins in one step and leaves fresh pins untouched", async () => {
  const f = fixture();
  const closure = await f.build();
  const path = join(f.root, "pin.json");
  writeFileSync(path, "stale");
  expect(() => checkBuiltinClosure(path, closure)).toThrow();
  const text = canonicalRouteJson(closure) + "\n";
  writeBuiltinClosurePin(path, text);
  checkBuiltinClosure(path, closure);
  const before = statSync(path).mtimeMs;
  writeBuiltinClosurePin(path, text);
  expect(statSync(path).mtimeMs).toBe(before);
});

// COMMON 27: files visible to the build are not route dependencies unless imported.
test("host package and Vite config edits do not repin a closure", async () => {
  const f = fixture();
  mkdirSync(join(f.root, "host"));
  const manifest = join(f.root, "host/package.json");
  const config = join(f.root, "vite.config.ts");
  writeFileSync(manifest, '{"version":"1","scripts":{"test":"one"}}');
  writeFileSync(config, "export default { build: { minify: false } };");
  const build = () => buildBuiltinClosure({ ...f.options, config: { configFile: config } });
  const first = await build();
  writeFileSync(manifest, '{"version":"2","scripts":{"test":"two"}}');
  expect((await build()).fingerprint).toBe(first.fingerprint);
  writeFileSync(config, "export default { build: { minify: true } };");
  expect((await build()).fingerprint).toBe(first.fingerprint);
  expect(first.envelope.inputs).toEqual([]);
  expect(first.envelope.modules.map((member) => member.id)).not.toContain("vite.config.ts");
});
