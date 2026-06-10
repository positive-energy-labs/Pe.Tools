import { execSync } from "node:child_process";
import { readdir } from "node:fs/promises";
import { hostname } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { Agent } from "@mastra/core/agent";
import type { Harness, HarnessMode } from "@mastra/core/harness";
import type { MastraModelConfig } from "@mastra/core/llm";
import { MockMemory } from "@mastra/core/memory";
import type { MastraCompositeStore } from "@mastra/core/storage";
import type { RequestContext } from "@mastra/core/request-context";
import {
  LocalFilesystem,
  LocalSandbox,
  Workspace,
  type Workspace as MastraWorkspace,
} from "@mastra/core/workspace";
import { createRuntimeHarness } from "../../pe-tools/packages/runtime/src/harness/create-runtime-harness.ts";
import {
  createRuntimeSessions,
  type RuntimeSessionOptions,
} from "../../pe-tools/packages/runtime/src/session/runtime-sessions.ts";
import type {
  RuntimeSendMessageOptions,
  RuntimeSessions,
  RuntimeThreadSession,
} from "../../pe-tools/packages/runtime/src/runtime.ts";
import type { RuntimeEvent } from "../../pe-tools/packages/runtime/src/events.ts";
import type { RuntimeResumeDecision } from "../../pe-tools/packages/runtime/src/interrupts.ts";
import { type RuntimeContextEntry } from "../../pe-tools/packages/runtime/src/context.ts";
import type { RuntimeToolSource } from "../../pe-tools/packages/runtime/src/tool-metadata.ts";
import { createRuntimeSkillSource } from "./runtime-skill-source.js";
import {
  createDefaultMastraCodeStorage,
  createPeaLocalStorage,
} from "./mastracode-storage.js";
import type { PeaAuthSource } from "./beta-auth-bootstrap.js";

export type PeaRuntimeTools = Record<string, any>;
export type PeaRuntimeHarness = Harness<Record<string, unknown>>;
export type PeaRuntimeAuthStorage = any;
export type PeaRuntimeModel = MastraModelConfig;
export type PeaRuntimeThreadSession = RuntimeThreadSession;
export type PeaRuntimeSendMessageOptions = RuntimeSendMessageOptions;
export type PeaRuntimeSessions = RuntimeSessions;
export type PeaRuntimeContextEntry = RuntimeContextEntry;
export type PeaRuntimeEvent = RuntimeEvent;
export type PeaRuntimeResumeDecision = RuntimeResumeDecision;

export interface PeaRuntimeSessionOptions extends RuntimeSessionOptions {}

export interface PeaRuntimeBase {
  harness: PeaRuntimeHarness;
  agent: Agent;
  mastraWorkspace: MastraWorkspace;
  sessions: PeaRuntimeSessions;
  authStorage: PeaRuntimeAuthStorage;
  hookManager?: undefined;
  mcpManager?: undefined;
}

export interface CreatePeaAppRuntimeBaseOptions {
  cwd: string;
  id: string;
  workspaceName: string;
  agent: Agent;
  modes: HarnessMode<Record<string, unknown>>[];
  tools: PeaRuntimeTools;
  skillPaths: string[];
  memorySkillMounts: Parameters<typeof createRuntimeSkillSource>[0]["memoryMounts"];
  storage: MastraCompositeStore;
  resourceId: string;
  initialState: Record<string, unknown>;
  authStorage?: PeaRuntimeAuthStorage;
  sessions?: PeaRuntimeSessions;
  sessionOptions?: PeaRuntimeSessionOptions;
  toolCatalog?: RuntimeToolSource;
}

export async function createPeaAppRuntimeBase(
  options: CreatePeaAppRuntimeBaseOptions,
): Promise<PeaRuntimeBase> {
  const memory = new MockMemory({
    storage: options.storage as never,
    enableMessageHistory: true,
    enableWorkingMemory: false, // TODO: implement later after custom runtime constructor churn finishes.
  });
  const mastraWorkspace = new Workspace({
    id: `${options.id}-workspace`,
    name: options.workspaceName,
    filesystem: new LocalFilesystem({ basePath: options.cwd, contained: true }),
    sandbox: new LocalSandbox({
      workingDirectory: options.cwd,
      env: process.env,
    }),
    skills: options.skillPaths,
    skillSource: createRuntimeSkillSource({
      cwd: options.cwd,
      memoryMounts: options.memorySkillMounts,
    }),
    checkSkillFileMtime: true,
  });
  const authStorage = options.authStorage ?? (await createPeaAuthStorage());
  authStorage.loadStoredApiKeysIntoEnv({
    anthropic: "ANTHROPIC_API_KEY",
    openai: "OPENAI_API_KEY",
    google: "GOOGLE_GENERATIVE_AI_API_KEY",
    groq: "GROQ_API_KEY",
    xai: "XAI_API_KEY",
  });

  const handle = await createRuntimeHarness({
    config: {
      id: options.id,
      resourceId: options.resourceId,
      storage: options.storage,
      memory,
      workspace: mastraWorkspace,
      modes: options.modes,
      tools: options.tools,
      initialState: options.initialState,
      modelAuthChecker: (provider) =>
        authStorage.hasStoredApiKey(provider) || authStorage.isLoggedIn(provider)
          ? true
          : undefined,
    },
    workspace: { cwd: options.cwd, root: options.cwd },
    authStorage,
    sessions: options.sessions,
    createSessions: (harness) =>
      createPeaRuntimeSessions(harness as PeaRuntimeHarness, {
        ...options.sessionOptions,
        toolCatalog: options.toolCatalog ?? options.sessionOptions?.toolCatalog,
      }),
  });

  return {
    harness: handle.harness,
    agent: options.agent,
    mastraWorkspace,
    sessions: handle.sessions,
    authStorage,
  };
}

export async function createPeaAuthStorage(): Promise<PeaRuntimeAuthStorage> {
  const module = (await import("mastracode")) as {
    createAuthStorage(): PeaRuntimeAuthStorage;
  };
  return module.createAuthStorage();
}

export function createPeaProductRuntimeStorage(
  cwd: string,
  configDir?: string,
): Promise<MastraCompositeStore> {
  return createPeaLocalStorage(cwd, configDir);
}

export function createPeCodeRuntimeStorage(): Promise<MastraCompositeStore> {
  return createDefaultMastraCodeStorage();
}

const openAiProviderPrefix = "openai/";

export async function resolveDevAgentModel(options: {
  modelId: string;
  authSource?: PeaAuthSource;
  authStorage: PeaRuntimeAuthStorage;
  requestContext?: RequestContext;
  resolveModel?: (modelId: string, options?: Record<string, unknown>) => Promise<unknown>;
}): Promise<PeaRuntimeModel> {
  const modelId = options.modelId.trim();
  assertDevAgentModelAuthPolicy(modelId, options.authSource ?? "auto", options.authStorage);

  const resolveModel = options.resolveModel ?? (await defaultModelResolver());
  return (await resolveModel(modelId, {
    thinkingLevel: resolveThinkingLevel(options.requestContext),
    remapForCodexOAuth: true,
    requestContext: options.requestContext,
  })) as PeaRuntimeModel;
}

async function defaultModelResolver(): Promise<
  (modelId: string, options?: Record<string, unknown>) => Promise<unknown>
> {
  const module = await import("./mastracode-model.js");
  return module.resolveMastraCodeModel as (
    modelId: string,
    options?: Record<string, unknown>,
  ) => Promise<unknown>;
}

function assertDevAgentModelAuthPolicy(
  modelId: string,
  authSource: PeaAuthSource,
  authStorage: PeaRuntimeAuthStorage,
): void {
  if (!modelId.startsWith(openAiProviderPrefix) || authSource !== "oauth") return;

  authStorage.reload();
  const credential = authStorage.get("openai-codex") as { type?: string } | undefined;
  if (credential?.type !== "oauth") {
    throw new Error(
      "OpenAI Codex OAuth is required for this dev-agent runtime, but no OAuth credential is stored. Run /login or use --auth-source api-key.",
    );
  }
}

function resolveThinkingLevel(
  requestContext: RequestContext | undefined,
): "off" | "low" | "medium" | "high" | "xhigh" | undefined {
  const harness = requestContext?.get("harness") as
    | {
        getState?: () => Record<string, unknown>;
        state?: Record<string, unknown>;
      }
    | undefined;
  const state = harness?.getState?.() ?? harness?.state;
  const thinkingLevel = state?.thinkingLevel;
  return isThinkingLevel(thinkingLevel) ? thinkingLevel : undefined;
}

function isThinkingLevel(value: unknown): value is "off" | "low" | "medium" | "high" | "xhigh" {
  return (
    value === "off" || value === "low" || value === "medium" || value === "high" || value === "xhigh"
  );
}

export function createLocalResourceId(cwd: string, configDir = ".pea"): string {
  const digest = createHash("sha256")
    .update(`${hostname()}\n${path.resolve(cwd)}`)
    .digest("hex")
    .slice(0, 16);
  return `${createResourceNamespace(configDir)}:${digest}`;
}

export function createDevAgentResourceId(cwd: string): string {
  const rootPath = git("rev-parse --show-toplevel", cwd) ?? path.resolve(cwd);
  const gitUrl = resolveGitRemoteUrl(cwd);
  const resourceIdSource = gitUrl ? normalizeGitUrl(gitUrl) : rootPath;
  const baseName = gitUrl
    ? gitUrl.split("/").pop()?.replace(/\.git$/, "") || "project"
    : path.basename(rootPath);
  return `${slugify(baseName)}-${shortHash(resourceIdSource)}`;
}

function resolveGitRemoteUrl(cwd: string): string | undefined {
  const origin = git("remote get-url origin", cwd);
  if (origin) return origin;

  const remotes = git("remote", cwd);
  const firstRemote = remotes?.split("\n")[0];
  return firstRemote ? git(`remote get-url ${firstRemote}`, cwd) : undefined;
}

function git(args: string, cwd: string): string | undefined {
  try {
    return execSync(`git ${args}`, {
      cwd,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
  } catch {
    return undefined;
  }
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function shortHash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 12);
}

function normalizeGitUrl(url: string): string {
  return url
    .replace(/\.git$/, "")
    .replace(/^git@([^:]+):/, "https://$1/")
    .replace(/^ssh:\/\/git@/, "https://")
    .toLowerCase();
}

function createResourceNamespace(configDir: string): string {
  return configDir.replace(/^\.+/, "") || "pea";
}

export function createPeaRuntimeSessions(
  harness: PeaRuntimeHarness,
  sessionOptions: PeaRuntimeSessionOptions = {},
): PeaRuntimeSessions {
  return createRuntimeSessions(harness, {
    ...sessionOptions,
    contextFailureFormatter: sessionOptions.contextFailureFormatter ?? peaContextFailure,
  });
}

function peaContextFailure(error: unknown): string {
  const detail = escapeXml(error instanceof Error ? error.message : String(error));
  return `<pea-startup-context>\nContext seed unavailable: ${detail}. Use pe_status for fresh host/Revit state.\n</pea-startup-context>`;
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export async function resolveDevAgentProjectRoot(startPath: string): Promise<string> {
  let current = startPath;

  while (true) {
    const entries = await readDirectoryEntries(current);
    if (
      entries.some(
        (entry) => entry.isFile() && (entry.name.endsWith(".slnx") || entry.name.endsWith(".sln")),
      )
    )
      return current;

    if (entries.some((entry) => entry.name === ".git")) return current;

    const parent = path.dirname(current);
    if (parent === current) return startPath;

    current = parent;
  }
}

async function readDirectoryEntries(directory: string) {
  try {
    return await readdir(directory, { withFileTypes: true });
  } catch {
    return [];
  }
}

export function firstNonBlank(...values: Array<string | undefined>): string | undefined {
  return values.find((value) => value != null && value.trim().length > 0)?.trim();
}
