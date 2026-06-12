import { createHash } from "node:crypto";
import { hostname } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Agent } from "@mastra/core/agent";
import type { MastraModelConfig } from "@mastra/core/llm";
import type { RequestContext } from "@mastra/core/request-context";
import {
  LocalFilesystem,
  LocalSandbox,
  Workspace,
} from "@mastra/core/workspace";
import { PeHostClient } from "@pe/host-client";
import {
  createMastraCodeAuthStorage,
  createPeaProductStateStorageProfile,
  createPeaRuntimeMemoryProfile,
  createRuntimeHarness,
  defaultPeaAgentModelId,
  hasMastraCodeStoredAuth,
  loadStoredMastraCodeApiKeysIntoEnv,
  resolveMastraCodeModel,
  type RuntimeHandle,
} from "@pe/runtime";
import {
  configurePeaProductToolContext,
  peaProductToolProfile,
  peaProductTools,
} from "../pea/index.ts";

const resultPrefix = "__PEA_TALK_WORKER_RESULT__";
const peaConfigDir = ".pea";

type PeaWorkerRuntime = {
  harness: {
    switchThread(request: { threadId: string }): Promise<void>;
    createThread(request: { title: string }): Promise<{ id: string }>;
    listMessagesForThread(request: {
      threadId: string;
      limit: number;
    }): Promise<Array<{ role: string; content: Array<unknown> }>>;
    sendMessage(request: { content: string }): Promise<void>;
    listMessages(options?: {
      limit?: number;
    }): Promise<Array<{ id?: string; role: string; content: Array<unknown> }>>;
    abort(): void;
  };
  close?: () => Promise<void> | void;
};

export type TalkToPeaFrame = "operator" | "feedback" | "collaborate";

export interface TalkToPeaWorkerRequest {
  threadId?: string;
  frame: TalkToPeaFrame;
  prompt: string;
  feedbackPrompt?: string;
  reviewFrame?: {
    userRequest?: string;
    engineerQuestion?: string;
    expectedUse?: string;
  };
  timeoutSeconds: number;
  maxMessages: number;
}

export interface TalkToPeaWorkerResponse {
  ok: boolean;
  threadId: string;
  frame: TalkToPeaFrame;
  latestResponse: string;
  primaryResponse: string;
  feedbackResponse: string | null;
  transcriptTail: Array<{ role: string; text: string }>;
  toolTrace: Array<unknown>;
}

async function main(): Promise<void> {
  const request = JSON.parse(await readStdin()) as TalkToPeaWorkerRequest;
  const response = await runTalkToPeaWorker(request);
  process.stdout.write(`${resultPrefix}${JSON.stringify(response)}\n`);
}

export async function runTalkToPeaWorker(
  request: TalkToPeaWorkerRequest,
): Promise<TalkToPeaWorkerResponse> {
  const runtime = await createPeaWorkerRuntime();
  try {
    const thread = request.threadId
      ? (await runtime.harness.switchThread({ threadId: request.threadId }),
        { id: request.threadId })
      : await runtime.harness.createThread({
          title: `Pea ${request.frame} review`,
        });

    const beforeMessages = await runtime.harness.listMessagesForThread({
      threadId: thread.id,
      limit: request.maxMessages,
    });
    const primaryResponse = await sendPeaMessageWithTimeout(
      runtime.harness,
      buildTalkToPeaPrompt(request.frame, request.prompt, request.reviewFrame),
      request.timeoutSeconds,
    );
    const feedbackResponse = request.feedbackPrompt
      ? await sendPeaMessageWithTimeout(
          runtime.harness,
          buildTalkToPeaPrompt(
            "feedback",
            request.feedbackPrompt,
            request.reviewFrame,
          ),
          request.timeoutSeconds,
        )
      : null;
    const messages = await runtime.harness.listMessagesForThread({
      threadId: thread.id,
      limit: request.maxMessages,
    });

    return {
      ok: primaryResponse.ok && (feedbackResponse?.ok ?? true),
      threadId: thread.id,
      frame: request.frame,
      latestResponse: latestAssistantText(messages),
      primaryResponse: primaryResponse.latestAssistantText,
      feedbackResponse: feedbackResponse?.latestAssistantText ?? null,
      transcriptTail: transcriptTail(messages),
      toolTrace: toolTraceSince(beforeMessages, messages),
    };
  } finally {
    await runtime.close?.();
  }
}

async function createPeaWorkerRuntime(): Promise<PeaWorkerRuntime> {
  const hostBaseUrl = PeHostClient.resolveHostBaseUrl();
  const workspaceKey = PeHostClient.resolveWorkspaceKey();
  configurePeaProductToolContext({ hostBaseUrl, workspaceKey });

  const cwd = await resolvePeaWorkerCwd(hostBaseUrl, workspaceKey);
  process.chdir(cwd);

  const authStorage = await createMastraCodeAuthStorage();
  loadStoredMastraCodeApiKeysIntoEnv(authStorage);
  // TODO: We should not be doing this. The whole point of talking to pea is to see how it would be in prod This included the system prompt and everything.
  // On the other hand maybe its stronger signal to see if pea with no prompt can work with tools. Also it could b nice to customize pea's tools in talk to pea mode for sandbox reasons
  const agent = new Agent({
    id: "pea-agent",
    name: "Pea Revit Agent",
    description: "High-trust Revit/operator agent for Positive Energy tooling.",
    instructions: peaWorkerInstructions,
    model: ({ requestContext }) =>
      resolveCurrentModel(requestContext, defaultPeaAgentModelId),
    tools: peaProductTools,
  });
  const workspace = new Workspace({
    id: "pea-workspace",
    name: "Pea Workspace",
    filesystem: new LocalFilesystem({ basePath: cwd, contained: true }),
    sandbox: new LocalSandbox({ workingDirectory: cwd, env: process.env }),
    skills: [".pea/bundled-skills", ".pea/skills"],
  });
  const handle = await createRuntimeHarness({
    request: { protocol: "test", cwd, workspaceRoot: cwd },
    config: {
      id: "pea",
      resourceId: createLocalResourceId(cwd),
      workspace,
      modes: [
        {
          id: "agent",
          name: "Agent",
          default: true,
          defaultModelId: defaultPeaAgentModelId,
          color: "#22c55e",
          agent,
        },
      ],
      tools: peaProductTools,
      initialState: {
        currentModelId: defaultPeaAgentModelId,
        configDir: peaConfigDir,
      },
      modelAuthChecker: (provider) =>
        hasMastraCodeStoredAuth(authStorage, provider) ? true : undefined,
    },
    storageProfile: createPeaProductStateStorageProfile({
      stateDirectory: path.join(cwd, peaConfigDir),
    }),
    memoryProfile: createPeaRuntimeMemoryProfile(),
    toolProfile: peaProductToolProfile,
    workspace: { cwd, root: cwd },
    authStorage,
    metadata: {
      runtimeId: "pea",
      hostBaseUrl,
      workspaceKey,
      protocol: "talk_to_pea",
    },
  });

  await handle.harness.init();
  return handle as RuntimeHandle<Record<string, unknown>> & PeaWorkerRuntime;
}

const peaWorkerInstructions = `You are Positive Energy Agent, Pea: the deployed Revit/operator workbench for MEP, BIM, and architecture practitioners.
Use Pea product tools to inspect host/Revit state, run approved scripts, and produce operator-facing answers. Stay inside the deployed product posture: do not inspect repo source, discuss Peco implementation, or present build/Rider/RRD internals as user-facing facts. Prefer small observable steps, say what you verified, and be explicit when live Revit evidence is unavailable.`;

async function resolvePeaWorkerCwd(
  hostBaseUrl: string,
  workspaceKey: string,
): Promise<string> {
  const client = new PeHostClient({ baseUrl: hostBaseUrl });
  try {
    await client.ensurePeHostRunning(hostBaseUrl);
    const bootstrap = await client.scripting.bootstrapWorkspace({
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

function resolveCurrentModel(
  requestContext: RequestContext,
  fallbackModelId: string,
): Promise<MastraModelConfig> {
  const harness = requestContext.get("harness") as
    | { getState?: () => Record<string, unknown> }
    | undefined;
  const state = harness?.getState?.();
  const modelId =
    typeof state?.currentModelId === "string" && state.currentModelId.length > 0
      ? state.currentModelId
      : fallbackModelId;
  const thinkingLevel = state?.thinkingLevel;

  return resolveMastraCodeModel(normalizePeaModelId(modelId), {
    thinkingLevel: isThinkingLevel(thinkingLevel) ? thinkingLevel : undefined,
    remapForCodexOAuth: true,
    requestContext,
  });
}

function normalizePeaModelId(modelId: string): string {
  switch (modelId) {
    case "openai/gpt-5.5":
    case "openai/gpt-5.4":
      return defaultPeaAgentModelId;
    default:
      return modelId;
  }
}

function isThinkingLevel(
  value: unknown,
): value is "off" | "low" | "medium" | "high" | "xhigh" {
  return (
    value === "off" ||
    value === "low" ||
    value === "medium" ||
    value === "high" ||
    value === "xhigh"
  );
}

function createLocalResourceId(cwd: string): string {
  const digest = createHash("sha256")
    .update(`${hostname()}\n${path.resolve(cwd)}`)
    .digest("hex")
    .slice(0, 16);
  return `pea:${digest}`;
}

function buildTalkToPeaPrompt(
  frame: TalkToPeaFrame,
  prompt: string,
  reviewFrame: TalkToPeaWorkerRequest["reviewFrame"],
): string {
  const reviewLines = [
    reviewFrame?.userRequest
      ? `Original user request: ${reviewFrame.userRequest}`
      : null,
    reviewFrame?.engineerQuestion
      ? `Harness engineer question: ${reviewFrame.engineerQuestion}`
      : null,
    reviewFrame?.expectedUse
      ? `Expected use of your answer: ${reviewFrame.expectedUse}`
      : null,
  ]
    .filter(Boolean)
    .join("\n");
  const reviewBlock = reviewLines ? `\n\nReview frame:\n${reviewLines}` : "";

  switch (frame) {
    case "feedback":
      return `You are Pea, the deployed Revit/operator workbench. A harness engineer is asking for black-box product feedback from your experience as Pea.\n\nReflect on the current or previous task in this Pea thread. Focus on what was easy, what was confusing, which tools/status/context helped, what was missing, and what would improve Pea's operator experience. Do not inspect or discuss repo source, peco source, build topology, or implementation details.\n${reviewBlock}\n\nFeedback request:\n${prompt}`;
    case "collaborate":
      return `You are Pea, the deployed Revit/operator workbench. Collaborate on this Revit/project investigation through Pea product tools.\n\nExplore the live project as useful, form hypotheses, check them with available evidence, and summarize observed project conventions, risks, and strange Revit/product behavior. Do not inspect or discuss repo source. If findings may inform automation, phrase them as observed conventions and heuristic risks rather than source-code instructions.\n${reviewBlock}\n\nInvestigation request:\n${prompt}`;
    case "operator":
    default:
      return `You are Pea, the deployed Revit/operator workbench. Answer the following user request as an operator-facing Revit assistant.\n\nStay focused on the user's Revit task. Use Pea product tools as needed. Do not mention repo source, peco, build systems, RRD/Rider state, or harness internals.\n${reviewBlock}\n\nUser request:\n${prompt}`;
  }
}

async function sendPeaMessageWithTimeout(
  harness: {
    sendMessage(request: { content: string }): Promise<void>;
    listMessages(options?: {
      limit?: number;
    }): Promise<Array<{ id?: string; role: string; content: Array<unknown> }>>;
    abort(): void;
  },
  content: string,
  timeoutSeconds: number,
) {
  const beforeMessages = await harness.listMessages({ limit: 80 });
  const beforeIds = new Set(
    beforeMessages.flatMap((message) => (message.id ? [message.id] : [])),
  );
  const deadline = Date.now() + timeoutSeconds * 1000;
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      harness.abort();
      reject(new Error(`Pea did not finish within ${timeoutSeconds} seconds.`));
    }, timeoutSeconds * 1000);
  });

  try {
    await Promise.race([harness.sendMessage({ content }), timeout]);
    const latestAssistantText = await waitForNewAssistantText(
      harness,
      beforeIds,
      deadline,
    );
    if (!latestAssistantText) {
      return {
        ok: false,
        timedOut: Date.now() >= deadline,
        latestAssistantText:
          "Pea did not produce an assistant response for this turn.",
      };
    }

    return { ok: true, timedOut: false, latestAssistantText };
  } catch (error) {
    return {
      ok: false,
      timedOut,
      latestAssistantText:
        error instanceof Error ? error.message : String(error),
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function waitForNewAssistantText(
  harness: {
    listMessages(options?: {
      limit?: number;
    }): Promise<Array<{ id?: string; role: string; content: Array<unknown> }>>;
  },
  beforeIds: Set<string>,
  deadline: number,
): Promise<string> {
  while (Date.now() < deadline) {
    const messages = await harness.listMessages({ limit: 80 });
    const newAssistantText = latestAssistantText(
      messages.filter((message) => !message.id || !beforeIds.has(message.id)),
    );
    if (newAssistantText) return newAssistantText;

    await delay(500);
  }

  return "";
}

function transcriptTail(
  messages: Array<{ role: string; content: Array<unknown> }>,
) {
  return messages
    .filter(
      (message) => message.role === "user" || message.role === "assistant",
    )
    .map((message) => ({
      role: message.role,
      text: textFromMessage(message).slice(0, 4000),
    }))
    .filter((message) => message.text.length > 0);
}

function latestAssistantText(
  messages: Array<{ role: string; content: Array<unknown> }>,
): string {
  for (const message of [...messages].reverse()) {
    if (message.role !== "assistant") continue;

    const text = textFromMessage(message);
    if (text) return text;
  }

  return "";
}

function textFromMessage(message: { content: Array<unknown> }): string {
  return message.content
    .map((part) => {
      if (typeof part !== "object" || part === null) return "";

      const typedPart = part as { type?: string; text?: unknown };
      return typedPart.type === "text" && typeof typedPart.text === "string"
        ? typedPart.text
        : "";
    })
    .filter(Boolean)
    .join("\n")
    .trim();
}

function toolTraceSince(
  beforeMessages: Array<{ id?: string; content: Array<unknown> }>,
  messages: Array<{ id?: string; content: Array<unknown> }>,
) {
  const beforeIds = new Set(
    beforeMessages.map((message) => message.id).filter(Boolean),
  );
  return messages
    .filter((message) => !message.id || !beforeIds.has(message.id))
    .flatMap((message) =>
      message.content.flatMap((part) => toolTracePart(part)),
    );
}

function toolTracePart(part: unknown) {
  if (typeof part !== "object" || part === null) return [];

  const typedPart = part as {
    type?: string;
    name?: unknown;
    args?: unknown;
    result?: unknown;
    isError?: unknown;
  };
  if (typedPart.type === "tool_call") {
    return [
      {
        type: "call",
        name: typeof typedPart.name === "string" ? typedPart.name : "unknown",
        summary: summarizeJson(typedPart.args),
      },
    ];
  }

  if (typedPart.type === "tool_result") {
    return [
      {
        type: "result",
        name: typeof typedPart.name === "string" ? typedPart.name : "unknown",
        isError: Boolean(typedPart.isError),
        summary: summarizeJson(typedPart.result),
      },
    ];
  }

  return [];
}

function summarizeJson(value: unknown): string {
  try {
    return JSON.stringify(value)?.slice(0, 1000) ?? "";
  } catch {
    return String(value).slice(0, 1000);
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

function readStdin(): Promise<string> {
  return new Promise((resolveRead, reject) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      data += chunk;
    });
    process.stdin.on("end", () => resolveRead(data));
    process.stdin.on("error", reject);
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stdout.write(
      `${resultPrefix}${JSON.stringify({ ok: false, error: message })}\n`,
    );
    process.exitCode = 1;
  });
}
