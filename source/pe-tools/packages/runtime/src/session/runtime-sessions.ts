import type { Harness, HarnessEvent } from "@mastra/core/harness";
import { createRuntimeRequestContext, type RuntimeContextEntry } from "../context.ts";
import { MastraHarnessToRuntimeEvents } from "../events.ts";
import type { RuntimeToolSource } from "../tool-metadata.ts";
import type {
  RuntimeThreadInfo,
  RuntimeSendMessageOptions,
  RuntimeSessions,
  RuntimeThreadSession,
} from "../runtime.ts";

export type RuntimeSessionContextProvider = (request: {
  threadId?: string;
}) => Promise<string> | string;

export interface RuntimeSessionOptions {
  agentOverrides?: Record<string, unknown>;
  contextProvider?: RuntimeSessionContextProvider;
  contextFailureFormatter?: (error: unknown) => string;
  toolCatalog?: RuntimeToolSource;
}

export function createRuntimeSessions(
  harness: Harness<Record<string, unknown>>,
  sessionOptions: RuntimeSessionOptions = {},
): RuntimeSessions {
  const agentOverrides = sessionOptions.agentOverrides ?? {};
  let initTask: Promise<void> | null = null;

  async function ensureInitialized(): Promise<void> {
    initTask ??= (async () => {
      const initializable = harness as unknown as {
        init?: () => Promise<void> | void;
        getMastra?: () =>
          | {
              getAgentById?: (id: string) => unknown;
              startWorkers?: () => Promise<void> | void;
            }
          | undefined;
      };
      await initializable.init?.();
      const mastra = initializable.getMastra?.();
      if (mastra && Object.keys(agentOverrides).length > 0) {
        const getAgentById = mastra.getAgentById?.bind(mastra);
        mastra.getAgentById = (id: string) => agentOverrides[id] ?? getAgentById?.(id);
      }
      await mastra?.startWorkers?.();
    })();
    await initTask;
  }

  async function ensureCompatSession(): Promise<void> {
    const mode = harness.getCurrentMode() as { agent?: { id?: string } };
    const agentId = mode.agent?.id;
    const usesCompatSession =
      agentId === "code-agent" || (agentId ? agentId in agentOverrides : false);
    if (usesCompatSession) await ensureInitialized();
  }

  return {
    async createThreadSession(options): Promise<RuntimeThreadSession> {
      await ensureCompatSession();
      const thread = (await harness.createThread(options)) as { id?: string };
      const threadId = thread.id;
      if (!threadId) throw new Error("Harness did not return a thread id.");
      await harness.switchThread({ threadId });
      return {
        threadId,
        resourceId: harness.getResourceId(),
      };
    },
    async switchThread(options) {
      await ensureCompatSession();
      await harness.switchThread(options);
    },
    async listThreadSessions(): Promise<RuntimeThreadInfo[]> {
      await ensureCompatSession();
      return (await harness.listThreads()).map((thread) => ({
        threadId: thread.id,
        resourceId: thread.resourceId,
        title: thread.title,
        createdAt: thread.createdAt.toISOString(),
        updatedAt: thread.updatedAt.toISOString(),
        metadata: thread.metadata,
      }));
    },
    async deleteThreadSession(options) {
      await ensureCompatSession();
      await harness.memory.deleteThread(options);
    },
    getResourceId() {
      return harness.getResourceId();
    },
    async sendMessage(options: RuntimeSendMessageOptions) {
      await ensureCompatSession();
      const threadId = harness.getCurrentThreadId() ?? undefined;
      const promptFragments = await collectSessionPromptFragments(
        sessionOptions.contextProvider,
        threadId,
        sessionOptions.contextFailureFormatter,
      );
      const requestContext = createRuntimeRequestContext({
        protocol: options.protocol ?? "tui",
        protocolSessionId: options.protocolSessionId,
        threadId,
        resourceId: harness.getResourceId(),
        entries: options.context,
        promptFragments,
        resumeDecisions: options.resumeDecisions,
      });
      await harness.sendMessage({ content: options.content, requestContext });
    },
    abort: harness.abort.bind(harness),
    subscribe(listener) {
      const translator = new MastraHarnessToRuntimeEvents({
        toolCatalog: sessionOptions.toolCatalog,
      });
      return harness.subscribe((event: HarnessEvent) => {
        for (const runtimeEvent of translator.translate(event)) {
          void listener(runtimeEvent);
        }
      });
    },
  };
}

async function collectSessionPromptFragments(
  contextProvider: RuntimeSessionContextProvider | undefined,
  threadId: string | undefined,
  formatFailure: ((error: unknown) => string) | undefined,
): Promise<string[]> {
  if (!contextProvider) return [];

  try {
    return [await contextProvider({ threadId })];
  } catch (error) {
    if (formatFailure) return [formatFailure(error)];
    const detail = escapeXml(error instanceof Error ? error.message : String(error));
    return [
      `<runtime-startup-context>\nContext seed unavailable: ${detail}.\n</runtime-startup-context>`,
    ];
  }
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export type { RuntimeContextEntry };
