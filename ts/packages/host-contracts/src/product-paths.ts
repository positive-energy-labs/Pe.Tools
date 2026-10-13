/**
 * The ONE product home resolver. Host, mcps, and runtime import this; nobody keeps a copy, and the
 * Revit side (`ProductPathing.ResolveProductHome`) reads the same override name.
 *
 * `PE_TOOLS_PRODUCT_HOME` names the whole home (Pages, Pods, skills, backups, script output).
 * Without it the home is `<Documents>\Pe.Tools`. Documents is routinely redirected (OneDrive, a
 * mapped profile), so `%USERPROFILE%\Documents` is a different content home, not a fallback. A resolver that silently produces it lets two
 * processes on one machine disagree about where the pods are. This one reads the known folder
 * or throws.
 */
import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { productIdentity, productPathNames } from "./contracts/product.ts";

const userShellFolders =
  "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\User Shell Folders";

let cached: string | undefined;

/** The product home. The Documents lookup is cached once per process; the override is always live. */
export function productHomePath(): string {
  const override = process.env[productPathNames.productHomeVariable]?.trim();
  if (override) return resolve(override);
  return join((cached ??= resolveDocumentsPath()), productIdentity.productName);
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
  const expanded = match[1]!.replace(/%([^%]+)%/g, (_whole, name: string) => {
    const value = env[name] ?? env[name.toUpperCase()];
    if (!value) throw new Error(`Documents known folder names undefined variable '${name}'.`);
    return value;
  });
  return expanded;
}
