import { execFileSync } from "node:child_process";
import { homedir, platform } from "node:os";
import { join } from "node:path";
import { productIdentity, productPathNames } from "@pe/host-contracts/contracts";

let cachedDocumentsPath: string | null = null;

export function userDocumentsPath(): string {
  const override = process.env.PE_TOOLS_DOCUMENTS_ROOT?.trim();
  if (override) return override;
  if (cachedDocumentsPath) return cachedDocumentsPath;

  cachedDocumentsPath = resolveUserDocumentsPath();
  return cachedDocumentsPath;
}

export function productUserContentRootPath(): string {
  return join(userDocumentsPath(), productIdentity.productName);
}

export function productSettingsRootPath(): string {
  return join(productUserContentRootPath(), productPathNames.settingsDirectoryName);
}

export function productGlobalSettingsPath(): string {
  return join(productSettingsRootPath(), productPathNames.globalDirectoryName, "settings.json");
}

function resolveUserDocumentsPath(): string {
  if (platform() === "win32") {
    const knownFolder = readWindowsDocumentsKnownFolder();
    if (knownFolder) return knownFolder;
  }

  return process.env.USERPROFILE
    ? join(process.env.USERPROFILE, "Documents")
    : join(homedir(), "Documents");
}

function readWindowsDocumentsKnownFolder(): string | null {
  try {
    const output = execFileSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        "[Environment]::GetFolderPath('MyDocuments')",
      ],
      { encoding: "utf8", timeout: 1_000, windowsHide: true },
    ).trim();
    return output || null;
  } catch {
    return null;
  }
}
