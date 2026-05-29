import path from "node:path";
import { createMastraCode } from "mastracode";
import { mastra } from "mastracode/tui";
import {
  createPeHostClient,
  resolveHostBaseUrl,
  resolveWorkspaceKey,
} from "./pe-host.js";
import { ensurePeaBetaAuth } from "./beta-auth-bootstrap.js";
import { ensureBundledPeaSkills } from "./bundled-skills.js";
import { createPeaContextProvider } from "./pea-context-seed.js";
import { createPeaAgent } from "./pea-agent.js";
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
}

export interface PeaRuntimeWorkspace {
  cwd: string;
  hostBaseUrl: string;
  workspaceKey: string;
}

export type PeaRuntime = Awaited<ReturnType<typeof createMastraCode>> & {
  workspace: PeaRuntimeWorkspace;
  defaults: PeaRuntimeDefaultsSummary;
  policy: PeaRuntimePolicy;
};

export async function createPeaRuntime(
  options: PeAgentOptions = {},
): Promise<PeaRuntime> {
  await ensurePeaBetaAuth();

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
