import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { expect, test } from "vite-plus/test";
import { devWatchRoots, requireDevDependencies } from "../scripts/dev-watch-roots.ts";

test("a changed or missing installed lock names the frozen install before restarting", () => {
  const temp = mkdtempSync(join(tmpdir(), "pe-watch-install-"));
  const workspace = pathToFileURL(join(temp, "/"));
  const message = "vp i --frozen-lockfile --prefer-offline";
  try {
    const lock = new URL("pnpm-lock.yaml", workspace);
    writeFileSync(lock, "old");
    expect(() => requireDevDependencies(workspace)).toThrow(message);
    mkdirSync(new URL("node_modules/.pnpm", workspace), { recursive: true });
    writeFileSync(new URL("node_modules/.pnpm/lock.yaml", workspace), "old");
    expect(() => requireDevDependencies(workspace)).not.toThrow();
    writeFileSync(lock, "new");
    expect(() => requireDevDependencies(workspace)).toThrow(message);
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
      dependencies: { a: "workspace:*" },
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
    const roots = devWatchRoots(pathToFileURL(join(temp, "apps/host/"))).map((root) =>
      relative(temp, fileURLToPath(root)).replaceAll("\\", "/"),
    );
    expect(roots).toEqual(["apps/host/src", "packages/a/src", "packages/b/src", "packages/c/src"]);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

test("current checkout watches runtime packages and leaves kit updates to the frontend", () => {
  const roots = devWatchRoots(new URL("../", import.meta.url)).map((root) => root.pathname);
  expect(roots.some((root) => root.endsWith("/packages/host-contracts/src/"))).toBe(true);
  expect(roots.some((root) => root.endsWith("/packages/runtime/src/"))).toBe(true);
  expect(roots.some((root) => root.endsWith("/packages/kit/src/"))).toBe(false);
  // MCP skill discovery now consumes the browser guide at runtime.
  expect(roots.some((root) => root.endsWith("/packages/browser/src/"))).toBe(true);
});
