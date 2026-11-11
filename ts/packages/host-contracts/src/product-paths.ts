/**
 * The ONE content-home resolver (ADR 0037). Host, mcps, and runtime import this; nobody keeps a
 * copy, and the Revit side (`ProductPathing`) and PowerShell (`tools/product-paths.ps1`) read the
 * same names.
 *
 * Three homes, each a folder that proves itself with `pe-home.json` `{"tier": ...}`. The user home
 * always exists: an isolated `PE_TOOLS_PRODUCT_HOME`, else `<Documents>\Pe.Tools`. Documents is
 * routinely redirected (OneDrive, a mapped profile), so `%USERPROFILE%\Documents` is a different
 * content home, not a fallback: this reads the known folder or throws. The project home is the one
 * the target document names. The firm home is found by probing every drive for
 * `04 PE Software Files\Pe.Tools`. Pods, Pages and Catalogs read all three; an id is unique across
 * them, and a write lands in the home the thing came from. A machine with no firm home runs.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, realpathSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, relative, resolve, isAbsolute } from "node:path";
import { z } from "zod";
import { productIdentity, productPathNames } from "./contracts/product.ts";
import { readStored } from "./store.ts";

const userShellFolders =
  "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\User Shell Folders";

let cached: string | undefined;

/** Set only by the test global setup (`ts/tests/isolated-home`): the per-run temp root. */
export const testHomeRootVariable = "PE_TEST_HOME_ROOT";

/**
 * Fixture isolation tripwire. Under a test run (the marker is set) no product path may resolve
 * outside the OS temp directory: a test that reached the owner's real home fails where it resolved,
 * not after it wrote there. Outside tests this is the identity function.
 */
export function insideTestRoot(path: string): string {
  if (!process.env[testHomeRootVariable]) return path;
  const inside = [tmpdir(), realpathSync(tmpdir())].some((root) => {
    const away = relative(resolve(root), resolve(path));
    return !away.startsWith("..") && !isAbsolute(away);
  });
  if (!inside)
    throw new Error(
      `Test isolation: '${path}' is outside the temp directory. Set ${productPathNames.productHomeVariable} (and LOCALAPPDATA) to a temp dir.`,
    );
  return path;
}

/** The user home: always present. The Documents lookup is cached per process. */
export function userRoot(): string {
  const override = process.env[productPathNames.productHomeVariable]?.trim();
  return insideTestRoot(override ? resolve(override) : documentsUserRoot());
}

/** `<Documents>\Pe.Tools` from the known folder, ignoring any override: the default user root. */
export function documentsUserRoot(): string {
  return join((cached ??= resolveDocumentsPath()), productIdentity.productName);
}

export type HomeTier = "user" | "project" | "firm";
export type Home = { readonly tier: HomeTier; readonly root: string };

const markerSchema = z.strictObject({ tier: z.enum(["user", "project", "firm"]) });

/** The tier a folder's marker claims; null when it has no marker or the marker is not exactly `{tier}`. */
export function homeTier(root: string): HomeTier | null {
  const marker = readStored(join(root, productPathNames.homeMarkerFileName), markerSchema, {
    class: "keep",
    place: "Home marker",
  });
  return marker.kind === "ok" ? marker.value.tier : null;
}

/**
 * The firm home; or, with none, every place the probe looked. `refused` holds the folders when the
 * probe found more than one firm marker: none is used, as with a pod id claimed twice.
 */
export type FirmHome = {
  readonly root: string | null;
  readonly looked: readonly string[];
  readonly refused?: readonly string[];
};

/**
 * Homes freeze shape 3: on each drive, `<drive>\Shared drives\*\04 PE Software Files\Pe.Tools`
 * and `<drive>\04 PE Software Files\Pe.Tools`, accepted only when its marker reads `firm`. Two
 * accepted folders (a `subst` letter beside the real drive, a second mount) refuse both: the
 * machine runs with no firm home and the notice names each.
 */
export function probeFirmHome(drives: readonly string[]): FirmHome {
  const looked: string[] = [];
  const found: string[] = [];
  for (const drive of drives) {
    const sharedDrives = join(drive, productPathNames.sharedDrivesDirectoryName);
    let mounts: string[] = [];
    try {
      mounts = readdirSync(sharedDrives).sort();
    } catch {
      // No `Shared drives` folder on this drive: only its root is a candidate.
    }
    looked.push(
      join(sharedDrives, "*", ...productPathNames.firmHomeSegments),
      join(drive, ...productPathNames.firmHomeSegments),
    );
    found.push(
      ...[...mounts.map((mount) => join(sharedDrives, mount)), drive]
        .map((base) => join(base, ...productPathNames.firmHomeSegments))
        .filter((candidate) => homeTier(candidate) === "firm"),
    );
  }
  return found.length === 1
    ? { root: found[0]!, looked }
    : { root: null, looked, ...(found.length ? { refused: found } : {}) };
}

/**
 * Every mounted drive root. A test run probes none: a test names its drives, so the owner's real
 * firm home never reaches a fixture.
 * ponytail: `existsSync` on a disconnected network letter can block for seconds; ask the OS for
 * the mounted volumes if a start is ever measured slow on it.
 */
const mountedDrives = (): string[] =>
  process.platform !== "win32" || process.env[testHomeRootVariable]
    ? []
    : [..."CDEFGHIJKLMNOPQRSTUVWXYZ"].map((letter) => `${letter}:\\`).filter((d) => existsSync(d));

let probed: { firm: FirmHome; at: number } | undefined;

/**
 * The firm home: the dev override `PE_TOOLS_SHARED_ROOT` taken as told, else the probe. `drives`
 * replaces the machine's drives (tests). A found home is kept for the process; a miss is probed
 * again after 30 s, so a drive that mounts late (Google Drive after sign-in) is picked up.
 */
export function firmHome(drives?: readonly string[]): FirmHome {
  const override = process.env[productPathNames.sharedRootVariable]?.trim();
  if (override) return { root: insideTestRoot(resolve(override)), looked: [] };
  if (drives) return inside(probeFirmHome(drives));
  if (!probed || (!probed.firm.root && Date.now() - probed.at > 30_000))
    probed = { firm: probeFirmHome(mountedDrives()), at: Date.now() };
  return inside(probed.firm);
}
const inside = (firm: FirmHome): FirmHome => {
  for (const root of [firm.root, ...(firm.refused ?? [])]) if (root) insideTestRoot(root);
  return firm;
};

/** What a person reads when there is no firm home: what was looked for and where, or the folders refused. */
export const noFirmHomeText = (firm: Pick<FirmHome, "looked" | "refused">): string =>
  firm.refused
    ? `No firm home: ${firm.refused.join(" and ")} each hold a ${productPathNames.homeMarkerFileName} of tier "firm". Neither is used until only one is mounted.`
    : `No firm home: no folder with a ${productPathNames.homeMarkerFileName} of tier "firm" at ${
        firm.looked.length ? firm.looked.join(", ") : "any drive (none was probed)"
      }.`;

/**
 * The shared drive root, the base a project pointer is relative to (homes freeze shape 4): the
 * folder that holds `04 PE Software Files`, so the firm home's grandparent, override or probe.
 */
export function sharedDriveRoot(drives?: readonly string[]): string | null {
  const firm = firmHome(drives).root;
  return firm && dirname(dirname(firm));
}

export type HomesInput = {
  /** The project home the target document names; listed only when its marker reads `project`. */
  readonly project?: string | null;
  /** Replaces the machine's drives in the firm probe (tests). */
  readonly drives?: readonly string[];
};

/** The home list: user, the target document's project home, firm. A pod id is unique across it. */
export function homes(input: HomesInput = {}): Home[] {
  const project = input.project?.trim() ? resolve(input.project.trim()) : null;
  const firm = firmHome(input.drives).root;
  return [
    { tier: "user", root: userRoot() },
    ...(project && homeTier(project) === "project"
      ? [{ tier: "project" as const, root: insideTestRoot(project) }]
      : []),
    ...(firm ? [{ tier: "firm" as const, root: firm }] : []),
  ];
}

/** One content folder (`Pods`, `Pages`, `Catalogs`) in every home, in list order. */
export const homeDirs = (name: string, input?: HomesInput): string[] =>
  homes(input).map((home) => join(home.root, name));

/** The firm home's tiered values, `<firm>\Settings`; null without a firm home. */
export function firmSettingsDir(drives?: readonly string[]): string | null {
  const firm = firmHome(drives).root;
  return firm && join(firm, productPathNames.homeSettingsDirectoryName);
}

/** The firm key file, `<firm>\keys.json`; null without a firm home. */
export function firmKeysPath(drives?: readonly string[]): string | null {
  const firm = firmHome(drives).root;
  return firm && join(firm, productPathNames.keysFileName);
}

function resolveDocumentsPath(): string {
  if (process.platform !== "win32") return join(homedir(), "Documents");
  // reg.exe, not powershell.exe: no shell, no profile, no 1 second budget to lose. The raw
  // REG_EXPAND_SZ still carries the redirection; PowerShell's GetFolderPath cost ~700ms and a
  // timeout there is indistinguishable from "no redirection".
  let output: string;
  try {
    output = execFileSync("reg.exe", ["query", userShellFolders, "/v", "Personal"], {
      encoding: "utf8",
      windowsHide: true,
    });
  } catch (error) {
    throw new Error(
      `Documents known folder unreadable: reg query '${userShellFolders}' /v Personal failed (${String(error)}). Set ${productPathNames.productHomeVariable} to name the product home explicitly.`,
    );
  }
  return parseDocumentsKnownFolder(output, process.env);
}

/**
 * Pure half, so the OneDrive-redirected case is a deterministic test rather than a machine.
 * `reg query` prints `    Personal    REG_EXPAND_SZ    %USERPROFILE%\OneDrive\Documents`.
 */
export function parseDocumentsKnownFolder(
  regQueryOutput: string,
  env: Record<string, string | undefined>,
): string {
  const match = /^\s*Personal\s+REG_(?:EXPAND_)?SZ\s+(.+?)\s*$/m.exec(regQueryOutput);
  if (!match)
    throw new Error(`Documents known folder unreadable: no Personal value in:\n${regQueryOutput}`);
  return match[1]!.replace(/%([^%]+)%/g, (_whole, name: string) => {
    const value = env[name] ?? env[name.toUpperCase()];
    if (!value) throw new Error(`Documents known folder names undefined variable '${name}'.`);
    return value;
  });
}
