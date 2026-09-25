import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vite-plus/test";
import { Context, Layer } from "effect";
import { HttpRouter } from "effect/unstable/http";
import { viewImageRoute } from "../src/view-image-route.ts";

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const release of cleanup.splice(0).reverse()) await release();
});
const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

async function serve() {
  const root = await mkdtemp(join(tmpdir(), "pe-view-image-test-"));
  const web = HttpRouter.toWebHandler(viewImageRoute(async () => [root]), {
    disableLogger: true,
    memoMap: Layer.makeMemoMapUnsafe(),
  });
  cleanup.push(
    () => rm(root, { recursive: true, force: true }),
    () => web.dispose(),
  );
  const get = (path: string) =>
    web.handler(new Request(`http://host${path}`), Context.empty() as never);
  return { root, get };
}

test("serves the export whose bytes hash to the requested sha", async () => {
  const { root, get } = await serve();
  const png = Buffer.from("png-a");
  await writeFile(join(root, "view-1-abc - Floor Plan - L1.png"), png);
  await writeFile(join(root, "view-2-def.png"), Buffer.from("png-b"));
  const response = await get(`/view-image/${sha(png)}.png`);
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toBe("image/png");
  expect(Buffer.from(await response.arrayBuffer())).toEqual(png);
});

test("a file overwritten after registration no longer serves under its old sha", async () => {
  const { root, get } = await serve();
  const png = Buffer.from("png-a");
  await writeFile(join(root, "view-1.png"), png);
  await writeFile(join(root, "view-1.png"), Buffer.from("png-a-overwritten"));
  expect((await get(`/view-image/${sha(png)}.png`)).status).toBe(404);
});

test("a missing export is 404", async () => {
  const { get } = await serve();
  expect((await get(`/view-image/${"a".repeat(64)}.png`)).status).toBe(404);
});

test("a caller path never reaches the filesystem", async () => {
  const { root, get } = await serve();
  const outside = Buffer.from("secret");
  await writeFile(join(root, "..", "pe-view-image-outside.png"), outside);
  cleanup.push(() => rm(join(root, "..", "pe-view-image-outside.png"), { force: true }));
  for (const path of [
    "/view-image/..%2Fpe-view-image-outside.png",
    "/view-image/../pe-view-image-outside.png",
    `/view-image/${sha(outside)}`,
    `/view-image/${sha(outside).toUpperCase()}.png`,
    `/view-image/${sha(outside)}.png/x`,
  ])
    expect([400, 404]).toContain((await get(path)).status);
  expect((await get(`/view-image/${sha(outside)}.png`)).status).toBe(404);
});
