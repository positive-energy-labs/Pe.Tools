import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { expect, test, vi } from "vite-plus/test";
import { createDevDependencyRepair, devWatchRoots } from "../scripts/dev-watch-roots.ts";

test("a successful install is remembered even if the installed lock was not rewritten", async () => {
  const temp = mkdtempSync(join(tmpdir(), "pe-watch-install-"));
  const workspace = pathToFileURL(join(temp, "/"));
  const wanted = new URL("pnpm-lock.yaml", workspace);
  const installed = new URL("node_modules/.pnpm/lock.yaml", workspace);
  const install = vi.fn(async () => {});
  const repair = createDevDependencyRepair(workspace, install);
  try {
    mkdirSync(new URL("node_modules/.pnpm", workspace), { recursive: true });
    writeFileSync(wanted, "wanted\n");
    writeFileSync(installed, "wanted\n\n");
    await repair();
    await repair();
    expect(install).toHaveBeenCalledTimes(1);
    writeFileSync(wanted, "new lock\n");
    await repair();
    expect(install).toHaveBeenCalledTimes(2);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

test.each([
  {
    case: "stale dependencies are repaired and startup can continue",
    installedLock: "old",
    succeeds: true,
  },
  {
    case: "a failed install reports its error and stops startup",
    installedLock: undefined,
    succeeds: false,
  },
  { case: "matching locks skip the install", installedLock: "new", succeeds: true },
])("$case", async ({ installedLock, succeeds }) => {
  const temp = mkdtempSync(join(tmpdir(), "pe-watch-install-"));
  const workspace = pathToFileURL(join(temp, "/"));
  const installed = new URL("node_modules/.pnpm/lock.yaml", workspace);
  const execute = vi.fn(async () => {
    if (!succeeds) throw new Error("frozen install refused the workspace lock");
    writeFileSync(installed, "new");
  });
  try {
    writeFileSync(new URL("pnpm-lock.yaml", workspace), "new");
    mkdirSync(new URL("node_modules/.pnpm", workspace), { recursive: true });
    if (installedLock !== undefined) writeFileSync(installed, installedLock);
    const ready = createDevDependencyRepair(workspace, execute)();
    if (succeeds) await expect(ready).resolves.toBeUndefined();
    else
      await expect(ready).rejects.toThrow(
        /Run `vp i --frozen-lockfile --prefer-offline`.*\nfrozen install refused/,
      );

    if (installedLock === "new") expect(execute).not.toHaveBeenCalled();
    else {
      expect(execute).toHaveBeenCalledTimes(1);
      expect(execute).toHaveBeenCalledWith("vp", ["i", "--frozen-lockfile", "--prefer-offline"], {
        cwd: workspace,
      });
    }
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

test("host watch roots follow runtime dependencies, including transitive optional and peers", () => {
  const temp = mkdtempSync(join(tmpdir(), "pe-watch-roots-"));
  const put = (directory: string, manifest: object) => {
    mkdirSync(join(temp, directory, "src"), { recursive: true });
    writeFileSync(join(temp, directory, "package.json"), JSON.stringify(manifest));
  };
  try {
    put("apps/host", {
      name: "host",
      dependencies: {
        a: "workspace:*",
        "product-host": "workspace:*",
        "product-web": "workspace:*",
      },
      devDependencies: { kit: "workspace:*" },
    });
    put("packages/a", { name: "a", optionalDependencies: { b: "workspace:*" } });
    put("packages/b", {
      name: "b",
      peerDependencies: { a: "workspace:*", c: "workspace:*", external: "1" },
    });
    put("packages/c", { name: "c" });
    put("packages/kit", { name: "kit" });
    put("packages/browser", { name: "browser" });
    put("products/example/host", {
      name: "product-host",
      dependencies: { "product-domain": "workspace:*" },
    });
    put("products/example/domain", { name: "product-domain" });
    put("products/example/web", { name: "product-web" });
    put("products/unused/host", { name: "unused-host" });
    const roots = devWatchRoots(pathToFileURL(join(temp, "apps/host/"))).map((root) =>
      relative(temp, fileURLToPath(root)).replaceAll("\\", "/"),
    );
    expect(roots).toContain("products/example/host/src");
    expect(roots).not.toContain("products/example/web/src");
    expect(roots.sort()).toEqual([
      "apps/host/src",
      "packages/a/src",
      "packages/b/src",
      "packages/c/src",
      "products/example/domain/src",
      "products/example/host/src",
    ]);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

test("current checkout watches runtime packages and leaves kit updates to the frontend", () => {
  const roots = devWatchRoots(new URL("../", import.meta.url)).map((root) => root.pathname);
  expect(roots.some((root) => root.endsWith("/packages/host-contracts/src/"))).toBe(true);
  expect(roots.some((root) => root.endsWith("/packages/runtime/src/"))).toBe(true);
  expect(roots.some((root) => root.endsWith("/packages/kit/src/"))).toBe(false);
  expect(roots.some((root) => root.endsWith("/products/fans/host/src/"))).toBe(true);
  expect(roots.some((root) => root.endsWith("/products/duct-systems/host/src/"))).toBe(true);
  expect(roots.some((root) => /\/products\/[^/]+\/web\//.test(root))).toBe(false);
  // MCP skill discovery now consumes the browser guide at runtime.
  expect(roots.some((root) => root.endsWith("/packages/browser/src/"))).toBe(true);
});
