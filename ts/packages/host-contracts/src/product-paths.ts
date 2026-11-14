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
import { execFile, execFileSync } from "node:child_process";
import { access, readFile, readdir, realpath } from "node:fs/promises";
import { promisify } from "node:util";
import { existsSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, relative, resolve, isAbsolute } from "node:path";
import { z } from "zod";
import { productIdentity, productPathNames } from "./contracts/product.ts";

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

/** The tier a marker's text proves: exactly `{"tier": ...}` and nothing else (a byte order mark is not content). */
export function markerTier(text: string | null): HomeTier | null {
  if (text === null) return null;
  try {
    const marker = markerSchema.safeParse(JSON.parse(text.replace(/^﻿/, "")));
    return marker.success ? marker.data.tier : null;
  } catch {
    return null;
  }
}

/** What the resolver reads from the machine. A test, and the fixture shared with C#, supply their own. */
export type HomeFacts = {
  readonly drives: readonly string[];
  /** A directory's child names; empty when it is not a directory. */
  readonly list: (directory: string) => readonly string[];
  /** The text of a folder's `pe-home.json`; null when it has none. */
  readonly marker: (folder: string) => string | null;
};

/** The disk's facts over the given drive roots (default: every mounted drive). */
export const machineFacts = (drives: readonly string[] = mountedDrives()): HomeFacts => ({
  drives,
  list: (directory) => {
    try {
      return readdirSync(directory);
    } catch {
      return [];
    }
  },
  marker: (folder) => {
    try {
      return readFileSync(join(folder, productPathNames.homeMarkerFileName), "utf8");
    } catch {
      return null;
    }
  },
});

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

/**
 * The firm home; or, with none, every place that was read. `refused` holds the folders when the
 * probe found more than one firm marker: none is used, as with a pod id claimed twice.
 */
export type FirmHome = {
  readonly root: string | null;
  readonly looked: readonly string[];
  readonly refused?: readonly string[];
};

/**
 * Homes freeze shape 3: on each drive, `<drive>\Shared drives\*\04 PE Software Files\Pe.Tools`
 * (children in code unit order) then `<drive>\04 PE Software Files\Pe.Tools`, accepted only when
 * its marker reads `firm`. Two accepted folders (a `subst` letter beside the real drive, a second
 * mount) refuse both: the machine runs with no firm home and the notice names each.
 */
const firmHomeSegments = [
  productPathNames.firmSoftwareDirectoryName,
  productIdentity.userVisibleProductName,
] as const;

export function probeFirmHome(facts: HomeFacts): FirmHome {
  const looked: string[] = [];
  const found: string[] = [];
  for (const drive of facts.drives) {
    const sharedDrives = join(drive, productPathNames.sharedDrivesDirectoryName);
    looked.push(
      join(sharedDrives, "*", ...firmHomeSegments),
      join(drive, ...firmHomeSegments),
    );
    found.push(
      ...[...[...facts.list(sharedDrives)].sort().map((mount) => join(sharedDrives, mount)), drive]
        .map((base) => join(base, ...firmHomeSegments))
        .filter((candidate) => markerTier(facts.marker(candidate)) === "firm"),
    );
  }
  return found.length === 1
    ? { root: found[0]!, looked }
    : { root: null, looked, ...(found.length ? { refused: found } : {}) };
}

let probed: { firm: FirmHome; at: number; facts?: HomeFacts } | undefined;

/**
 * The firm home. The dev override `PE_TOOLS_SHARED_ROOT` names it outright and replaces the probe;
 * it still needs the `firm` marker. A found home is cached but its marker is re-read on each call.
 * A miss is probed again after 30 s, so a drive that mounts late (Google Drive after sign-in) is
 * picked up. Injected facts use the same cache, scoped to that facts object.
 */
export function firmHome(facts?: HomeFacts): FirmHome {
  const override = process.env[productPathNames.sharedRootVariable]?.trim();
  if (override) {
    const told = insideTestRoot(resolve(override));
    const proven = markerTier((facts ?? machineFacts([])).marker(told)) === "firm";
    return { root: proven ? told : null, looked: [told] };
  }
  if (
    probed?.facts === facts && probed?.firm.root &&
    markerTier((facts ?? machineFacts([])).marker(probed.firm.root)) !== "firm"
  )
    probed = { ...probed, firm: { ...probed.firm, root: null } };
  if (!probed || probed.facts !== facts || (!probed.firm.root && Date.now() - probed.at > 30_000))
    probed = { firm: probeFirmHome(facts ?? machineFacts()), at: Date.now(), facts };
  return inside(probed.firm);
}
const inside = (firm: FirmHome): FirmHome => {
  for (const root of [firm.root, ...(firm.refused ?? [])]) if (root) insideTestRoot(root);
  return firm;
};

/** What a person reads when there is no firm home: what was looked for and where, or the folders refused. */
export const noFirmHomeText = (firm: Pick<FirmHome, "looked" | "refused">): string =>
  firm.refused
    ? `No firm home: ${firm.refused.join(" and ")} each hold a ${productPathNames.homeMarkerFileName} of tier "firm". None is used until only one is mounted.`
    : `No firm home: no folder with a ${productPathNames.homeMarkerFileName} of tier "firm" at ${
        firm.looked.length ? firm.looked.join(", ") : "any drive (none was probed)"
      }.`;

/**
 * The shared drive root, the base a project pointer is relative to (homes freeze shape 4): the
 * folder that holds `04 PE Software Files`, so the firm home's grandparent, override or probe.
 * Null when the firm home sits one folder below its drive: it has no grandparent.
 */
export function sharedDriveRoot(facts?: HomeFacts): string | null {
  const firm = firmHome(facts).root;
  if (!firm) return null;
  const parent = dirname(firm);
  return dirname(parent) === parent ? null : dirname(parent);
}

/**
 * The project home a model's pointer names: `<shared drive root>\<pointer>\Pe.Tools`, accepted
 * only when its marker reads `project`. The pointer is model data, so it is untrusted: anything
 * but a forward-slash relative path that stays inside the shared drive root is unbound, never a throw.
 */
export function projectHome(pointer: string | null | undefined, facts?: HomeFacts): string | null {
  const root = projectCandidate(pointer, firmHome(facts).root);
  return root && markerTier((facts ?? machineFacts([])).marker(insideTestRoot(root))) === "project" ? root : null;
}

function projectCandidate(pointer: string | null | undefined, firm: string | null): string | null {
  const parent = firm && dirname(firm);
  const base = parent && dirname(parent) !== parent ? dirname(parent) : null;
  const segments = pointer?.split("/") ?? [];
  if (!base || !pointer || /[\\:]/.test(pointer)) return null;
  if (segments.some((segment) => !segment.trim() || segment === "." || segment === "..")) return null;
  return join(base, ...segments, productIdentity.productName);
}

/** Cold document binding uses the already resolved firm home; it never probes drives. */
export async function resolveProjectHome(pointer: string, firm: string | null): Promise<string | null> {
  const root = projectCandidate(pointer, firm);
  if (!root) return null;
  const text = await readFile(join(root, productPathNames.homeMarkerFileName), "utf8").catch(() => null);
  return markerTier(text) === "project" ? root : null;
}

/**
 * The project home a file sits in: the nearest folder above it that is a project home, or holds
 * one as its `Pe.Tools` child (freeze shape 4). For a caller with a file and no target document
 * (a document parse in an MCP child, a Pod's own folder); null when the file is in no project.
 */
export function projectHomeAbove(path: string, facts: HomeFacts = machineFacts([])): string | null {
  for (let dir = resolve(path); ; dir = dirname(dir)) {
    for (const home of [dir, join(dir, productIdentity.productName)])
      if (markerTier(facts.marker(home)) === "project") return insideTestRoot(home);
    if (dirname(dir) === dir) return null;
  }
}

export type HomesInput = {
  /** `data.path` of the target document's project-home blob; absent or unusable is unbound. */
  readonly pointer?: string | null;
  /** Replaces the machine's facts (tests, the shared fixture). */
  readonly facts?: HomeFacts;
};

/** The home list: user, the target document's project home, firm. A pod id is unique across it. */
export function homes(input: HomesInput = {}): Home[] {
  const project = projectHome(input.pointer, input.facts);
  const firm = firmHome(input.facts).root;
  return [
    { tier: "user", root: userRoot() },
    ...(project ? [{ tier: "project" as const, root: project }] : []),
    ...(firm ? [{ tier: "firm" as const, root: firm }] : []),
  ];
}

/**
 * How a home was found: the user home is the Documents folder or the product-home override, a
 * project home comes from the document's pointer, and the firm home from the drive probe or the
 * dev override. Every project and firm home is also proven by its marker.
 */
export type HomeFound = "documents" | "override" | "pointer" | "probe";
export type FoundHome = Home & { readonly found: HomeFound };

/** The home list with how each was found, and the firm home's absence in words when there is none. */
export function homesFound(input: HomesInput = {}): {
  homes: FoundHome[];
  firmNotice: string | null;
} {
  const told = (variable: string) => Boolean(process.env[variable]?.trim());
  const found = (tier: HomeTier): HomeFound =>
    tier === "project"
      ? "pointer"
      : tier === "user"
        ? told(productPathNames.productHomeVariable) ? "override" : "documents"
        : told(productPathNames.sharedRootVariable) ? "override" : "probe";
  const firm = firmHome(input.facts);
  return {
    homes: homes(input).map((home) => ({ ...home, found: found(home.tier) })),
    firmNotice: firm.root ? null : noFirmHomeText(firm),
  };
}

/** What the host log says about homes at start: one line per home, and one for a firm home not found. */
export const homeLogLines = (found = homesFound()): string[] => [
  ...found.homes.map((home) => `Home ${home.tier}: ${home.root} (found by ${home.found})`),
  ...(found.firmNotice ? [found.firmNotice] : []),
];

/** One content folder (`Pods`, `Pages`, `Catalogs`) in every home, in list order. */
export const homeDirs = (name: string, input?: HomesInput): string[] =>
  homes(input).map((home) => join(home.root, name));

/** Async machine read for long-lived owners. Never probes the network on a request's stack. */
export async function resolveHomes(pointers: readonly string[] = []): Promise<Map<string, Home[]>> {
  const check = async (path: string) => {
    if (process.env[testHomeRootVariable]) {
      const temp = await realpath(tmpdir());
      if (![tmpdir(), temp].some(root => {
        const away = relative(resolve(root), resolve(path));
        return !away.startsWith("..") && !isAbsolute(away);
      })) throw Error(`Test isolation: '${path}' is outside the temp directory.`);
    }
    return path;
  };
  const marker = async (root: string) => readFile(join(await check(root), productPathNames.homeMarkerFileName), "utf8").catch(() => null);
  const override = process.env[productPathNames.productHomeVariable]?.trim();
  if (!override && !cached) {
    cached = process.platform === "win32"
      ? parseDocumentsKnownFolder((await promisify(execFile)("reg.exe", ["query", userShellFolders, "/v", "Personal"], { encoding: "utf8", windowsHide: true })).stdout, process.env)
      : join(homedir(), "Documents");
  }
  const userPath = override ? resolve(override) : cached && join(cached, productIdentity.productName);
  if (!userPath) throw Error("Documents known folder unreadable");
  const user = await check(userPath);
  const told = process.env[productPathNames.sharedRootVariable]?.trim();
  let firm: string | null = null;
  if (told) {
    const root = await check(resolve(told));
    if (markerTier(await marker(root)) === "firm") firm = root;
  } else {
    const drives = process.platform !== "win32" || process.env[testHomeRootVariable] ? [] :
      (await Promise.all([..."CDEFGHIJKLMNOPQRSTUVWXYZ"].map(async letter => {
        const root = `${letter}:\\`;
        return await access(root).then(() => root, () => null);
      }))).filter((root): root is string => root !== null);
    const lists = new Map<string, string[]>(), markers = new Map<string, string | null>();
    await Promise.all(drives.map(async drive => {
      const shared = join(drive, productPathNames.sharedDrivesDirectoryName);
      const names = await readdir(shared).catch(() => []);
      lists.set(shared, names);
      await Promise.all([drive, ...names.map(name => join(shared, name))].map(async base => {
        const root = join(base, ...firmHomeSegments);
        markers.set(root, await marker(root));
      }));
    }));
    firm = probeFirmHome({ drives, list: root => lists.get(root) ?? [], marker: root => markers.get(root) ?? null }).root;
  }
  const result = new Map<string, Home[]>();
  await Promise.all(["", ...pointers].map(async pointer => {
    const candidate = projectCandidate(pointer, firm);
    const project = candidate && markerTier(await marker(candidate)) === "project" ? candidate : null;
    result.set(pointer, [
      { tier: "user", root: user },
      ...(project ? [{ tier: "project" as const, root: project }] : []),
      ...(firm ? [{ tier: "firm" as const, root: firm }] : []),
    ]);
  }));
  return result;
}

/** The firm home's tiered values, `<firm>\Settings`; null without a firm home. */
export function firmSettingsDir(facts?: HomeFacts): string | null {
  const firm = firmHome(facts).root;
  return firm && join(firm, productPathNames.homeSettingsDirectoryName);
}

/** The firm key file, `<firm>\keys.json`; null without a firm home. */
export function firmKeysPath(facts?: HomeFacts): string | null {
  const firm = firmHome(facts).root;
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
