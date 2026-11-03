import { expect, test, vi } from "vite-plus/test";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { buildRouteArtifact, routeModuleHash } from "./route-module-hash.ts";
import { routeSourceHash } from "./route-source-hash.ts";

const id = fileURLToPath(new URL("./src/captures/graph.ts", import.meta.url));

test("build stamps actual source bytes rather than the directory hash", async () => {
  const source = readFileSync(id, "utf8");
  const transform = routeModuleHash().transform as Function;
  const result = await transform(source, id);
  expect(result.code).toContain(`moduleHash: "${routeSourceHash(source)}"`);
  expect(result.code).not.toContain("ROUTE_DIRECTORY");
});

test("source identity normalizes CRLF for strings, Buffers and Uint8Arrays", () => {
  const lf = 'directory: { title: "Caf\u00e9" }\n';
  const crlf = lf.replaceAll("\n", "\r\n");
  expect(routeSourceHash(crlf)).toBe(routeSourceHash(lf));
  expect(routeSourceHash(Buffer.from(crlf))).toBe(routeSourceHash(lf));
  expect(routeSourceHash(new TextEncoder().encode(crlf))).toBe(routeSourceHash(lf));
  expect(routeSourceHash(`${lf}// changed`)).not.toBe(routeSourceHash(lf));
});

test("startup and production bundling wait for route generation", async () => {
  const generate = vi.fn(async () => {});
  await (routeModuleHash(generate).buildStart as Function)();
  expect(generate).toHaveBeenCalledOnce();
});

test("graph edits generate before invalidating graph and directory together", async () => {
  const order: string[] = [];
  const update = routeModuleHash(async () => {
    order.push("generated");
  }).handleHotUpdate as Function;
  const server = {
    moduleGraph: { invalidateAll: () => order.push("invalidated") },
    ws: {
      send: (event: unknown) => {
        expect(event).toEqual({ type: "full-reload" });
        order.push("reload");
      },
    },
  };
  expect(await update({ file: id, server })).toEqual([]);
  expect(order).toEqual(["generated", "invalidated", "reload"]);
  order.length = 0;
  expect(await update({ file: id.replace("graph.ts", "page.ts"), server })).toBeUndefined();
  expect(order).toEqual([]);
});

test("generation failure stops bundling and never reloads a stale directory", async () => {
  const plugin = routeModuleHash(async () => {
    throw Error("bad graph");
  });
  await expect((plugin.buildStart as Function)()).rejects.toThrow("bad graph");
  const send = vi.fn();
  await expect(
    (plugin.handleHotUpdate as Function)({ file: id, server: { ws: { send } } }),
  ).rejects.toThrow("bad graph");
  expect(send).not.toHaveBeenCalled();
});

test("requests during graph regeneration wait for the matching directory", async () => {
  let finish!: () => void;
  const plugin = routeModuleHash(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const start = (plugin.buildStart as Function)();
  await Promise.resolve();
  let transformed = false;
  const request = (plugin.transform as Function)(readFileSync(id, "utf8"), id).then(() => {
    transformed = true;
  });
  await Promise.resolve();
  expect(transformed).toBe(false);
  finish();
  await start;
  await request;
  expect(transformed).toBe(true);
});

// This fixture is emitted and evaluated as real JS. Its generated test inputs stay ignored.
import { builtinData, entries } from "../../packages/agent-contracts/src/route-kernel.fixtures.ts";
import {
  createRouteAdmission,
  createAdmittedRouteRegistry,
} from "../../packages/agent-contracts/src/route-module.ts";
import { join } from "node:path";

test("emitted body bytes change the route-v1 fingerprint, preserve EOL identity and refuse stale admission", async () => {
  const root = fileURLToPath(
    new URL(
      `../../../.artifacts/tmp/unit-s1c/artifact-inputs/${crypto.randomUUID()}/`,
      import.meta.url,
    ),
  );
  mkdirSync(root, { recursive: true });
  const fixture = fileURLToPath(
    new URL("../../packages/agent-contracts/src/route-kernel.fixtures.ts", import.meta.url),
  ).replaceAll("\\", "/");
  writeFileSync(
    join(root, "entry.ts"),
    `import { builtinModule } from ${JSON.stringify(fixture)};
import { calculate } from "./body.ts";
import { text } from "./schema.ts";
export const module = { ...builtinModule, schemas: { ...builtinModule.schemas, text }, bodies: Object.fromEntries(Object.entries(builtinModule.bodies).map(([key, body]) => [key, { ...body, source: { module: "route.js", export: key }, ...(key === "calculate" ? { run: calculate } : {}) }])) };
`,
  );
  const schemaFile = (limit: number) =>
    `import { schemas } from ${JSON.stringify(fixture)}; export const text = schemas.text.max(${limit});`;
  writeFileSync(join(root, "schema.ts"), schemaFile(8));
  const build = () =>
    buildRouteArtifact({
      entry: join(root, "entry.ts"),
      root,
      data: builtinData,
      contracts: [{ id: "test-contract", bytes: new TextEncoder().encode("test contract v1") }],
    });
  writeFileSync(join(root, "body.ts"), "export const calculate = () => ({ total: 1 });\n");
  const first = await build();
  writeFileSync(join(root, "body.ts"), "export const calculate = () => ({ total: 1 });\r\n");
  expect((await build()).fingerprint).toBe(first.fingerprint);
  writeFileSync(join(root, "body.ts"), "export const calculate = () => ({ total: 2 });\n");
  const changed = await build();
  expect(changed.fingerprint).not.toBe(first.fingerprint);
  writeFileSync(join(root, "schema.ts"), schemaFile(9));
  expect((await build()).fingerprint).not.toBe(changed.fingerprint);

  const bytes = changed.executables[0]!.members.find((m) => m.path === "route.js")!.bytes;
  const loaded = await import(
    /* @vite-ignore */ `data:text/javascript;base64,${Buffer.from(bytes).toString("base64")}`
  );
  expect(loaded.module.bodies.calculate.run()).toEqual({ total: 2 });
  const evidence = {
    loadedBindings: loaded.module,
    ...changed,
    expectedFingerprint: first.fingerprint,
    catalog: Object.entries(entries).map(([key, entry]) => ({ key, ...entry.axes, uses: [] })),
  };
  const stale = (await createRouteAdmission(evidence)).admitUnknown({
    ...loaded.module,
    artifact: changed.artifact,
  });
  expect(stale.ok).toBe(false);
  const admitted = (
    await createRouteAdmission({ ...evidence, expectedFingerprint: changed.fingerprint })
  ).admitUnknown({ ...loaded.module, artifact: changed.artifact });
  expect(admitted).toMatchObject({ ok: true });
  if (!admitted.ok) throw Error(JSON.stringify(admitted.diagnostics));
  const registry = createAdmittedRouteRegistry();
  const active = registry.register(admitted.route);
  expect(registry.resolve(admitted.route)).toBe(admitted.route);
  active.deactivate();
  writeFileSync(join(root, "body.ts"), "export const calculate = (path) => import(path);\n");
  await expect(build()).rejects.toThrow("Runtime import is not part of the closed artifact");
});
