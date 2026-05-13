import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const openAiEnvName = "OPENAI_API_KEY";
const mastraAppDirectoryName = "mastracode";
const peProductDirectoryName = "Pe.Tools";
const bootstrapScriptPath =
  "G:\\Shared drives\\PE Team Folder\\04 PE Software Files\\Pe.Tools\\pea-beta-bootstrap.ps1";
const teamFolderPath = "G:\\Shared drives\\PE Team Folder";
const bootstrapWaitIntervalMs = 2500;

interface AuthProbe {
  isConfigured: boolean;
  source?: string;
}

export async function ensurePeaBetaAuth(): Promise<void> {
  const initialProbe = await probePeaBetaBootstrap();
  if (initialProbe.isConfigured) return;

  writeBootstrapInstructions(initialProbe.missing);

  while (true) {
    await delay(bootstrapWaitIntervalMs);
    const probe = await probePeaBetaBootstrap();
    if (probe.isConfigured) {
      console.log("\nPe Agent beta bootstrap is configured.\n");
      return;
    }

    process.stdout.write(".");
  }
}

interface BootstrapProbe {
  isConfigured: boolean;
  missing: string[];
}

async function probePeaBetaBootstrap(): Promise<BootstrapProbe> {
  const missing: string[] = [];
  const openAi = await probeOpenAiAuth();
  if (!openAi.isConfigured) missing.push("OpenAI API key");

  const peSettings = await probePeGlobalSettings();
  if (!peSettings.isConfigured) missing.push("Pe.Tools global APS settings");

  return {
    isConfigured: missing.length === 0,
    missing,
  };
}

async function probeOpenAiAuth(): Promise<AuthProbe> {
  const processValue = firstNonBlank(process.env[openAiEnvName]);
  if (processValue) return { isConfigured: true, source: openAiEnvName };

  const mastraAuthValue = await readMastraOpenAiKey();
  if (mastraAuthValue) {
    process.env[openAiEnvName] = mastraAuthValue;
    return { isConfigured: true, source: "MastraCode auth.json" };
  }

  const userEnvValue = await readWindowsUserEnvironmentValue(openAiEnvName);
  if (userEnvValue) {
    process.env[openAiEnvName] = userEnvValue;
    return { isConfigured: true, source: `user ${openAiEnvName}` };
  }

  return { isConfigured: false };
}

async function probePeGlobalSettings(): Promise<AuthProbe> {
  const settingsPath = await resolvePeGlobalSettingsPath();
  if (!settingsPath) return { isConfigured: false };

  try {
    const raw = await readFile(settingsPath, "utf-8");
    const parsed = parseJsonObject(raw);
    const webClientId =
      typeof parsed.ApsWebClientId1 === "string"
        ? parsed.ApsWebClientId1.trim()
        : "";
    const webClientSecret =
      typeof parsed.ApsWebClientSecret1 === "string"
        ? parsed.ApsWebClientSecret1.trim()
        : "";

    return {
      isConfigured: webClientId.length > 0 && webClientSecret.length > 0,
      source: settingsPath,
    };
  } catch {
    return { isConfigured: false };
  }
}

async function readMastraOpenAiKey(): Promise<string | undefined> {
  const appData = firstNonBlank(process.env.APPDATA);
  if (!appData) return undefined;

  const authPath = join(appData, mastraAppDirectoryName, "auth.json");
  try {
    const raw = await readFile(authPath, "utf-8");
    const parsed = parseJsonObject(raw);
    return firstNonBlank(
      readApiKeyCredential(parsed["openai-codex"]),
      readApiKeyCredential(parsed["apikey:openai-codex"]),
      readApiKeyCredential(parsed["openai"]),
      readApiKeyCredential(parsed["apikey:openai"]),
    );
  } catch {
    return undefined;
  }
}

function readApiKeyCredential(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const credential = value as { type?: unknown; key?: unknown };
  if (credential.type !== "api_key" || typeof credential.key !== "string")
    return undefined;

  return firstNonBlank(credential.key);
}

async function readWindowsUserEnvironmentValue(
  name: string,
): Promise<string | undefined> {
  if (process.platform !== "win32") return undefined;

  try {
    const { stdout } = await execFileAsync(
      "reg.exe",
      ["query", "HKCU\\Environment", "/v", name],
      { windowsHide: true },
    );

    const match = stdout.match(
      new RegExp(`\\s${escapeRegExp(name)}\\s+REG_\\w+\\s+(.+)`, "i"),
    );
    return firstNonBlank(match?.[1]);
  } catch {
    return undefined;
  }
}

async function resolvePeGlobalSettingsPath(): Promise<string | undefined> {
  const documentsPaths = uniqueNonBlank([
    await readWindowsUserShellFolder("Personal"),
    await readWindowsDocumentsPath(),
    ...getFallbackDocumentsPaths(),
  ]);

  const candidateSettingsPaths = documentsPaths.map((documentsPath) =>
    join(
      documentsPath,
      peProductDirectoryName,
      "settings",
      "Global",
      "settings.json",
    ),
  );

  return (
    candidateSettingsPaths.find((candidate) => existsSync(candidate)) ??
    candidateSettingsPaths[0]
  );
}

async function readWindowsDocumentsPath(): Promise<string | undefined> {
  if (process.platform !== "win32") return undefined;

  try {
    const { stdout } = await execFileAsync(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "[Environment]::GetFolderPath('MyDocuments')",
      ],
      { windowsHide: true },
    );

    return firstNonBlank(stdout);
  } catch {
    return undefined;
  }
}

async function readWindowsUserShellFolder(
  name: string,
): Promise<string | undefined> {
  if (process.platform !== "win32") return undefined;

  try {
    const { stdout } = await execFileAsync(
      "reg.exe",
      [
        "query",
        "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\User Shell Folders",
        "/v",
        name,
      ],
      { windowsHide: true },
    );

    const match = stdout.match(
      new RegExp(`\\s${escapeRegExp(name)}\\s+REG_\\w+\\s+(.+)`, "i"),
    );
    return expandWindowsEnvironmentVariables(firstNonBlank(match?.[1]));
  } catch {
    return undefined;
  }
}

function getFallbackDocumentsPaths(): string[] {
  const userProfile = firstNonBlank(process.env.USERPROFILE);
  const workOneDrive = firstNonBlank(
    process.env.OneDriveCommercial,
    process.env.OneDrive,
  );
  const consumerOneDrive = firstNonBlank(process.env.OneDriveConsumer);

  return uniqueNonBlank([
    userProfile ? join(userProfile, "Documents") : undefined,
    workOneDrive ? join(workOneDrive, "Documents") : undefined,
    consumerOneDrive ? join(consumerOneDrive, "Documents") : undefined,
    userProfile ? join(userProfile, "OneDrive", "Documents") : undefined,
  ]);
}

function expandWindowsEnvironmentVariables(
  value: string | undefined,
): string | undefined {
  if (!value) return undefined;
  return value.replace(
    /%([^%]+)%/g,
    (_, name: string) => process.env[name] ?? `%${name}%`,
  );
}

function writeBootstrapInstructions(missing: string[]): void {
  console.log(
    [
      "",
      "Pe Agent needs beta access before it can start.",
      missing.length > 0 ? `Missing: ${missing.join(", ")}` : undefined,
      "",
      existsSync(teamFolderPath)
        ? `Found the PE Team Folder: ${teamFolderPath}`
        : `The PE Team Folder was not found at ${teamFolderPath}. Google Drive may still be syncing or mounted differently.`,
      "",
      "Double-click this setup script, then return here:",
      bootstrapScriptPath,
      "",
      "Waiting for setup to finish. Press Ctrl+C to cancel.",
      "",
    ]
      .filter((line) => line !== undefined)
      .join("\n"),
  );
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseJsonObject(raw: string): Record<string, unknown> {
  return JSON.parse(raw.replace(/^\uFEFF/, "")) as Record<string, unknown>;
}

function firstNonBlank(
  ...values: Array<string | undefined>
): string | undefined {
  return values
    .find((value) => value != null && value.trim().length > 0)
    ?.trim();
}

function uniqueNonBlank(values: Array<string | undefined>): string[] {
  return [
    ...new Set(
      values
        .map((value) => firstNonBlank(value))
        .filter((value) => value != null),
    ),
  ];
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
