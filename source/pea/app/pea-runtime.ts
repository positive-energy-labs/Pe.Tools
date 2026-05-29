import path, { dirname } from "node:path";
import type { createMastraCode as createMastraCodeFunction } from "mastracode";
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
import { createPeaContextProvider } from "./pea-context-seed.js";
import { createPeaAgent, createPeaModelArgument } from "./pea-agent.js";
import {
  defaultPeaAgentModelId,
  defaultPeaObservationThreshold,
  defaultPeaOmModelId,
  defaultPeaReflectionThreshold,
} from "./pea-instructions.js";
import {
  ensurePeaRuntimeDefaults,
  type PeaRuntimeDefaultsSummary,
} from "./pea-runtime-defaults.js";
import {
  peaRuntimePolicy,
  type PeaRuntimePolicy,
} from "./pea-runtime-policy.js";

export interface PeAgentOptions {
  hostBaseUrl?: string;
  workspaceKey?: string;
  workspaceRoot?: string;
  allowOauthBetaAuth?: boolean;
  authSource?: PeaAuthSource;
}

export interface PeaRuntimeWorkspace {
  cwd: string;
  hostBaseUrl: string;
  workspaceKey: string;
}

type CreateMastraCode = typeof createMastraCodeFunction;

export type PeaRuntime = Awaited<ReturnType<CreateMastraCode>> & {
  workspace: PeaRuntimeWorkspace;
  defaults: PeaRuntimeDefaultsSummary;
  policy: PeaRuntimePolicy;
};

export async function createPeaRuntime(
  options: PeAgentOptions = {},
): Promise<PeaRuntime> {
  const authSource = options.authSource ?? "api-key";
  const mastraAuthPath = await resolveDefaultPeaMastraAuthPath(authSource);
  await ensurePeaBetaAuth({
    allowOAuth: options.allowOauthBetaAuth,
    authSource,
    mastraAuthPath,
  });

  const hostBaseUrl = resolveHostBaseUrl(options.hostBaseUrl);
  const workspaceKey = resolveWorkspaceKey(options.workspaceKey);
  const hostClient = createPeHostClient(hostBaseUrl);
  const cwd = await resolveAgentCwd(
    hostClient,
    hostBaseUrl,
    workspaceKey,
    options.workspaceRoot,
  );

  process.chdir(cwd);

  process.env.APPDATA = dirname(dirname(mastraAuthPath));
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

  (peaAgent as unknown as { __updateModel?: (request: { model: unknown }) => void })
    .__updateModel?.({ model: createPeaModelArgument(mastraCode.resolveModel) });

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

async function resolveAgentCwd(
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
