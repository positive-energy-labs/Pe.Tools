import { expect, test } from "vite-plus/test";
import {
  hostServiceName,
  sourceHostServiceName,
  installedRuntimeRoot,
  productRoot,
  runtimeOwnerRejection,
} from "@pe/host-contracts/service-identity";
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
