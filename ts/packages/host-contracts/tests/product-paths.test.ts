import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { productPathNames } from "../src/contracts/product.ts";
import {
  parseDocumentsKnownFolder,
  firmHome,
  firmKeysPath,
  firmSettingsDir,
  homes,
  noFirmHomeText,
  sharedDriveRoot,
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
    expect(() => firmHome()).toThrow("Test isolation");
  } finally {
    delete process.env[productPathNames.sharedRootVariable];
    if (original === undefined) delete process.env[homeVariable];
    else process.env[homeVariable] = original;
  }
});

// H1 (homes MAP slice 6): the firm home is found with no PE_TOOLS_* variable, by the marker.
// Mutant: drop the `=== "firm"` marker check in `probeFirmHome` and the wrong-tier case goes red;
// make `mountedDrives` the default for an injected list and the found case goes red.
const firmSegments = ["04 PE Software Files", "Pe.Tools"];
const mark = (folder: string, marker: string) => {
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, "pe-home.json"), marker);
  return folder;
};
const drive = () => mkdtempSync(join(tmpdir(), "pe-drive-"));
const noHomeVariables = () => {
  vi.stubEnv(productPathNames.sharedRootVariable, undefined);
  vi.stubEnv(homeVariable, mkdtempSync(join(tmpdir(), "pe-user-")));
  // Test isolation needs the user home named; nothing else may name a home or a share.
  const named = Object.keys(process.env).filter((name) => name.startsWith("PE_TOOLS_"));
  expect(named.filter((name) => /SHARED|FIRM|ROOT$/.test(name) && name !== "PE_TOOLS_SOURCE_ROOT")).toEqual([]);
};
afterEach(() => vi.unstubAllEnvs());

test("H1: a mapped shared drive holding a firm marker is the firm home, with no variable", () => {
  noHomeVariables();
  const [empty, mapped] = [drive(), drive()];
  const firm = mark(
    join(mapped, "Shared drives", "PE Team Folder", ...firmSegments),
    `{"tier":"firm"}`,
  );
  expect(firmHome([empty, mapped]).root).toBe(firm);
  expect(homes({ drives: [empty, mapped] })).toEqual([
    { tier: "user", root: process.env[homeVariable] },
    { tier: "firm", root: firm },
  ]);
  expect(firmSettingsDir([empty, mapped])).toBe(join(firm, "Settings"));
  expect(firmKeysPath([empty, mapped])).toBe(join(firm, "keys.json"));
  // The bare form, a drive whose root is the shared drive root.
  const bare = drive();
  expect(firmHome([mark(join(bare, ...firmSegments), `{ "tier": "firm" }`)].map(() => bare)).root).toBe(
    join(bare, ...firmSegments),
  );
});

test("H1: no firm home leaves the user home alone, and the notice names every place looked", () => {
  noHomeVariables();
  const [plain, wrongTier, extraField] = [drive(), drive(), drive()];
  // A folder at the right path proves nothing: the marker must read exactly {"tier":"firm"}.
  mkdirSync(join(plain, ...firmSegments), { recursive: true });
  mark(join(wrongTier, "Shared drives", "Team", ...firmSegments), `{"tier":"user"}`);
  mark(join(extraField, ...firmSegments), `{"tier":"firm","id":"x"}`);
  const drives = [plain, wrongTier, extraField];
  const found = firmHome(drives);
  expect(found.root).toBeNull();
  expect(found.looked).toEqual(
    drives.flatMap((root) => [
      join(root, "Shared drives", "*", ...firmSegments),
      join(root, ...firmSegments),
    ]),
  );
  expect(homes({ drives })).toEqual([{ tier: "user", root: process.env[homeVariable] }]);
  expect(firmSettingsDir(drives)).toBeNull();
  for (const place of found.looked) expect(noFirmHomeText(found)).toContain(place);
});

test("the project home joins the list between user and firm, only when its marker reads project", () => {
  noHomeVariables();
  const project = mark(join(drive(), "Projects", "Chadds", "Pe.Tools"), `{"tier":"project"}`);
  const unmarked = join(drive(), "Projects", "Other", "Pe.Tools");
  mkdirSync(unmarked, { recursive: true });
  expect(homes({ project, drives: [] }).map((home) => home.tier)).toEqual(["user", "project"]);
  expect(homes({ project: unmarked, drives: [] }).map((home) => home.tier)).toEqual(["user"]);
});

test("the override names the firm home itself and skips the probe; the shared drive root is its grandparent", () => {
  noHomeVariables();
  const mapped = drive();
  const probedFirm = mark(join(mapped, "Shared drives", "Team", ...firmSegments), `{"tier":"firm"}`);
  expect(sharedDriveRoot([mapped])).toBe(join(mapped, "Shared drives", "Team"));
  // Told, not probed: no marker is needed, the drives are never read, and nothing was looked for.
  const told = join(drive(), "share", "software", "Pe.Tools");
  vi.stubEnv(productPathNames.sharedRootVariable, ` ${told} `);
  expect(firmHome([mapped])).toEqual({ root: told, looked: [] });
  expect(firmHome([mapped]).root).not.toBe(probedFirm);
  expect(sharedDriveRoot([mapped])).toBe(join(told, "..", ".."));
});

test("two firm markers refuse both: no firm home, and one notice names both paths", () => {
  noHomeVariables();
  const [real, substituted] = [drive(), drive()];
  const first = mark(join(real, "Shared drives", "Team", ...firmSegments), `{"tier":"firm"}`);
  const second = mark(join(substituted, ...firmSegments), `{"tier":"firm"}`);
  const found = firmHome([real, substituted]);
  expect(found).toMatchObject({ root: null, refused: [first, second] });
  expect(homes({ drives: [real, substituted] }).map((home) => home.tier)).toEqual(["user"]);
  expect(sharedDriveRoot([real, substituted])).toBeNull();
  const notice = noFirmHomeText(found);
  expect(notice).toContain(first);
  expect(notice).toContain(second);
  // One of them alone is the firm home.
  expect(firmHome([real]).root).toBe(first);
});
