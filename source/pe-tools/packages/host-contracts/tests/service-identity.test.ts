import { expect, test } from "vite-plus/test";
import {
  hostServiceName,
  normalizeSourceRoot,
  sourceHostServiceName,
} from "@pe/host-contracts/service-identity";

test("source host identity is stable per canonical checkout root", () => {
  const sourceRoot = "C:\\Users\\Alice\\Repo\\source\\pe-tools\\";

  expect(normalizeSourceRoot(sourceRoot)).toBe("c:/users/alice/repo/source/pe-tools");
  expect(sourceHostServiceName(sourceRoot)).toBe("host-source-a3684ea655f3");
  expect(sourceHostServiceName(sourceRoot.toLowerCase())).toBe(sourceHostServiceName(sourceRoot));
  expect(sourceHostServiceName("C:\\worktrees\\other\\source\\pe-tools")).not.toBe(
    sourceHostServiceName(sourceRoot),
  );
  expect(hostServiceName("installed", null)).toBe("host");
});
