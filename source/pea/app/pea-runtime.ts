import { readdir } from "node:fs/promises";
import path, { dirname } from "node:path";
import type {
  createMastraCode as createMastraCodeFunction,
  MastraCodeConfig,
} from "mastracode";
import {
  createPeHostClient,
  resolveHostBaseUrl,
  resolveWorkspaceKey,
} from "./pe-host.js";
import {
  ensurePeaBetaAuth,
  resolveDefaultPeaMastraAuthPath,
  type PeaAuthSource,
} from "./beta-auth-bootstrap.js";
import { ensureBundledPeaSkills } from "./bundled-skills.js";
import {
  ensureDevAgentProjectFiles,
  type DevAgentProjectFilesSummary,
} from "./dev-agent-project-files.js";
import { createPeaContextProvider } from "./pea-context-seed.js";
import { createPeaAgent, createPeaModelArgument } from "./pea-agent.js";
import {
  defaultPeaAgentModelId,
  defaultPeaObservationThreshold,
  defaultPeaOmModelId,
  defaultPeaReflectionThreshold,
} from "./pea-instructions.js";
import { repoDevTools } from "./tools/index.js";
import {
  configurePeaProductToolContext,
  peaProductTools,
} from "./tools/pea/tools.js";
import {
  ensurePeaRuntimeDefaults,
  type PeaRuntimeDefaultsSummary,
} from "./pea-runtime-defaults.js";
import {
  peaRuntimePolicy,
  type PeaRuntimePolicy,
} from "./pea-runtime-policy.js";

export interface PeaAgentOptions {
  hostBaseUrl?: string;
  workspaceKey?: string;
  workspaceRoot?: string;
  allowOauthBetaAuth?: boolean;
  authSource?: PeaAuthSource;
}

export interface DevAgentOptions {
  hostBaseUrl?: string;
  workspaceKey?: string;
  workspaceRoot?: string;
}

export interface PeaRuntimeWorkspace {
  cwd: string;
  hostBaseUrl: string;
  workspaceKey: string;
}

export interface DevAgentRuntimeWorkspace extends PeaRuntimeWorkspace {
  projectRoot: string;
}

type CreateMastraCode = typeof createMastraCodeFunction;
type MastraCodeRuntime = Awaited<ReturnType<CreateMastraCode>>;
type MastraCodeExtraTools = Exclude<
  NonNullable<MastraCodeConfig["extraTools"]>,
  Function
>;

export type PeaRuntime = MastraCodeRuntime & {
  workspace: PeaRuntimeWorkspace;
  defaults: PeaRuntimeDefaultsSummary;
  policy: PeaRuntimePolicy;
};

export type DevAgentRuntime = MastraCodeRuntime & {
  workspace: DevAgentRuntimeWorkspace;
  projectFiles: DevAgentProjectFilesSummary;
};

export async function createPeaRuntime(
  options: PeaAgentOptions = {},
): Promise<PeaRuntime> {
  const mastraAuthPath = await preparePeaAuth(options);
  process.env.APPDATA = dirname(dirname(mastraAuthPath));

  const hostBaseUrl = resolveHostBaseUrl(options.hostBaseUrl);
  const workspaceKey = resolveWorkspaceKey(options.workspaceKey);
  configurePeaProductToolContext({ hostBaseUrl, workspaceKey });

  const hostClient = createPeHostClient(hostBaseUrl);
  const cwd = await resolvePeaAgentCwd(
    hostClient,
    hostBaseUrl,
    workspaceKey,
    options.workspaceRoot,
  );

  process.chdir(cwd);

  const [{ createMastraCode }, { mastra }] = await Promise.all([
    import("mastracode"),
    import("mastracode/tui"),
  ]);

  await ensureBundledPeaSkills(cwd);
  const defaults = await ensurePeaRuntimeDefaults(cwd);
  const contextProvider = createPeaContextProvider({
    hostBaseUrl,
    workspaceKey,
    cwd,
    settingsPath: defaults.settingsPath,
  });
  const peaAgent = createPeaAgent(peaRuntimePolicy, contextProvider);

  const mastraCode = await createMastraCode({
    cwd,
    configDir: peaRuntimePolicy.configDir,
    settingsPath: defaults.settingsPath,
    disableMcp: !peaRuntimePolicy.mcpEnabled,
    modes: [
      {
        id: "agent",
        name: "Agent",
        default: true,
        defaultModelId: defaultPeaAgentModelId,
        color: mastra.green,
        agent: peaAgent,
      },
    ],
    disabledTools: ["ast_smart_edit", "file_stat", "mkdir"],
    subagents: [],
    initialState: {
      currentModelId: defaultPeaAgentModelId,
      observerModelId: defaultPeaOmModelId,
      reflectorModelId: defaultPeaOmModelId,
      observationThreshold: defaultPeaObservationThreshold,
      reflectionThreshold: defaultPeaReflectionThreshold,
      yolo: true,
      thinkingLevel: "medium",
      smartEditing: true,
      notifications: "system",
      omScope: "thread",
    },
  });

  (
    peaAgent as unknown as {
      __updateModel?: (request: { model: unknown }) => void;
    }
  ).__updateModel?.({ model: createPeaModelArgument(mastraCode.resolveModel) });

  const switchModel = mastraCode.harness.switchModel.bind(mastraCode.harness);
  mastraCode.harness.switchModel = (async (request) => {
    await switchModel({
      ...request,
      modelId: normalizePeaModelId(request.modelId),
    });
  }) as typeof mastraCode.harness.switchModel;

  return {
    ...mastraCode,
    workspace: {
      cwd,
      hostBaseUrl,
      workspaceKey,
    },
    defaults,
    policy: peaRuntimePolicy,
  };
}

export async function createDevAgentRuntime(
  options: DevAgentOptions = {},
): Promise<DevAgentRuntime> {
  const hostBaseUrl = resolveHostBaseUrl(options.hostBaseUrl);
  const workspaceKey = resolveWorkspaceKey(options.workspaceKey);
  const startPath = path.resolve(
    firstNonBlank(options.workspaceRoot) ?? process.cwd(),
  );
  const cwd = await resolveDevAgentProjectRoot(startPath);

  configurePeaProductToolContext({ hostBaseUrl, workspaceKey });
  process.chdir(cwd);

  const projectFiles = await ensureDevAgentProjectFiles(cwd);
  const { createMastraCode } = await import("mastracode");
  const mastraCode = await createMastraCode({
    cwd,
    extraTools: createDevAgentExtraTools(),
    disabledTools: ["ast_smart_edit", "file_stat", "mkdir"],
  });

  return {
    ...mastraCode,
    workspace: {
      cwd,
      projectRoot: cwd,
      hostBaseUrl,
      workspaceKey,
    },
    projectFiles,
  };
}

function createDevAgentExtraTools(): MastraCodeExtraTools {
  return {
    ...peaProductTools,
    ...repoDevTools,
  } as unknown as MastraCodeExtraTools;
}

async function resolveDevAgentProjectRoot(startPath: string): Promise<string> {
  let current = startPath;

  while (true) {
    const entries = await readDirectoryEntries(current);
    if (
      entries.some(
        (entry) =>
          entry.isFile() &&
          (entry.name.endsWith(".slnx") || entry.name.endsWith(".sln")),
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

async function preparePeaAuth(options: PeaAgentOptions): Promise<string> {
  const authSource = options.authSource ?? "api-key";
  const mastraAuthPath = await resolveDefaultPeaMastraAuthPath(authSource);
  await ensurePeaBetaAuth({
    allowOAuth: options.allowOauthBetaAuth,
    authSource,
    mastraAuthPath,
  });
  return mastraAuthPath;
}

function normalizePeaModelId(modelId: string): string {
  switch (modelId) {
    case "openai/gpt-5.5":
    case "openai/gpt-5.4":
      return defaultPeaAgentModelId;
    case "openai/gpt-5.4-mini":
      return defaultPeaOmModelId;
    default:
      return modelId;
  }
}

async function resolvePeaAgentCwd(
  hostClient: ReturnType<typeof createPeHostClient>,
  hostBaseUrl: string,
  workspaceKey: string,
  workspaceRoot?: string,
): Promise<string> {
  const configuredRoot = firstNonBlank(workspaceRoot);
  if (configuredRoot) return path.resolve(configuredRoot);

  try {
    const bootstrap = await hostClient.scripting.bootstrapWorkspace({
      workspaceKey,
      createSampleScript: true,
    });
    return path.resolve(bootstrap.productHomePath);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Unable to resolve Pe.Tools product home through Pe.Host at ${hostBaseUrl}: ${detail}`,
    );
  }
}

function firstNonBlank(
  ...values: Array<string | undefined>
): string | undefined {
  return values
    .find((value) => value != null && value.trim().length > 0)
    ?.trim();
}
