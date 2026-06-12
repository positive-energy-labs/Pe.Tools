import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import {
  MASTRA_RESOURCE_ID_KEY,
  MASTRA_THREAD_ID_KEY,
  RequestContext,
} from "@mastra/core/request-context";
import {
  createDevAgentInitialState,
  createDevAgentResourceId,
  createLocalResourceId,
  createPeaRuntimeSessions,
  resolveDevAgentModel,
} from "../pea-runtime.js";
import { createPeaModelArgument } from "../pea-agent.js";
import {
  appendPeaRuntimeContextPrompt,
  getPeaRuntimeProtocolSessionId,
  getPeaRuntimeResumeDecisions,
} from "../pea-runtime-context.js";
import {
  createDefaultMastraCodeStorageConfig,
  createPeaLocalStorageConfig,
} from "../mastracode-storage.js";

describe("Pea runtime sessions", () => {
  it("does not import MastraCode auth storage before Pea scopes APPDATA", async () => {
    const source = await readFile(
      new URL("../pea-runtime.ts", import.meta.url),
      "utf-8",
    );

    assert.doesNotMatch(
      source,
      /import\s+\{[^}]*createAuthStorage[^}]*\}\s+from\s+["']mastracode["']/,
    );
    assert.match(source, /await import\(["']mastracode["']\)/);
  });

  it("delegates Pea model resolution through the configured resolver", () => {
    const calls: Array<{
      modelId: string;
      thinkingLevel?: string;
      remapForCodexOAuth?: boolean;
    }> = [];
    const modelArgument = createPeaModelArgument((modelId, options) => {
      calls.push({
        modelId,
        thinkingLevel: options?.thinkingLevel,
        remapForCodexOAuth: options?.remapForCodexOAuth,
      });
      return { id: "resolved-pea-model" };
    });
    const requestContext = new RequestContext<unknown>([
      [
        "harness",
        {
          getState() {
            return {
              currentModelId: "openai/gpt-5.5",
              thinkingLevel: "medium",
            };
          },
        },
      ],
    ]);

    const model = modelArgument({ requestContext });

    assert.deepEqual(model, { id: "resolved-pea-model" });
    assert.deepEqual(calls, [
      {
        modelId: "openai/gpt-5.5",
        thinkingLevel: "medium",
        remapForCodexOAuth: true,
      },
    ]);
  });

  it("starts peco in yolo mode for repo tool calls", () => {
    assert.equal(createDevAgentInitialState("openai/gpt-5.5").yolo, true);
  });

  it("creates Pe.Tools-owned local resource ids from runtime config directories", () => {
    assert.match(
      createLocalResourceId("C:/repo/Pe.Tools", ".pea"),
      /^pea:[0-9a-f]{16}$/,
    );
  });

  it("creates MastraCode-compatible peco resource ids", async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), "pea-dev-resource-id-"));
    execFileSync("git", ["init"], { cwd, stdio: "ignore" });
    execFileSync(
      "git",
      ["remote", "add", "origin", "https://github.com/kaitpw/Pe.Tools.git"],
      {
        cwd,
        stdio: "ignore",
      },
    );

    assert.equal(createDevAgentResourceId(cwd), "pe-tools-ae8e96592dd3");
  });

  it("stores peco threads in the normal MastraCode database", () => {
    const originalDatabasePath = process.env.MASTRA_DB_PATH;
    try {
      delete process.env.MASTRA_DB_PATH;
      assert.match(
        createDefaultMastraCodeStorageConfig().url,
        /^file:.*mastracode[\\\\/]mastra\.db$/,
      );
    } finally {
      if (originalDatabasePath === undefined) {
        delete process.env.MASTRA_DB_PATH;
      } else {
        process.env.MASTRA_DB_PATH = originalDatabasePath;
      }
    }
  });

  it("honors the MastraCode database path override for peco threads", () => {
    const originalDatabasePath = process.env.MASTRA_DB_PATH;
    try {
      process.env.MASTRA_DB_PATH = "C:\\tmp\\mastracode-test.db";
      assert.equal(
        createDefaultMastraCodeStorageConfig().url,
        "file:C:\\tmp\\mastracode-test.db",
      );
    } finally {
      if (originalDatabasePath === undefined) {
        delete process.env.MASTRA_DB_PATH;
      } else {
        process.env.MASTRA_DB_PATH = originalDatabasePath;
      }
    }
  });

  it("stores Pea threads under the Pea runtime config directory", () => {
    assert.equal(
      createPeaLocalStorageConfig(
        "C:/Users/kaitp/OneDrive/Documents/Pe.Tools",
        ".pea",
      ).url,
      "file:C:\\Users\\kaitp\\OneDrive\\Documents\\Pe.Tools\\.pea\\mastra.db",
    );
  });

  it("creates a harness thread session with the current resource id", async () => {
    const calls: string[] = [];
    const harness = {
      async init() {
        calls.push("init");
      },
      getMastra() {
        return {
          async startWorkers() {
            calls.push("startWorkers");
          },
        };
      },
      getCurrentMode() {
        return { agent: { id: "code-agent" } };
      },
      async createThread(options?: { title?: string }) {
        calls.push(`create:${options?.title}`);
        return { id: "thread-1" };
      },
      async switchThread(options: { threadId: string }) {
        calls.push(`switch:${options.threadId}`);
      },
      getResourceId() {
        calls.push("resource");
        return "resource-1";
      },
      async sendMessage() {},
      abort() {},
      subscribe() {
        return () => undefined;
      },
    } as unknown as Parameters<typeof createPeaRuntimeSessions>[0];

    const sessions = createPeaRuntimeSessions(harness);
    const session = await sessions.createThreadSession({
      title: "ACP pea-acp-1",
    });

    assert.deepEqual(session, {
      threadId: "thread-1",
      resourceId: "resource-1",
    });
    assert.deepEqual(calls, [
      "init",
      "startWorkers",
      "create:ACP pea-acp-1",
      "switch:thread-1",
      "resource",
    ]);
  });

  it("registers custom Pea agent overrides before compat thread switching", async () => {
    const calls: string[] = [];
    const peaAgent = { id: "pea-agent" };
    const mastra = {
      getAgentById(id: string) {
        calls.push(`getAgent:${id}`);
        throw new Error(`Agent with id ${id} not found`);
      },
      async startWorkers() {
        calls.push("startWorkers");
      },
    };
    const harness = {
      async init() {
        calls.push("init");
      },
      getMastra() {
        return mastra;
      },
      getCurrentMode() {
        return { agent: { id: "pea-agent" } };
      },
      async createThread(options?: { title?: string }) {
        calls.push(`create:${options?.title}`);
        return { id: "thread-1" };
      },
      async switchThread(options: { threadId: string }) {
        calls.push(`switch:${options.threadId}`);
      },
      getResourceId() {
        calls.push("resource");
        return "resource-1";
      },
      async sendMessage() {},
      abort() {},
      subscribe() {
        return () => undefined;
      },
    } as unknown as Parameters<typeof createPeaRuntimeSessions>[0];

    const sessions = createPeaRuntimeSessions(harness, {
      agentOverrides: { "pea-agent": peaAgent },
    });
    const session = await sessions.createThreadSession({
      title: "ACP pea-acp-1",
    });

    assert.deepEqual(session, {
      threadId: "thread-1",
      resourceId: "resource-1",
    });
    assert.equal(mastra.getAgentById("pea-agent"), peaAgent);
    assert.deepEqual(calls, [
      "init",
      "startWorkers",
      "create:ACP pea-acp-1",
      "switch:thread-1",
      "resource",
    ]);
  });

  it("sends messages with resource/thread scoped runtime context", async () => {
    let sentContent = "";
    let sentContext:
      | Parameters<typeof appendPeaRuntimeContextPrompt>[1]
      | undefined;
    const harness = {
      getCurrentMode() {
        return { agent: { id: "other-agent" } };
      },
      getCurrentThreadId() {
        return "thread-1";
      },
      getResourceId() {
        return "resource-1";
      },
      async createThread() {
        return { id: "thread-1" };
      },
      async switchThread() {},
      async sendMessage(request: {
        content: string;
        requestContext: Parameters<typeof appendPeaRuntimeContextPrompt>[1];
      }) {
        sentContent = request.content;
        sentContext = request.requestContext;
      },
      abort() {},
      subscribe() {
        return () => undefined;
      },
    } as unknown as Parameters<typeof createPeaRuntimeSessions>[0];

    await createPeaRuntimeSessions(harness).sendMessage({
      content: "inspect this",
      protocol: "ag-ui",
      context: [
        { value: "  active Revit model  ", description: "  Source  " },
        { value: "", description: "ignored" },
      ],
    });

    assert.equal(sentContent, "inspect this");
    assert.equal(sentContext?.get(MASTRA_RESOURCE_ID_KEY), "resource-1");
    assert.equal(sentContext?.get(MASTRA_THREAD_ID_KEY), "thread-1");
    assert.equal(
      appendPeaRuntimeContextPrompt("base instructions", sentContext!),
      'base instructions\n\n<pea-runtime-context>\n<context description="Source">active Revit model</context>\n</pea-runtime-context>',
    );
  });

  it("injects Pea startup/status context once per user message", async () => {
    const prompts: string[] = [];
    const providerCalls: Array<string | undefined> = [];
    const harness = {
      getCurrentMode() {
        return { agent: { id: "other-agent" } };
      },
      getCurrentThreadId() {
        return "thread-1";
      },
      getResourceId() {
        return "resource-1";
      },
      async createThread() {
        return { id: "thread-1" };
      },
      async switchThread() {},
      async sendMessage(request: {
        requestContext: Parameters<typeof appendPeaRuntimeContextPrompt>[1];
      }) {
        prompts.push(
          appendPeaRuntimeContextPrompt("base", request.requestContext),
        );
      },
      abort() {},
      subscribe() {
        return () => undefined;
      },
    } as unknown as Parameters<typeof createPeaRuntimeSessions>[0];

    const sessions = createPeaRuntimeSessions(harness, {
      contextProvider: async (context) => {
        providerCalls.push(context?.threadId);
        return `<pea-startup-context>call-${providerCalls.length}</pea-startup-context>`;
      },
    });

    await sessions.sendMessage({ content: "first" });
    await sessions.sendMessage({ content: "second" });

    assert.deepEqual(providerCalls, ["thread-1", "thread-1"]);
    assert.deepEqual(prompts, [
      "base\n\n<pea-startup-context>call-1</pea-startup-context>",
      "base\n\n<pea-startup-context>call-2</pea-startup-context>",
    ]);
  });

  it("carries protocol session ids through the runtime request context", async () => {
    let sentContext:
      | Parameters<typeof appendPeaRuntimeContextPrompt>[1]
      | undefined;
    const harness = {
      getCurrentMode() {
        return { agent: { id: "other-agent" } };
      },
      getCurrentThreadId() {
        return "thread-1";
      },
      getResourceId() {
        return "resource-1";
      },
      async createThread() {
        return { id: "thread-1" };
      },
      async switchThread() {},
      async sendMessage(request: {
        requestContext: Parameters<typeof appendPeaRuntimeContextPrompt>[1];
      }) {
        sentContext = request.requestContext;
      },
      abort() {},
      subscribe() {
        return () => undefined;
      },
    } as unknown as Parameters<typeof createPeaRuntimeSessions>[0];

    await createPeaRuntimeSessions(harness).sendMessage({
      content: "inspect this",
      protocol: "acp",
      protocolSessionId: "pea-acp-1",
    });

    assert.equal(getPeaRuntimeProtocolSessionId(sentContext!), "pea-acp-1");
  });

  it("carries resume decisions through structured runtime request context", async () => {
    let sentContext:
      | Parameters<typeof appendPeaRuntimeContextPrompt>[1]
      | undefined;
    const resumeDecisions = [
      {
        interruptId: "tool-suspended:tool-1",
        status: "resolved" as const,
        payload: { approved: true },
      },
    ];
    const harness = {
      getCurrentMode() {
        return { agent: { id: "other-agent" } };
      },
      getCurrentThreadId() {
        return "thread-1";
      },
      getResourceId() {
        return "resource-1";
      },
      async createThread() {
        return { id: "thread-1" };
      },
      async switchThread() {},
      async sendMessage(request: {
        requestContext: Parameters<typeof appendPeaRuntimeContextPrompt>[1];
      }) {
        sentContext = request.requestContext;
      },
      abort() {},
      subscribe() {
        return () => undefined;
      },
    } as unknown as Parameters<typeof createPeaRuntimeSessions>[0];

    await createPeaRuntimeSessions(harness).sendMessage({
      content: "continue",
      protocol: "ag-ui",
      resumeDecisions,
    });

    assert.deepEqual(
      getPeaRuntimeResumeDecisions(sentContext!),
      resumeDecisions,
    );
    assert.deepEqual(
      appendPeaRuntimeContextPrompt("base instructions", sentContext!),
      "base instructions",
    );
  });

  it("delegates peco model resolution to MastraCode", async () => {
    const calls: Array<{ modelId: string; remapForCodexOAuth?: boolean }> = [];
    const authStorage = {
      reload() {
        throw new Error(
          "auto mode should not resolve provider auth inside Pea",
        );
      },
      get() {
        throw new Error(
          "auto mode should not inspect provider credentials inside Pea",
        );
      },
    } as unknown as Parameters<typeof resolveDevAgentModel>[0]["authStorage"];

    const model = await resolveDevAgentModel({
      modelId: "openai/gpt-5.5",
      authSource: "auto",
      authStorage,
      resolveModel(modelId, options) {
        calls.push({
          modelId,
          remapForCodexOAuth: options?.remapForCodexOAuth,
        });
        return { id: "resolved-model" };
      },
    });

    assert.deepEqual(model, { id: "resolved-model" });
    assert.deepEqual(calls, [
      { modelId: "openai/gpt-5.5", remapForCodexOAuth: true },
    ]);
  });

  it("keeps peco OAuth mode bounded when no Codex OAuth credential exists", async () => {
    const calls: string[] = [];
    const authStorage = {
      reload() {
        calls.push("reload");
      },
      get(provider: string) {
        calls.push(`get:${provider}`);
        return undefined;
      },
    } as unknown as Parameters<typeof resolveDevAgentModel>[0]["authStorage"];

    await assert.rejects(
      () =>
        resolveDevAgentModel({
          modelId: "openai/gpt-5.5",
          authSource: "oauth",
          authStorage,
          resolveModel() {
            throw new Error("OAuth gate should run before model delegation");
          },
        }),
      /OpenAI Codex OAuth is required/,
    );
    assert.deepEqual(calls, ["reload", "get:openai-codex"]);
  });
});
