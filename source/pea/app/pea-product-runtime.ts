import { dirname } from "node:path";
import { homedir } from "node:os";
import path from "node:path";
import {
  createPeHostClient,
  resolveHostBaseUrl,
  resolveWorkspaceKey,
} from "@pe/host-client";
import {
  ensurePeaBetaAuth,
  logoutPeaBetaAuth,
  resolveDefaultPeaMastraAuthPath,
  type PeaAuthSource,
} from "./beta-auth-bootstrap.js";
import { bundledPeaSkills } from "../../pe-tools/apps/pea/src/skills.ts";
import { createPeaContextProvider } from "./pea-context-seed.js";
import { createPeaAgent } from "./pea-agent.js";
import {
  defaultPeaAgentModelId,
  defaultPeaOmModelId,
} from "./pea-instructions.js";
import {
  configurePeaProductToolContext,
  peaProductToolCatalog,
  peaProductTools,
} from "../../pe-tools/packages/tools/src/pea/index.js";
import {
  ensurePeaRuntimeDefaults,
  type PeaRuntimeDefaultsSummary,
} from "../../pe-tools/packages/runtime/src/pea/defaults.ts";
import {
  peaRuntimePolicy,
  type PeaRuntimePolicy,
} from "../../pe-tools/packages/runtime/src/pea/policy.ts";
import {
  createOpenAiRuntimeAuthProfile,
  type PeaRuntimeAuthOptions,
} from "../../pe-tools/packages/runtime/src/pea/auth.ts";
import {
  createRuntimeDescriptor,
  createRuntimeFactory,
  type RuntimeFactory,
} from "../../pe-tools/packages/runtime/src/runtime.ts";
import {
  createLocalResourceId,
  createPeaAppRuntimeBase,
  createPeaProductRuntimeStorage,
  firstNonBlank,
  type PeaRuntimeBase,
  type PeaRuntimeHarness,
} from "./runtime-common.js";
import { resolveMastraCodeModel } from "./mastracode-model.js";

export interface PeaAgentOptions {
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

export type PeaRuntime = PeaRuntimeBase & {
  runtimeId: "pea";
  workspace: PeaRuntimeWorkspace;
  defaults: PeaRuntimeDefaultsSummary;
  policy: PeaRuntimePolicy;
};

const peaBundledSkillRoot = ".pea/bundled-skills";
const peaSkillPaths = [
  peaBundledSkillRoot,
  ".pea/skills",
  path.join(homedir(), ".pea", "skills"),
];

export async function createPea(options: PeaAgentOptions = {}): Promise<PeaRuntime> {
  const mastraAuthPath = await preparePeaAuth(options);
  process.env.APPDATA = dirname(dirname(mastraAuthPath));

  const hostBaseUrl = resolveHostBaseUrl(options.hostBaseUrl);
  const workspaceKey = resolveWorkspaceKey(options.workspaceKey);
  configurePeaProductToolContext({ hostBaseUrl, workspaceKey });

  const hostClient = createPeHostClient(hostBaseUrl);
  const cwd = await resolvePeaAgentCwd(hostClient, hostBaseUrl, workspaceKey, options.workspaceRoot);

  process.chdir(cwd);

  const defaults = await ensurePeaRuntimeDefaults(cwd);
  const contextProvider = createPeaContextProvider({
    hostBaseUrl,
    workspaceKey,
    cwd,
    settingsPath: defaults.settingsPath,
  });
  const peaAgent = createPeaAgent(peaRuntimePolicy, resolveMastraCodeModel);
  const storage = await createPeaProductRuntimeStorage(cwd, peaRuntimePolicy.configDir);
  const base = await createPeaAppRuntimeBase({
    cwd,
    id: "pea",
    workspaceName: "Pea Workspace",
    agent: peaAgent,
    storage,
    modes: [
      {
        id: "agent",
        name: "Agent",
        default: true,
        defaultModelId: defaultPeaAgentModelId,
        color: "#22c55e",
        agent: peaAgent,
      },
    ],
    tools: peaProductTools,
    toolCatalog: peaProductToolCatalog,
    skillPaths: peaSkillPaths,
    memorySkillMounts: [{ root: peaBundledSkillRoot, skills: bundledPeaSkills }],
    resourceId: createLocalResourceId(cwd, peaRuntimePolicy.configDir),
    initialState: {
      currentModelId: defaultPeaAgentModelId,
      configDir: peaRuntimePolicy.configDir,
    },
    sessionOptions: { contextProvider },
  });

  overridePeaModelSwitching(base.harness);

  return {
    ...base,
    runtimeId: "pea",
    workspace: {
      cwd,
      hostBaseUrl,
      workspaceKey,
    },
    defaults,
    policy: peaRuntimePolicy,
  };
}

export function createPeaRuntime(options: PeaAgentOptions = {}): Promise<PeaRuntime> {
  return createPea(options);
}

export function createPeaRuntimeFactory(options: PeaAgentOptions = {}): RuntimeFactory {
  const authSource = options.authSource ?? "api-key";
  return createRuntimeFactory(
    createRuntimeDescriptor("pea", {
      modeName: "Pea",
      agentName: "Pea",
      title: "Pea",
      description: "Positive Energy Revit/operator workbench.",
    }),
    (request) =>
      createPea({
        ...options,
        workspaceRoot: firstNonBlank(request.workspaceRoot, options.workspaceRoot),
      }),
    createPeaAuthProfile({
      authSource,
      allowOauthBetaAuth: options.allowOauthBetaAuth,
    }),
  );
}

function createPeaAuthProfile(options: PeaRuntimeAuthOptions) {
  return createOpenAiRuntimeAuthProfile({
    ...options,
    logout: () => logoutPeaBetaAuth({ authSource: options.authSource }).then(() => undefined),
  });
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

function overridePeaModelSwitching(harness: PeaRuntimeHarness): void {
  const switchModel = harness.switchModel.bind(harness);
  harness.switchModel = (async (request) => {
    await switchModel({
      ...request,
      modelId: normalizePeaModelId(request.modelId),
    });
  }) as typeof harness.switchModel;
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
    throw new Error(`Unable to resolve Pe.Tools product home through Pe.Host at ${hostBaseUrl}: ${detail}`);
  }
}
