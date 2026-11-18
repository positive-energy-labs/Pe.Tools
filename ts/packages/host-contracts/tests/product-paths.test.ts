import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { productPathNames } from "../src/contracts/product.ts";
import {
  parseDocumentsKnownFolder,
  firmHome,
  firmKeysPath,
  firmSettingsDir,
  testHomeRootVariable,
  userRoot,
} from "../src/product-paths.ts";

const homeVariable = productPathNames.productHomeVariable;

// The real `reg query` output on a OneDrive-redirected profile: the value stays REG_EXPAND_SZ,
// so the redirection survives only if the reader expands it itself.
const oneDrive = [
  "",
  "HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Explorer\User Shell Folders",
  "    Personal    REG_EXPAND_SZ    %USERPROFILE%\OneDrive\Documents",
  "",
].join("\r\n");

test("an expanded OneDrive path is the resolved Documents folder", () => {
  expect(parseDocumentsKnownFolder(oneDrive, { USERPROFILE: "C:\Users\pea" })).toBe(
    "C:\Users\pea\OneDrive\Documents",
  );
});

test("an unreadable known folder fails loudly instead of falling back to the profile", () => {
  // The %USERPROFILE%/Documents fallback is a DIFFERENT content home, not a degraded answer.
  expect(() => parseDocumentsKnownFolder("ERROR: The system was unable to find...", {})).toThrow(
    "no Personal value",
  );
  expect(() => parseDocumentsKnownFolder(oneDrive, {})).toThrow("undefined variable 'USERPROFILE'");
});

test("under a test run no content home may resolve outside the temp directory", () => {
  const original = process.env[homeVariable];
  try {
    expect(process.env[testHomeRootVariable]).toBeTruthy();
    process.env[homeVariable] = "C:UserssomeoneDocumentsPe.Tools";
    expect(() => userRoot()).toThrow("Test isolation");
    delete process.env[homeVariable];
    expect(() => userRoot()).toThrow("Test isolation"); // the unset override is the real Documents home
    process.env[productPathNames.sharedRootVariable] = "S:\Pe.Tools";
    expect(() => firmHome({ exists: () => true, marker: () => null })).toThrow("Test isolation");
  } finally {
    delete process.env[productPathNames.sharedRootVariable];
    if (original === undefined) delete process.env[homeVariable];
    else process.env[homeVariable] = original;
  }
});


afterEach(() => vi.unstubAllEnvs());
test("firm resolution uses Settings, else the literal default folder, with no marker read", async () => {
  const { defaultFirmHome, useHomesConfig, homesConfigPath, homesFound } = await import("../src/product-paths.ts");
  vi.stubEnv("PE_TOOLS_SHARED_ROOT", "");
  vi.stubEnv("PE_TEST_HOME_ROOT", "");
  const root = mkdtempSync(join(tmpdir(), "pe-resolver-"));
  vi.stubEnv(homeVariable, root);
  const file = join(root, "homes.json");
  const prior = homesConfigPath();
  const chosen = join(root, "firm");
  const marker = vi.fn(() => { throw Error("firm marker read"); });
  let present = new Set([defaultFirmHome]);
  const facts = { exists: (path: string) => present.has(path), marker };
  try {
    useHomesConfig(file);
    expect(firmHome(facts).root).toBe(defaultFirmHome);
    expect(homesFound({ facts }).homes.at(-1)?.found).toBe("default");
    writeFileSync(file, JSON.stringify({ firm: chosen }));
    expect(firmHome(facts).root).toBeNull();
    expect(homesFound({ facts }).firmNotice).toBe("Set your firm home in Settings");
    present.add(chosen);
    expect(firmHome(facts).root).toBe(chosen);
    expect(firmSettingsDir(facts)).toBe(join(chosen, "Settings"));
    expect(firmKeysPath(facts)).toBe(join(chosen, "keys.json"));
    expect(homesFound({ facts }).homes.at(-1)?.found).toBe("config");
    writeFileSync(file, "{}"); present.clear();
    expect(firmHome(facts).root).toBeNull();
    expect(marker).not.toHaveBeenCalled();
  } finally { useHomesConfig(prior); }
});

// Restored after the marker deletion: these two rules never depended on the marker.
test("homes.json names the user home; a homes.json that does not validate is reported and the defaults answer", async () => {
  const { defaultFirmHome, readHomesConfig, useHomesConfig, homesConfigPath } = await import("../src/product-paths.ts");
  vi.stubEnv("PE_TOOLS_SHARED_ROOT", "");
  vi.stubEnv("PE_TEST_HOME_ROOT", "");
  vi.stubEnv(homeVariable, undefined);
  const file = join(mkdtempSync(join(tmpdir(), "pe-homes-file-")), "homes.json");
  const chosenUser = mkdtempSync(join(tmpdir(), "pe-chosen-user-"));
  const prior = homesConfigPath();
  const facts = { exists: (path: string) => path === defaultFirmHome, marker: () => null };
  try {
    useHomesConfig(file);
    writeFileSync(file, JSON.stringify({ user: chosenUser }));
    expect(userRoot()).toBe(chosenUser);
    writeFileSync(file, JSON.stringify({ firm: "relative/path" }));
    expect(readHomesConfig().error).toContain("absolute path");
    expect(firmHome(facts).root).toBe(defaultFirmHome);
  } finally { useHomesConfig(prior); }
});
