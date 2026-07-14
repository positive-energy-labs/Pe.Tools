import { expect, test } from "vite-plus/test";
import { isLegacyHostPath } from "../src/retire-legacy-host.ts";

test("legacy flat-layout host is retired, versioned host never is", () => {
  const root = "C:\\Users\\cody\\AppData\\Local\\Positive Energy\\Pe.Tools";
  expect(isLegacyHostPath(`${root}\\bin\\host\\Pe.Host.exe`)).toBe(true);
  expect(isLegacyHostPath(`${root}\\app\\bin\\host\\versions\\0.6.11-beta.3\\Pe.Host.exe`)).toBe(
    false,
  );
  expect(isLegacyHostPath(`${root}\\BIN\\HOST\\VERSIONS\\0.6.12\\PE.HOST.EXE`)).toBe(false);
  // Non-host processes and non-exact names never match.
  expect(isLegacyHostPath("C:\\somewhere\\Pe.Host.exe.bak")).toBe(false);
  expect(isLegacyHostPath("C:\\somewhere\\NotPe.Host.exe2")).toBe(false);
});
