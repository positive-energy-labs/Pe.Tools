/**
 * The ONE content-home resolver (ADR 0035 rule 11). Host, mcps, and runtime import this; nobody
 * keeps a copy, and the Revit side (`ProductPathing`) and PowerShell (`tools/product-paths.ps1`)
 * read the same names.
 *
 * Two homes. The user root always exists: an isolated `PE_TOOLS_PRODUCT_HOME`, else
 * `<Documents>\Pe.Tools`. Documents is routinely redirected (OneDrive, a mapped profile), so
 * `%USERPROFILE%\Documents` is a different content home, not a fallback: this reads the known
 * folder or throws. The optional `PE_TOOLS_SHARED_ROOT` is the second home. Pods, Pages and
 * Catalogs read user first then shared (the user's copy wins), every write and all Work go to the
 * user root, and shared settings (firm files, keys) live only on the shared root.
 */
import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, relative, resolve, isAbsolute } from "node:path";
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

/** The user's content root: always present; every write lands here. The Documents lookup is cached per process. */
export function userRoot(): string {
  const override = process.env[productPathNames.productHomeVariable]?.trim();
  return insideTestRoot(override ? resolve(override) : documentsUserRoot());
}

/** `<Documents>\Pe.Tools` from the known folder, ignoring any override: the default user root. */
export function documentsUserRoot(): string {
  return join((cached ??= resolveDocumentsPath()), productIdentity.productName);
}

/** The optional shared content root; null when `PE_TOOLS_SHARED_ROOT` is unset. */
export function sharedRoot(): string | null {
  const shared = process.env[productPathNames.sharedRootVariable]?.trim();
  return shared ? insideTestRoot(resolve(shared)) : null;
}

/** The read order: user first, so an item in both homes resolves to the user's copy. */
export function contentHomes(): string[] {
  const shared = sharedRoot();
  return shared ? [userRoot(), shared] : [userRoot()];
}

/** The firm files' folder, `<shared>\Firm`; null without a shared root. */
export function sharedFirmDir(): string | null {
  const shared = sharedRoot();
  return shared && join(shared, "Firm");
}

/** The shared keys file, `<shared>\keys.json`; null without a shared root. */
export function sharedKeysPath(): string | null {
  const shared = sharedRoot();
  return shared && join(shared, "keys.json");
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
