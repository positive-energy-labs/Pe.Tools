import { expect, test, vi } from "vite-plus/test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { routeModuleHash } from "./route-module-hash.ts";
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
