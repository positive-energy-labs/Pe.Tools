import { homedir } from "node:os";
import path from "node:path";
import { Agent } from "@mastra/core/agent";
import { resolveHostBaseUrl, resolveWorkspaceKey } from "@pe/host-client";
import type { PeaAuthSource } from "./beta-auth-bootstrap.js";
import {
  ensureDevAgentProjectFiles,
  type DevAgentProjectFilesSummary,
} from "../../pe-tools/apps/pe-code/src/project-files.ts";
import { devAgentInstructions } from "../../pe-tools/apps/pe-code/src/instructions.ts";
import { devAgentWorkflowSkills } from "../../pe-tools/apps/pe-code/src/skills.ts";
import { appendRuntimeContextPrompt } from "../../pe-tools/packages/runtime/src/context.ts";
import { mergeRuntimeToolCatalogs } from "../../pe-tools/packages/runtime/src/tool-metadata.ts";
import {
  configurePeaProductToolContext,
  peaProductToolCatalog,
  peaProductTools,
} from "../../pe-tools/packages/tools/src/pea/index.js";
import { peCodeToolCatalog } from "../../pe-tools/packages/tools/src/dev/index.js";
import { repoDevTools } from "./tools/index.js";
import { createOpenAiRuntimeAuthProfile } from "../../pe-tools/packages/runtime/src/pea/auth.ts";
import {
  createRuntimeDescriptor,
  createRuntimeFactory,
  type RuntimeFactory,
} from "../../pe-tools/packages/runtime/src/runtime.ts";
import {
  createDevAgentResourceId,
  createPeaAppRuntimeBase,
  createPeaAuthStorage,
  createPeCodeRuntimeStorage,
  firstNonBlank,
  resolveDevAgentModel,
  resolveDevAgentProjectRoot,
  type PeaRuntimeBase,
  type PeaRuntimeTools,
} from "./runtime-common.js";

export interface DevAgentOptions {
  hostBaseUrl?: string;
  workspaceKey?: string;
  workspaceRoot?: string;
  modelId?: string;
  allowOauthBetaAuth?: boolean;
  authSource?: PeaAuthSource;
}

export interface DevAgentRuntimeWorkspace {
  cwd: string;
  projectRoot: string;
  hostBaseUrl: string;
  workspaceKey: string;
}

export type DevAgentRuntime = PeaRuntimeBase & {
  runtimeId: "pe-code";
  workspace: DevAgentRuntimeWorkspace;
  projectFiles: DevAgentProjectFilesSummary;
};

const peCodeRuntimeConfigDir = ".pe-tools";
const peCodeBundledSkillRoot = ".pe-tools/bundled-skills";
const peCodeSkillPaths = [
  peCodeBundledSkillRoot,
  ".mastracode/skills",
  ".agents/skills",
  ".claude/skills",
  path.join(homedir(), ".mastracode", "skills"),
  path.join(homedir(), ".agents", "skills"),
  path.join(homedir(), ".claude", "skills"),
];

export async function createPeCodeRuntime(
  options: DevAgentOptions = {},
): Promise<DevAgentRuntime> {
  const hostBaseUrl = resolveHostBaseUrl(options.hostBaseUrl);
  const workspaceKey = resolveWorkspaceKey(options.workspaceKey);
  const startPath = path.resolve(firstNonBlank(options.workspaceRoot) ?? process.cwd());
  const cwd = await resolveDevAgentProjectRoot(startPath);

  configurePeaProductToolContext({ hostBaseUrl, workspaceKey });
  process.chdir(cwd);

  const projectFiles = await ensureDevAgentProjectFiles(cwd);
  const authStorage = await createPeaAuthStorage();
  const defaultModelId = options.modelId ?? "openai/gpt-5.5";
  const tools = createPeCodeTools();
  const codeAgent = new Agent({
    id: "code-agent",
    name: "Pe.Tools Dev Agent",
    description: "Pe.Tools repo coding agent.",
    instructions: ({ requestContext }) =>
      appendRuntimeContextPrompt(devAgentInstructions, requestContext),
    model: ({ requestContext }) => {
      const harness = requestContext.get("harness") as
        | { getState?: () => Record<string, unknown> }
        | undefined;
      const modelId = harness?.getState?.().currentModelId;
      return resolveDevAgentModel({
        modelId: typeof modelId === "string" && modelId.length > 0 ? modelId : defaultModelId,
        authSource: options.authSource ?? "auto",
        authStorage,
        requestContext,
      });
    },
    tools,
  });
  const storage = await createPeCodeRuntimeStorage();
  const base = await createPeaAppRuntimeBase({
    cwd,
    id: "pe-code",
    workspaceName: "Pe.Tools Repo Workspace",
    agent: codeAgent,
    storage,
    modes: [
      {
        id: "build",
        name: "Build",
        default: true,
        defaultModelId,
        color: "#2563eb",
        agent: codeAgent,
      },
    ],
    tools,
    toolCatalog: mergeRuntimeToolCatalogs(peaProductToolCatalog, peCodeToolCatalog),
    skillPaths: peCodeSkillPaths,
    memorySkillMounts: [{ root: peCodeBundledSkillRoot, skills: devAgentWorkflowSkills }],
    resourceId: createDevAgentResourceId(cwd),
    initialState: createDevAgentInitialState(defaultModelId),
    authStorage,
  });

  return {
    ...base,
    runtimeId: "pe-code",
    workspace: {
      cwd,
      projectRoot: cwd,
      hostBaseUrl,
      workspaceKey,
    },
    projectFiles,
  };
}

export function createPeCodeRuntimeFactory(options: DevAgentOptions = {}): RuntimeFactory {
  return createRuntimeFactory(
    createRuntimeDescriptor("pe-code", {
      modeName: "Build",
      agentName: "Pe.Tools Dev Agent",
      title: "pe-code",
      description: "Pe.Tools repo coding agent.",
    }),
    (request) =>
      createPeCodeRuntime({
        ...options,
        workspaceRoot: firstNonBlank(request.workspaceRoot, request.cwd, options.workspaceRoot),
      }),
    createOpenAiRuntimeAuthProfile({
      authSource: options.authSource ?? "auto",
      allowOauthBetaAuth: options.allowOauthBetaAuth,
    }),
  );
}

export function createPeaDev(options: DevAgentOptions = {}): Promise<DevAgentRuntime> {
  return createPeCodeRuntime(options);
}

export function createDevAgentRuntime(options: DevAgentOptions = {}): Promise<DevAgentRuntime> {
  return createPeCodeRuntime(options);
}

export function createDevAgentInitialState(defaultModelId: string): Record<string, unknown> {
  return {
    currentModelId: defaultModelId,
    yolo: true,
    configDir: peCodeRuntimeConfigDir,
    sandboxAllowedPaths: [
      "C:\\Users\\kaitp\\OneDrive\\Documents\\Pe.Tools\\",
      "C:\\Users\\kaitp\\source\\repos\\mastra",
      "C:\\Users\\kaitp\\AppData\\Local\\Positive Energy",
    ],
  };
}

function createPeCodeTools(): PeaRuntimeTools {
  return {
    ...peaProductTools,
    ...repoDevTools,
  } as unknown as PeaRuntimeTools;
}
