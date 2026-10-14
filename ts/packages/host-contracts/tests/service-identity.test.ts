import { expect, test } from "vite-plus/test";
import {
  hostServiceName,
  sourceHostServiceName,
  devFrontendPort,
  installedRuntimeRoot,
  productRoot,
  runtimeOwnerRejection,
} from "@pe/host-contracts/service-identity";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { productInstallLayout } from "@pe/host-contracts/contracts";

// The normalization+hash mechanics are SDK-owned (vendor/pe-service.ts, pinned by the SDK's
// contract vectors); this test pins the PRODUCT mapping: base name "host" and the lane rules.
test("source host identity is stable per canonical checkout root", () => {
  const sourceRoot = "C:\\Users\\Alice\\Repo\\";

  expect(sourceHostServiceName(sourceRoot)).toBe("host-source-56fd8a189f7e");
  expect(sourceHostServiceName(sourceRoot.toLowerCase())).toBe(sourceHostServiceName(sourceRoot));
  expect(sourceHostServiceName("C:\\worktrees\\other")).not.toBe(sourceHostServiceName(sourceRoot));
  expect(hostServiceName("installed", null)).toBe("host");
});

test("the main checkout keeps the Dev PWA's 5175; each linked worktree hashes a stable slot", () => {
  const base = mkdtempSync(join(tmpdir(), "pe-ports-"));
  try {
    const checkout = (name: string, git: "dir" | "file") => {
      const root = join(base, name);
      mkdirSync(root);
      if (git === "dir") mkdirSync(join(root, ".git"));
      else writeFileSync(join(root, ".git"), "gitdir: ../main/.git/worktrees/x");
      return root;
    };
    expect(devFrontendPort(checkout("main", "dir"))).toBe(5175);
    const worktrees = Array.from({ length: 12 }, (_, i) => checkout(`wt${i}`, "file"));
    const ports = worktrees.map(devFrontendPort);
    for (const port of ports) {
      expect(port).toBeGreaterThanOrEqual(5200);
      expect(port).toBeLessThan(6000);
    }
    expect(worktrees.map(devFrontendPort)).toEqual(ports);
    expect(new Set(ports).size).toBeGreaterThan(9);
    // Canonical-root equality: the same worktree spelled in another case is the same slot.
    expect(devFrontendPort(worktrees[0]!.toUpperCase())).toBe(ports[0]);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("installed execution requires the canonical manifest executable and exact installation root", () => {
  const root = productRoot();
  const executable = join(root, productInstallLayout["VersionedApp:host"]);
  expect(installedRuntimeRoot("host", executable, true)).toBe(root);
  expect(() => installedRuntimeRoot("host", executable, false)).toThrow("must execute");
  expect(() => installedRuntimeRoot("host", join(root, "copy", "Pe.Host.exe"), true)).toThrow(
    "must execute",
  );
  const owner = {
    lane: "installed" as const,
    sourceRoot: null,
    serviceName: "host",
    installedRoot: root,
  };
  expect(runtimeOwnerRejection(owner, owner)).toBeNull();
  for (const installedRoot of [null, join(root, "copy")])
    expect(runtimeOwnerRejection(owner, { ...owner, installedRoot })).toContain(
      "Runtime installation",
    );
});
