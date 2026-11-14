import { afterEach, expect, test, vi } from "vite-plus/test";
import { mkdir, writeFile } from "node:fs/promises";
import * as filesystem from "node:fs";
import * as paths from "@pe/host-contracts/product-paths";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtemp } from "../../../tests/isolated-home/storage.ts";
import { acquireContentRoots, contentRootsRefreshMs } from "../src/content-roots.ts";
import { listPackages, productPodsRoots } from "../src/packages.ts";
import { productPagesRoots } from "../src/page-libraries.ts";
import { pagesRoute } from "../src/pages-route.ts";
import { createPackageLifecycle } from "../src/package-lifecycle.ts";
import { serveRoutes } from "./real-server.ts";
import { detachedBridge } from "./effect-test.ts";
import { Layer } from "effect";
import { ActionJournalService } from "../src/receipt-services.ts";

vi.mock("node:fs", async original => ({ ...await original<typeof import("node:fs")>() }));
vi.mock("@pe/host-contracts/product-paths", async original => ({ ...await original<typeof import("@pe/host-contracts/product-paths")>() }));
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.useRealTimers(); });

test("Page, lifecycle and omitted-roots requests use one async snapshot and never call the sync resolver", async () => {
  const root = await mkdtemp(join(tmpdir(), "pe-async-homes-"));
  vi.stubEnv("PE_TOOLS_PRODUCT_HOME", root);
  vi.stubEnv("PE_TOOLS_SHARED_ROOT", join(root, "not-mounted"));
  const resolve = vi.spyOn(paths, "resolveHomes");
  const owner = acquireContentRoots();
  await owner.ready;
  const lifecycle = createPackageLifecycle();
  const server = await serveRoutes(pagesRoute().pipe(Layer.provide(ActionJournalService.live(null))), detachedBridge());
  try {
    await lifecycle.ready;
    const sync = [vi.spyOn(paths, "homeDirs"), vi.spyOn(paths, "homes"), vi.spyOn(paths, "firmHome"),
      vi.spyOn(filesystem, "readFileSync"), vi.spyOn(filesystem, "existsSync"), vi.spyOn(filesystem, "readdirSync")];
    await listPackages();
    await lifecycle.refresh();
    expect((await fetch(`${server.base}/pages`)).status).toBe(200);
    for (const call of sync) expect(call).not.toHaveBeenCalled();
    expect(resolve).toHaveBeenCalledOnce();
  } finally { await server.close(); await lifecycle.close(); owner.close(); }
});

test("one 30 second background resolution picks up a late firm home for both Pods and Pages", async () => {
  const root = await mkdtemp(join(tmpdir(), "pe-mount-homes-"));
  const firm = join(root, "firm");
  vi.stubEnv("PE_TOOLS_PRODUCT_HOME", root);
  vi.stubEnv("PE_TOOLS_SHARED_ROOT", firm);
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  const resolve = vi.spyOn(paths, "resolveHomes");
  const owner = acquireContentRoots();
  try {
    await owner.ready;
    expect(productPodsRoots()).toEqual([join(root, "Pods")]);
    await mkdir(firm);
    await writeFile(join(firm, "pe-home.json"), '{"tier":"firm"}');
    await vi.advanceTimersByTimeAsync(contentRootsRefreshMs - 1);
    expect(productPagesRoots()).toEqual([join(root, "Pages")]);
    expect(resolve).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    await vi.waitFor(() => expect(productPodsRoots()).toContain(join(firm, "Pods")));
    expect(productPagesRoots()).toContain(join(firm, "Pages"));
    expect(resolve).toHaveBeenCalledTimes(2);
  } finally { owner.close(); }
});
