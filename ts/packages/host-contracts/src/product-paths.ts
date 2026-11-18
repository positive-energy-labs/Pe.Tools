/**
 * The ONE content-home resolver (ADR 0037). Host, mcps, and runtime import this; nobody keeps a
 * copy, and the Revit side (`ProductPathing`) and PowerShell (`tools/product-paths.ps1`) read the
 * same names.
 *
 * User and firm homes come from Settings (`homes.json`), with dev/test environment isolation.
 * The user default is the Documents known folder. The firm default is one literal folder,
 * accepted only when it exists. Only project homes require a `pe-home.json` marker.
 */
import { execFile, execFileSync } from "node:child_process";
import { readFile, stat, realpath } from "node:fs/promises";
import { promisify } from "node:util";
import { readFileSync, statSync, realpathSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, relative, resolve, isAbsolute } from "node:path";
import { z } from "zod";
import { productIdentity, productPathNames } from "./contracts/product.ts";
import { homesConfigSchema, type HomesConfig } from "./homes-config.ts";
export { homesConfigSchema, homesStatusSchema, type HomesConfig, type HomesStatus } from "./homes-config.ts";

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

let homesConfigFile: string | undefined;

/**
 * Name this process's `state\homes.json`. `productRoot` calls it once it knows the state root, so
 * every process that knows its owner reads the same file; before that, no file is read.
 */
export function useHomesConfig(path: string | undefined): void {
  homesConfigFile = path;
}
export const homesConfigPath = (): string | undefined => homesConfigFile;

/**
 * The file's values, read on every call (a write from Settings applies at the next read). Absent is
 * `{}`. A file that does not parse is not used, and `error` says why; Settings shows it and its write
 * replaces it.
 */
export function readHomesConfig(): { config: HomesConfig; error: string | null } {
  if (!homesConfigFile) return { config: {}, error: null };
  let text: string;
  try {
    text = readFileSync(insideTestRoot(homesConfigFile), "utf8");
  } catch (error) {
    return missingHomePath(error) ? { config: {}, error: null } : { config: {}, error: String(error) };
  }
  try {
    const parsed = homesConfigSchema.safeParse(JSON.parse(text.replace(/^\uFEFF/, "")));
    return parsed.success
      ? { config: parsed.data, error: null }
      : { config: {}, error: `${homesConfigFile} is not {"firm"?: path, "user"?: path}: ${parsed.error.message}` };
  } catch (error) {
    return { config: {}, error: `${homesConfigFile} is not JSON: ${String(error)}` };
  }
}

/** The path a dev run or a person named for a tier, and how: the override, then homes.json. Null: use the default. */
export function toldHome(tier: "user" | "firm"): { path: string; found: "override" | "config" } | null {
  const variable = tier === "user" ? productPathNames.productHomeVariable : productPathNames.sharedRootVariable;
  const env = process.env[variable]?.trim();
  if (env) return { path: resolve(env), found: "override" };
  const chosen = readHomesConfig().config[tier];
  return chosen ? { path: resolve(chosen), found: "config" } : null;
}

/** The user home: always present. The Documents lookup is cached per process. */
export function userRoot(): string {
  return insideTestRoot(toldHome("user")?.path ?? documentsUserRoot());
}

/** Cache-only user identity for a degraded async resolver; never guesses a Documents folder. */
export function knownUserRoot(): string | undefined {
  const root = toldHome("user")?.path ?? (cached && join(cached, productIdentity.productName));
  if (root && process.env[testHomeRootVariable]) {
    const away = relative(resolve(tmpdir()), root);
    if (away.startsWith("..") || isAbsolute(away)) throw Error(`Test isolation: '${root}' is outside the temp directory.`);
  }
  return root;
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
    const marker = markerSchema.safeParse(JSON.parse(text.replace(/^\uFEFF/, "")));
    return marker.success ? marker.data.tier : null;
  } catch {
    return null;
  }
}

/** What the resolver reads from the machine. A test, and the fixture shared with C#, supply their own. */
export type HomeFacts = {
  readonly exists: (folder: string) => boolean;
  readonly marker: (folder: string) => string | null;
};

export const machineFacts = (): HomeFacts => ({
  exists: (folder) => {
    // Test runs never read the person's firm default. Inject facts to exercise that branch.
    if (process.env[testHomeRootVariable] && folder === defaultFirmHome) return false;
    try { return statSync(folder).isDirectory(); } catch { return false; }
  },
  marker: (folder) => {
    try { return readFileSync(join(folder, productPathNames.homeMarkerFileName), "utf8"); }
    catch { return null; }
  },
});

export const defaultFirmHome = String.raw`G:\Shared drives\PE Team Folder\04 PE Software Files\Pe.Tools`;
export type FirmHome = { readonly root: string | null; readonly looked: readonly string[] };

/** Settings, else the literal default. The environment path is retained for dev/test isolation. */
export function firmHome(facts: HomeFacts = machineFacts()): FirmHome {
  const root = toldHome("firm")?.path ?? defaultFirmHome;
  return { root: facts.exists(root) ? insideTestRoot(root) : null, looked: [root] };
}

export const noFirmHomeText = (_firm: Pick<FirmHome, "looked">): string => "Set your firm home in Settings";

/**
 * The shared drive root, the base a project pointer is relative to (homes freeze shape 4): the
 * folder that holds `04 PE Software Files`, so the firm home's grandparent, configured or default.
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
  return root && markerTier((facts ?? machineFacts()).marker(insideTestRoot(root))) === "project" ? root : null;
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
export async function resolveProjectHome(pointer: string, firm: string | null, signal?: AbortSignal): Promise<string | null> {
  signal?.throwIfAborted();
  const root = projectCandidate(pointer, firm);
  if (!root) return null;
  const text = await readFile(join(root, productPathNames.homeMarkerFileName), { encoding: "utf8", signal }).catch(error => {
    if (missingHomePath(error)) return null;
    throw error;
  });
  return markerTier(text) === "project" ? root : null;
}

/**
 * The project home a file sits in: the nearest folder above it that is a project home, or holds
 * one as its `Pe.Tools` child (freeze shape 4). For a caller with a file and no target document
 * (a document parse in an MCP child, a Pod's own folder); null when the file is in no project.
 */
export function projectHomeAbove(path: string, facts: HomeFacts = machineFacts()): string | null {
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
 * How a home was found. Only the project home requires a marker.
 */
export type HomeFound = "documents" | "override" | "config" | "pointer" | "default";
export type FoundHome = Home & { readonly found: HomeFound };

/** The home list with how each was found, and the firm home's absence in words when there is none. */
export function homesFound(input: HomesInput = {}): {
  homes: FoundHome[];
  firmNotice: string | null;
} {
  const found = (tier: HomeTier): HomeFound =>
    tier === "project" ? "pointer" : toldHome(tier)?.found ?? (tier === "user" ? "documents" : "default");
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
export type ResolveHomesOptions = {
  signal?: AbortSignal;
  onUser?: (root: string) => void;
  onFirm?: (firm: FirmHome) => void;
  onPending?: (paths: readonly string[]) => void;
};
const missingHomePath = (error: unknown) => error instanceof Error && "code" in error &&
  (error.code === "ENOENT" || error.code === "ENOTDIR");

export async function resolveHomes(pointers: readonly string[] = [], options: ResolveHomesOptions = {}): Promise<Map<string, Home[]>> {
  const pending = new Set<string>();
  const track = async <T>(path: string, read: () => Promise<T>): Promise<T> => {
    options.signal?.throwIfAborted();
    pending.add(path); options.onPending?.([...pending]);
    try {
      const value = await read();
      options.signal?.throwIfAborted();
      return value;
    } finally { pending.delete(path); options.onPending?.([...pending]); }
  };
  const optional = async <T>(read: Promise<T>, absent: T): Promise<T> => read.catch(error => {
    if (missingHomePath(error)) return absent;
    throw error;
  });
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
  const marker = async (root: string) => {
    const path = join(await check(root), productPathNames.homeMarkerFileName);
    return optional(track(path, () => readFile(path, { encoding: "utf8", signal: options.signal })), null);
  };
  const override = toldHome("user")?.path;
  if (!override && !cached) {
    cached = process.platform === "win32"
      ? parseDocumentsKnownFolder((await track("Documents known folder (reg.exe)", () => promisify(execFile)("reg.exe", ["query", userShellFolders, "/v", "Personal"], { encoding: "utf8", windowsHide: true, signal: options.signal }))).stdout, process.env)
      : join(homedir(), "Documents");
  }
  const userPath = override ?? (cached && join(cached, productIdentity.productName));
  if (!userPath) throw Error("Documents known folder unreadable");
  const user = await check(userPath);
  options.onUser?.(user);
  const root = toldHome("firm")?.path ?? defaultFirmHome;
  const present = process.env[testHomeRootVariable] && root === defaultFirmHome ? false :
    // Any stat failure is "no firm home", as in the sync resolver and the C# twin: a drive that errors is not a firm home.
    await track(root, () => stat(root).then(info => info.isDirectory(), () => false));
  const firm = present ? await check(root) : null;
  const firmReport: FirmHome = { root: firm, looked: [root] };
  options.onFirm?.(firmReport);
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
