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
  machineFacts,
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
  expect(firmHome(machineFacts([empty, mapped])).root).toBe(firm);
  expect(homes({ facts: machineFacts([empty, mapped]) })).toEqual([
    { tier: "user", root: process.env[homeVariable] },
    { tier: "firm", root: firm },
  ]);
  expect(firmSettingsDir(machineFacts([empty, mapped]))).toBe(join(firm, "Settings"));
  expect(firmKeysPath(machineFacts([empty, mapped]))).toBe(join(firm, "keys.json"));
  // The bare form, a drive whose root is the shared drive root.
  const bare = drive();
  mark(join(bare, ...firmSegments), `{ "tier": "firm" }`);
  expect(firmHome(machineFacts([bare])).root).toBe(
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
  const found = firmHome(machineFacts(drives));
  expect(found.root).toBeNull();
  expect(found.looked).toEqual(
    drives.flatMap((root) => [
      join(root, "Shared drives", "*", ...firmSegments),
      join(root, ...firmSegments),
    ]),
  );
  expect(homes({ facts: machineFacts(drives) })).toEqual([{ tier: "user", root: process.env[homeVariable] }]);
  expect(firmSettingsDir(machineFacts(drives))).toBeNull();
  for (const place of found.looked) expect(noFirmHomeText(found)).toContain(place);
});

test("the model's pointer names the project home, between user and firm, only when its marker reads project", () => {
  noHomeVariables();
  const mapped = drive();
  mark(join(mapped, "Shared drives", "Team", ...firmSegments), `{"tier":"firm"}`);
  const project = mark(
    join(mapped, "Shared drives", "Team", "Projects", "Chadds", "Pe.Tools"),
    `{"tier":"project"}`,
  );
  mkdirSync(join(mapped, "Shared drives", "Team", "Projects", "Other", "Pe.Tools"), {
    recursive: true,
  });
  const facts = machineFacts([mapped]);
  const tiers = (pointer: string | null) => homes({ pointer, facts }).map((home) => home.tier);
  expect(homes({ pointer: "Projects/Chadds", facts })[1]).toEqual({ tier: "project", root: project });
  expect(tiers("Projects/Chadds")).toEqual(["user", "project", "firm"]);
  // Unbound must work: no pointer, an unmarked folder, and a pointer that leaves the shared drive.
  for (const unbound of [null, "Projects/Other", "../Team/Projects/Chadds", "Projects\\Chadds"])
    expect(tiers(unbound)).toEqual(["user", "firm"]);
});

test("the override names the firm home itself and skips the probe; the shared drive root is its grandparent", () => {
  noHomeVariables();
  const mapped = drive();
  const probedFirm = mark(join(mapped, "Shared drives", "Team", ...firmSegments), `{"tier":"firm"}`);
  const facts = machineFacts([mapped]);
  expect(sharedDriveRoot(facts)).toBe(join(mapped, "Shared drives", "Team"));
  // Told, not probed: the drives are never read, and the told folder still proves itself.
  const told = join(drive(), "share", "software", "Pe.Tools");
  vi.stubEnv(productPathNames.sharedRootVariable, ` ${told} `);
  expect(firmHome(facts)).toEqual({ root: null, looked: [told] });
  mark(told, `{"tier":"firm"}`);
  expect(firmHome(facts)).toEqual({ root: told, looked: [told] });
  expect(firmHome(facts).root).not.toBe(probedFirm);
  expect(sharedDriveRoot(facts)).toBe(join(told, "..", ".."));
});

test("two firm markers refuse both: no firm home, and one notice names both paths", () => {
  noHomeVariables();
  const [real, substituted] = [drive(), drive()];
  const first = mark(join(real, "Shared drives", "Team", ...firmSegments), `{"tier":"firm"}`);
  const second = mark(join(substituted, ...firmSegments), `{"tier":"firm"}`);
  const facts = machineFacts([real, substituted]);
  const found = firmHome(facts);
  expect(found).toMatchObject({ root: null, refused: [first, second] });
  expect(homes({ facts }).map((home) => home.tier)).toEqual(["user"]);
  expect(sharedDriveRoot(facts)).toBeNull();
  const notice = noFirmHomeText(found);
  expect(notice).toContain(first);
  expect(notice).toContain(second);
  // One of them alone is the firm home.
  expect(firmHome(machineFacts([real])).root).toBe(first);
});

// Mutant, run red once (2026-11-12): `homesFound` labels a told firm home "probe" instead of "override".
test("H1: the host log has one line per home with its tier and how it was found, and one for a firm home not found", async () => {
  const { homeLogLines, homesFound } = await import("../src/product-paths.ts");
  noHomeVariables();
  const user = process.env[homeVariable]!;
  const mapped = drive();
  const firm = mark(join(mapped, "Shared drives", "Team", ...firmSegments), `{"tier":"firm"}`);
  const project = mark(join(mapped, "Shared drives", "Team", "Projects", "Chadds", "Pe.Tools"), `{"tier":"project"}`);
  const facts = machineFacts([mapped]);
  // Probed: the user home is an override here (a test names it), the project by pointer, the firm by probe.
  expect(homeLogLines(homesFound({ pointer: "Projects/Chadds", facts }))).toEqual([
    `Home user: ${user} (found by override)`,
    `Home project: ${project} (found by pointer)`,
    `Home firm: ${firm} (found by probe)`,
  ]);
  // Told: the same folder named by the dev override says so.
  vi.stubEnv(productPathNames.sharedRootVariable, firm);
  expect(homeLogLines(homesFound({ facts })).at(-1)).toBe(`Home firm: ${firm} (found by override)`);
  vi.stubEnv(productPathNames.sharedRootVariable, undefined);
  // Not found: the line says where the host looked.
  const empty = machineFacts([drive()]);
  const none = homesFound({ facts: empty });
  expect(none.homes.map((home) => home.tier)).toEqual(["user"]);
  expect(homeLogLines(none)).toHaveLength(2);
  for (const place of firmHome(empty).looked) expect(homeLogLines(none)[1]).toContain(place);
  // Two markers: both refused, and the line names both.
  const second = drive();
  const twin = mark(join(second, ...firmSegments), `{"tier":"firm"}`);
  const both = homesFound({ facts: machineFacts([mapped, second]) });
  expect(both.homes.map((home) => home.tier)).toEqual(["user"]);
  expect(both.firmNotice).toContain(firm);
  expect(both.firmNotice).toContain(twin);
});

// homes.json (Settings' choice). Mutants, each run red once (2026-11-17): let the file beat the
// override and the isolation case goes red; fall back to the probe for an unmarked chosen firm
// folder and the no-fallback case goes red; label a file value "override" and the found case goes red.
test("homes.json names the firm and user homes; the override beats it; a chosen unmarked firm folder is no firm home, not the probe", async () => {
  const { homesFound, readHomesConfig, useHomesConfig, homesConfigPath } = await import("../src/product-paths.ts");
  const prior = homesConfigPath();
  noHomeVariables();
  vi.stubEnv(homeVariable, undefined);
  const mapped = drive();
  const probed = mark(join(mapped, "Shared drives", "Team", ...firmSegments), `{"tier":"firm"}`);
  const facts = machineFacts([mapped]);
  const chosenFirm = join(drive(), "Elsewhere", "Pe.Tools");
  const chosenUser = mkdtempSync(join(tmpdir(), "pe-chosen-user-"));
  const file = join(mkdtempSync(join(tmpdir(), "pe-state-")), "homes.json");
  try {
    useHomesConfig(file);
    writeFileSync(file, JSON.stringify({ firm: chosenFirm, user: chosenUser }));
    expect(userRoot()).toBe(chosenUser);
    // Chosen but unmarked: no firm home, the notice names the chosen folder, and the probed one is not used.
    expect(firmHome(facts)).toEqual({ root: null, looked: [chosenFirm] });
    expect(homesFound({ facts }).firmNotice).toContain(chosenFirm);
    mark(chosenFirm, `{"tier":"firm"}`);
    expect(homesFound({ facts }).homes).toEqual([
      { tier: "user", root: chosenUser, found: "config" },
      { tier: "firm", root: chosenFirm, found: "config" },
    ]);
    // The isolation override beats the file, per tier.
    const isolated = mkdtempSync(join(tmpdir(), "pe-isolated-"));
    vi.stubEnv(homeVariable, isolated);
    expect(homesFound({ facts }).homes[0]).toEqual({ tier: "user", root: isolated, found: "override" });
    // An unreadable file is reported and not used: the defaults answer.
    writeFileSync(file, JSON.stringify({ firm: "relative/path" }));
    expect(readHomesConfig().error).toContain("absolute path");
    expect(firmHome(facts).root).toBe(probed);
  } finally {
    useHomesConfig(prior);
  }
});
