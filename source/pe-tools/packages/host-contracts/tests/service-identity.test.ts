import { expect, test } from "vite-plus/test";
import { hostServiceName, sourceHostServiceName } from "@pe/host-contracts/service-identity";

// The normalization+hash mechanics are SDK-owned (vendor/pe-service.ts, pinned by the SDK's
// contract vectors); this test pins the PRODUCT mapping: base name "host" and the lane rules.
test("source host identity is stable per canonical checkout root", () => {
  const sourceRoot = "C:\\Users\\Alice\\Repo\\source\\pe-tools\\";

  expect(sourceHostServiceName(sourceRoot)).toBe("host-source-a3684ea655f3");
  expect(sourceHostServiceName(sourceRoot.toLowerCase())).toBe(sourceHostServiceName(sourceRoot));
  expect(sourceHostServiceName("C:\\worktrees\\other\\source\\pe-tools")).not.toBe(
    sourceHostServiceName(sourceRoot),
  );
  expect(hostServiceName("installed", null)).toBe("host");
});
