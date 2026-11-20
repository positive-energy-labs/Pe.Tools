import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test, vi } from "vite-plus/test";
import { routeModuleHash } from "./route-module-hash.ts";
import { routeSourceHash } from "./route-source-hash.ts";

const id = fileURLToPath(
  new URL("../../products/rooms/web/routes/rooms/route.ts", import.meta.url),
);
const closure = fileURLToPath(
  new URL("../../products/rooms/web/routes/rooms/source-closure.generated.json", import.meta.url),
);

test("the retired graph-only transform never injects moduleHash", async () => {
  const transform = routeModuleHash().transform as Function;
  expect(await transform(readFileSync(id, "utf8"), id)).toBeUndefined();
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
  await (routeModuleHash(generate).buildStart as Function).call({ addWatchFile: vi.fn() });
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
  expect(await update({ file: id.replace("graph.ts", "schema.ts"), server })).toEqual([]);
  expect(order).toEqual(["generated", "invalidated", "reload"]);
});

test("generation failure stops bundling and never reloads a stale directory", async () => {
  const plugin = routeModuleHash(async () => {
    throw Error("bad graph");
  });
  await expect((plugin.buildStart as Function).call({ addWatchFile: vi.fn() })).rejects.toThrow(
    "bad graph",
  );
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
  const start = (plugin.buildStart as Function).call({ addWatchFile: vi.fn() });
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

test("runtime projections replace stale disk content without writing it", async () => {
  const plugin = routeModuleHash(async () => ({ [id]: "fresh body" }));
  const before = readFileSync(id, "utf8");
  await (plugin.buildStart as Function).call({ addWatchFile: vi.fn() });
  expect(await (plugin.load as Function)(id)).toBe("fresh body");
  expect(readFileSync(id, "utf8")).toBe(before);
});

test("tests project lazily on the first closure import; dev and build project at startup", async () => {
  const generate = vi.fn(async () => ({}));
  for (const [command, mode, eager] of [
    ["serve", "development", true],
    ["build", "production", true],
    ["serve", "test", false],
  ] as const) {
    generate.mockClear();
    const plugin = routeModuleHash(generate);
    (plugin.configResolved as Function)({ command, mode });
    await (plugin.buildStart as Function).call({ addWatchFile: vi.fn() });
    await (plugin.load as Function)(id);
    expect(generate).toHaveBeenCalledTimes(eager ? 1 : 0);
    await (plugin.load as Function)(closure);
    expect(generate).toHaveBeenCalledOnce();
  }
});

test("a closure import resolves without a disk copy", () => {
  const resolve = routeModuleHash().resolveId as Function;
  expect(resolve("./source-closure.generated.json", id)).toBe(closure);
  expect(resolve("./graph.ts", id)).toBeUndefined();
});

test("overlapping edits rebuild the latest sources once and reload once", async () => {
  let finish!: () => void;
  let revision = 0;
  const built: number[] = [];
  const generate = vi.fn(async () => {
    built.push(revision);
    if (built.length === 1) await new Promise<void>((resolve) => (finish = resolve));
  });
  const plugin = routeModuleHash(generate);
  const server = { moduleGraph: { invalidateAll: vi.fn() }, ws: { send: vi.fn() } };
  const update = () => (plugin.handleHotUpdate as Function)({ file: id, server });
  const edits = [update()];
  await Promise.resolve();
  for (revision = 1; revision <= 20; revision++) edits.push(update());
  revision = 20;
  let served = false;
  const request = (plugin.transform as Function)("", id).then(() => (served = true));
  await Promise.resolve();
  expect(served).toBe(false);
  finish();
  await Promise.all(edits);
  await request;
  expect(built).toEqual([0, 20]);
  expect(served).toBe(true);
  expect(server.moduleGraph.invalidateAll).toHaveBeenCalledOnce();
  expect(server.ws.send).toHaveBeenCalledOnce();
});
