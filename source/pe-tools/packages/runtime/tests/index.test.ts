import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Session } from "@mastra/core/agent-controller";
import { RequestContext } from "@mastra/core/request-context";
import { LocalSandbox } from "@mastra/core/workspace";
import { TOOL_CATEGORIES, getToolsForCategory } from "@mastra/code-sdk/permissions";
import { expect, test, vi } from "vite-plus/test";
import { peaProductToolMetadata } from "@pe/mcps";
import {
  buildAgentControllerApp,
  createRuntimeController,
  type RuntimeInjectedControllerConfig,
} from "../src/index.ts";
import { createPeaRuntime, peaModelAllowlist, peaModels } from "../src/pea-runtime.ts";

const runtimeTestTimeout = 60_000;
const defaultPeaAgentModelId = "anthropic/claude-opus-5";
const expectedPermissionRules = {
  "read-only": {
    categories: { read: "allow", edit: "deny", execute: "deny", mcp: "deny", other: "deny" },
    tools: {},
  },
  ask: {
    categories: { read: "allow", edit: "ask", execute: "ask", mcp: "ask", other: "deny" },
    tools: {},
  },
  trusted: {
    categories: { read: "allow", edit: "allow", execute: "allow", mcp: "allow", other: "deny" },
    tools: {},
  },
} as const;

test("session approval decisions clear the canonical display gate", async () => {
  const session = new Session({ resourceId: "resource", id: "session", ownerId: "owner" });
  const snapshots: Array<string | null> = [];
  const unsubscribe = session.subscribe((event) => {
    if (event.type === "display_state_changed")
      snapshots.push(event.displayState.pendingApproval?.toolCallId ?? null);
  });

  try {
    const approved = session.approval.arm({ toolName: "shell", toolCallId: "approved" });
    session.emit({
      type: "tool_approval_required",
      toolCallId: "approved",
      toolName: "shell",
      args: {},
    });

    session.respondToToolApproval({ decision: "approve", toolCallId: "stale" });
    expect(session.displayState.get().pendingApproval?.toolCallId).toBe("approved");

    session.respondToToolApproval({ decision: "approve", toolCallId: "approved" });
    await expect(approved).resolves.toMatchObject({ decision: "approve" });
    expect(session.displayState.get().pendingApproval).toBeNull();
    expect(snapshots.at(-1)).toBeNull();

    const aborted = session.approval.arm({ toolName: "shell", toolCallId: "aborted" });
    session.emit({
      type: "tool_approval_required",
      toolCallId: "aborted",
      toolName: "shell",
      args: {},
    });
    session.abort();
    await expect(aborted).resolves.toMatchObject({ decision: "decline" });
    expect(session.displayState.get().pendingApproval).toBeNull();
    expect(snapshots.at(-1)).toBeNull();
  } finally {
    unsubscribe();
  }
});

test("runtime controller close closes injected storage", async () => {
  let storageCloseCount = 0;
  const config: RuntimeInjectedControllerConfig = {
    storage: {
      close: async () => {
        storageCloseCount += 1;
      },
    },
  };
  const runtime = await createRuntimeController({
    config,
    controller: {},
  });

  expect(runtime.session).toBeUndefined();
  await runtime.close?.();
  await runtime.close?.();
  expect(storageCloseCount).toBe(1);
});

test("web boot does not materialize a session or enable CORS", async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "pea-app-"));
  const previousStateDirectory = process.env.PE_TOOLS_STATE_DIR;
  process.env.PE_TOOLS_STATE_DIR = await mkdtemp(path.join(os.tmpdir(), "pea-app-state-"));
  let runtime: Awaited<ReturnType<typeof createPeaRuntime>> | undefined;

  try {
    runtime = await createPeaRuntime({
      workspaceRoot,
      protocol: "web",
      capabilities: { revit: false },
    });
    expect(runtime.session).toBeUndefined();
    const app = await buildAgentControllerApp({ runtime, label: "pea" });
    const response = await app.fetch(new Request("http://local/pe/inspect"));

    expect(response.status).toBe(200);
    expect(runtime.world.root).toBe(path.resolve(workspaceRoot));
    expect(Object.isFrozen(runtime.capabilities)).toBe(true);
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
  } finally {
    await runtime?.close?.();
    if (previousStateDirectory === undefined) delete process.env.PE_TOOLS_STATE_DIR;
    else process.env.PE_TOOLS_STATE_DIR = previousStateDirectory;
  }
}, 30_000);

test(
  "web sessions require exact first binding and remain independently immutable",
  async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pea-scoped-web-"));
    const previousStateDirectory = process.env.PE_TOOLS_STATE_DIR;
    process.env.PE_TOOLS_STATE_DIR = path.join(root, "state");
    let runtime: Awaited<ReturnType<typeof createPeaRuntime>> | undefined;
    try {
      runtime = await createPeaRuntime({ workspaceRoot: root, protocol: "web" });
      const resourceId = runtime.resourceId;
      await expect(
        runtime.controller.createSession({ resourceId, scope: "A", threadId: "B" }),
      ).rejects.toThrow("scope must equal threadId");

      const sessionA = await runtime.controller.createSession({
        resourceId,
        scope: "A",
        threadId: "A",
      });
      const sessionB = await runtime.controller.createSession({
        resourceId,
        scope: "B",
        threadId: "B",
      });
      expect(sessionA).not.toBe(sessionB);
      expect(runtime.isSessionAdmitted(sessionA)).toBe(true);
      expect(runtime.isSessionAdmitted(sessionB)).toBe(true);
      expect(sessionA.permissions.getRules()).toEqual(expectedPermissionRules.ask);
      expect(sessionB.permissions.getRules()).toEqual(expectedPermissionRules.ask);
      expect(await runtime.controller.createSession({ resourceId, scope: "A" })).toBe(sessionA);

      const app = await buildAgentControllerApp({ runtime, label: "pea" });
      const rename = (title: string) =>
        app.fetch(
          new Request(
            `http://local/api/agent-controller/pea/sessions/${encodeURIComponent(resourceId)}/threads/B?sessionScope=A`,
            {
              method: "PUT",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ title }),
            },
          ),
        );
      const renamed = await rename("  renamed B  ");
      expect(renamed.status).toBe(200);
      expect(await renamed.json()).toEqual({ ok: true });
      expect(sessionA.thread.getId()).toBe("A");
      expect((await sessionA.thread.getById({ threadId: "B" }))?.title).toBe("renamed B");
      expect((await rename(" ")).status).toBe(400);

      expect(() => sessionA.thread.set({ threadId: "B" })).toThrow("immutable");
      expect(sessionA.thread.getId()).toBe("A");
      await expect(sessionA.thread.switch({ threadId: "B" })).rejects.toThrow("immutable");
      await expect(sessionA.thread.create()).rejects.toThrow("immutable");
      await expect(sessionA.thread.clone()).rejects.toThrow("immutable");
      await expect(
        sessionA.thread.cloneToCurrentResource({
          threadId: "B",
          expectedResourceId: resourceId,
          expectedProjectPath: root,
        }),
      ).rejects.toThrow("immutable");
      await expect(
        runtime.controller.setResourceId(sessionA, { resourceId: "other" }),
      ).rejects.toThrow("immutable");
      expect(sessionA.identity.getResourceId()).toBe(resourceId);
      expect(await runtime.controller.createSession({ resourceId, scope: "A" })).toBe(sessionA);

      const cloned = await app.fetch(
        new Request(
          `http://local/api/agent-controller/pea/sessions/${encodeURIComponent(resourceId)}/threads/clone?sessionScope=A`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ sourceThreadId: "A" }),
          },
        ),
      );
      expect(cloned.status).toBe(200);
      const clone = (await cloned.json()) as { id: string };
      expect(clone.id).not.toBe("A");
      expect(sessionA.thread.getId()).toBe("A");
      expect((await runtime.controller.queryThreadById({ threadId: clone.id }))?.resourceId).toBe(
        resourceId,
      );

      const deleted = await app.fetch(
        new Request(
          `http://local/api/agent-controller/pea/sessions/${encodeURIComponent(resourceId)}/threads/A?sessionScope=A`,
          { method: "DELETE" },
        ),
      );
      expect(deleted.status).toBe(200);
      expect(await deleted.json()).toEqual({ ok: true });
      expect(await runtime.controller.queryThreadById({ threadId: "A" })).toBeNull();
      expect(await runtime.controller.getSessionByResource(resourceId, "A")).toBeUndefined();

      await sessionB.state.set({ yolo: true });
      await expect(sessionB.sendMessage({ content: "must not run" })).rejects.toThrow(
        "permission state did not persist exactly",
      );
      await expect(runtime.close?.()).resolves.toBeUndefined();
    } finally {
      await runtime?.close?.();
      if (previousStateDirectory === undefined) delete process.env.PE_TOOLS_STATE_DIR;
      else process.env.PE_TOOLS_STATE_DIR = previousStateDirectory;
    }
  },
  runtimeTestTimeout,
);

test(
  "web sessions bind a scope-only first materialization to that scope",
  async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pea-scope-only-web-"));
    const previousStateDirectory = process.env.PE_TOOLS_STATE_DIR;
    process.env.PE_TOOLS_STATE_DIR = path.join(root, "state");
    let runtime: Awaited<ReturnType<typeof createPeaRuntime>> | undefined;
    try {
      runtime = await createPeaRuntime({ workspaceRoot: root, protocol: "web" });
      const session = await runtime.controller.createSession({
        resourceId: runtime.resourceId,
        scope: "scope-only",
      });

      expect(session.thread.getId()).toBe("scope-only");
      expect(runtime.isSessionAdmitted(session)).toBe(true);
    } finally {
      await runtime?.close?.();
      if (previousStateDirectory === undefined) delete process.env.PE_TOOLS_STATE_DIR;
      else process.env.PE_TOOLS_STATE_DIR = previousStateDirectory;
    }
  },
  runtimeTestTimeout,
);

test(
  "scoped web sessions deny notifications before Core admission",
  async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pea-web-notifications-"));
    const previousStateDirectory = process.env.PE_TOOLS_STATE_DIR;
    process.env.PE_TOOLS_STATE_DIR = path.join(root, "state");
    const admissions: unknown[] = [];
    const sendNotificationSignal = vi
      .spyOn(Session.prototype, "sendNotificationSignal")
      .mockImplementation(async (input, options) => {
        admissions.push({ input, options });
        return { native: true } as never;
      });
    let web: Awaited<ReturnType<typeof createPeaRuntime>> | undefined;
    let tui: Awaited<ReturnType<typeof createPeaRuntime>> | undefined;
    try {
      web = await createPeaRuntime({ workspaceRoot: path.join(root, "web"), protocol: "web" });
      const webSession = await web.controller.createSession({
        resourceId: web.resourceId,
        scope: "web-thread",
        threadId: "web-thread",
      });
      const notification = { source: "test", kind: "test", summary: "test" };

      await expect(webSession.sendNotificationSignal(notification)).rejects.toThrow(
        "Pea web sessions do not support notifications.",
      );
      expect(admissions).toHaveLength(0);

      tui = await createPeaRuntime({ workspaceRoot: path.join(root, "tui") });
      await expect(tui.session!.sendNotificationSignal(notification)).resolves.toEqual({
        native: true,
      });
      expect(admissions).toHaveLength(1);
    } finally {
      sendNotificationSignal.mockRestore();
      await Promise.all([web?.close?.(), tui?.close?.()]);
      if (previousStateDirectory === undefined) delete process.env.PE_TOOLS_STATE_DIR;
      else process.env.PE_TOOLS_STATE_DIR = previousStateDirectory;
    }
  },
  runtimeTestTimeout,
);

test(
  "Pea uses native category resolution and exact permission matrices",
  async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pea-permissions-"));
    const previousStateDirectory = process.env.PE_TOOLS_STATE_DIR;
    process.env.PE_TOOLS_STATE_DIR = path.join(root, "state");
    try {
      for (const accessLevel of Object.keys(expectedPermissionRules) as Array<
        keyof typeof expectedPermissionRules
      >) {
        const runtime = await createPeaRuntime({
          accessLevel,
          workspaceRoot: path.join(root, accessLevel),
        });
        try {
          expect(runtime.session?.state.get().yolo).toBe(false);
          expect(runtime.session?.permissions.getRules()).toEqual(
            expectedPermissionRules[accessLevel],
          );
        } finally {
          await runtime.close?.();
        }
      }

      const runtime = await createPeaRuntime({
        accessLevel: "read-only",
        workspaceRoot: path.join(root, "categories"),
      });
      const session = runtime.session;
      if (!session) throw new Error("Expected Pea runtime session.");
      try {
        for (const category of [...Object.keys(TOOL_CATEGORIES), "other"] as const) {
          for (const candidate of ["read", "edit", "execute", "mcp", "other"] as const) {
            await session.permissions.setForCategory({
              category: candidate,
              policy: candidate === category ? "allow" : "deny",
            });
          }
          if (category !== "other") {
            for (const toolName of getToolsForCategory(category as keyof typeof TOOL_CATEGORIES)) {
              expect(session.resolveToolApproval(toolName), toolName).toBe("allow");
            }
          }
          expect(session.resolveToolApproval("ask_user")).toBe(
            category === "read" ? "allow" : "deny",
          );
          expect(session.resolveToolApproval("unknown_tool")).toBe(
            category === "other" ? "allow" : "deny",
          );
          for (const [toolName, metadata] of Object.entries(peaProductToolMetadata)) {
            expect(session.resolveToolApproval(toolName), toolName).toBe(
              metadata.category === category ? "allow" : "deny",
            );
          }
        }
        for (const category of ["read", "edit", "execute", "mcp"] as const) {
          await session.permissions.setForCategory({ category, policy: "allow" });
        }
        await session.permissions.setForCategory({ category: "other", policy: "deny" });
        expect(session.resolveToolApproval("unknown_tool")).toBe("deny");
        await session.permissions.setForTool({ toolName: "pe_do", policy: "deny" });
        expect(session.resolveToolApproval("pe_do")).toBe("deny");
      } finally {
        await runtime.close?.();
      }
    } finally {
      if (previousStateDirectory === undefined) delete process.env.PE_TOOLS_STATE_DIR;
      else process.env.PE_TOOLS_STATE_DIR = previousStateDirectory;
    }
  },
  runtimeTestTimeout,
);

test(
  "Pea runtime defaults closed and offers Revit tools only when asserted",
  async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pea-capabilities-"));
    const previousStateDirectory = process.env.PE_TOOLS_STATE_DIR;
    process.env.PE_TOOLS_STATE_DIR = path.join(root, "state");
    const productToolNames = Object.keys(peaProductToolMetadata);
    const noRevitToolNames = [
      "pe_find",
      "pe_read",
      "pe_do",
      "target_set",
      "read_image",
      "request_access",
      "revit_api_docs_search",
      "revit_api_docs_fetch",
    ];

    try {
      for (const [name, capabilities, expected] of [
        ["default", undefined, noRevitToolNames],
        ["revit", { revit: true } as const, productToolNames],
        ["no-revit", { revit: false } as const, noRevitToolNames],
      ] as const) {
        const runtime = await createPeaRuntime({
          capabilities,
          workspaceRoot: path.join(root, name),
        });
        try {
          const agent = runtime.controller.getMastra()?.getAgentById("pea-agent");
          if (typeof (agent as { listTools?: unknown } | undefined)?.listTools !== "function")
            throw new Error("Expected Pea runtime agent tool surface.");
          const tools = await (
            agent as { listTools: () => Promise<Record<string, unknown>> }
          ).listTools();
          expect(
            Object.keys(tools).filter((toolName) => productToolNames.includes(toolName)),
          ).toEqual(expected);
        } finally {
          await runtime.close?.();
        }
      }
    } finally {
      if (previousStateDirectory === undefined) delete process.env.PE_TOOLS_STATE_DIR;
      else process.env.PE_TOOLS_STATE_DIR = previousStateDirectory;
    }
  },
  runtimeTestTimeout,
);

test(
  "Pea persists concurrent native permission mutations",
  async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pea-native-permissions-"));
    const previousStateDirectory = process.env.PE_TOOLS_STATE_DIR;
    process.env.PE_TOOLS_STATE_DIR = path.join(root, "state");
    let runtime: Awaited<ReturnType<typeof createPeaRuntime>> | undefined;
    const expected = {
      yolo: false,
      permissionRules: {
        categories: { ...expectedPermissionRules.trusted.categories },
        tools: { pe_do: "deny" as const },
      },
    };
    try {
      runtime = await createPeaRuntime({ workspaceRoot: root, protocol: "web" });
      let session = await runtime.controller.createSession({
        resourceId: runtime.resourceId,
        scope: "browser-thread",
        threadId: "browser-thread",
      });
      await Promise.all([
        ...Object.entries(expected.permissionRules.categories).map(([category, policy]) =>
          session.permissions.setForCategory({
            category: category as keyof typeof expected.permissionRules.categories,
            policy,
          }),
        ),
        session.permissions.setForTool({ toolName: "pe_do", policy: "deny" }),
      ]);
      expect(await session.thread.getSetting({ key: "pea.permissions" })).toEqual(expected);
      await runtime.close?.();
      runtime = await createPeaRuntime({ workspaceRoot: root, protocol: "web" });
      session = await runtime.controller.createSession({
        resourceId: runtime.resourceId,
        scope: "browser-thread",
        threadId: "browser-thread",
      });
      expect(session.permissions.getRules()).toEqual(expected.permissionRules);
      expect(await session.thread.getSetting({ key: "pea.permissions" })).toEqual(expected);
    } finally {
      await runtime?.close?.();
      if (previousStateDirectory === undefined) delete process.env.PE_TOOLS_STATE_DIR;
      else process.env.PE_TOOLS_STATE_DIR = previousStateDirectory;
    }
  },
  runtimeTestTimeout,
);

test(
  "Pea blocks the next run on durable or active permission readback mismatch",
  async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pea-permission-mismatch-"));
    const previousStateDirectory = process.env.PE_TOOLS_STATE_DIR;
    process.env.PE_TOOLS_STATE_DIR = path.join(root, "state");
    try {
      for (const mode of ["durable", "active"] as const) {
        const runtime = await createPeaRuntime({ workspaceRoot: path.join(root, mode) });
        const session = runtime.session!;
        if (mode === "durable") {
          const setSetting = session.thread.setSetting.bind(session.thread);
          session.thread.setSetting = async (request) => {
            await setSetting(request);
            await setSetting({
              ...request,
              value: { yolo: false, permissionRules: expectedPermissionRules["read-only"] },
            });
          };
        } else {
          session.permissions.getRules = () => ({
            ...expectedPermissionRules.ask,
            tools: { pe_do: "deny" },
          });
        }
        await session.thread.create({ title: mode });
        await expect(session.sendSignal({ content: "must not run" }).accepted).rejects.toThrow(
          "Pea permission state did not persist exactly.",
        );
        await runtime.close?.();
      }
    } finally {
      if (previousStateDirectory === undefined) delete process.env.PE_TOOLS_STATE_DIR;
      else process.env.PE_TOOLS_STATE_DIR = previousStateDirectory;
    }
  },
  runtimeTestTimeout,
);

test(
  "Pea rechecks durable permissions before draining a queued follow-up",
  async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pea-follow-up-permission-drift-"));
    const previousStateDirectory = process.env.PE_TOOLS_STATE_DIR;
    process.env.PE_TOOLS_STATE_DIR = path.join(root, "state");
    const runtime = await createPeaRuntime({ workspaceRoot: root });
    try {
      const session = runtime.session!;
      await session.thread.create({ title: "permission drift" });
      vi.spyOn(session.run, "isRunning").mockReturnValue(true);
      vi.spyOn(session.stream, "isOpen").mockReturnValue(false);
      const sendMessage = vi.spyOn(session, "sendMessage");

      await session.followUp({ content: "queued before permission drift" });
      expect(session.followUps.count()).toBe(1);
      await session.thread.setSetting({
        key: "pea.permissions",
        value: { yolo: false, permissionRules: expectedPermissionRules["read-only"] },
      });

      await expect(session.drainFollowUpQueue()).rejects.toThrow(
        "Pea permission state did not persist exactly.",
      );
      expect(sendMessage).not.toHaveBeenCalled();
      expect(session.followUps.count()).toBe(1);
      await expect(runtime.close?.()).resolves.toBeUndefined();
    } finally {
      if (previousStateDirectory === undefined) delete process.env.PE_TOOLS_STATE_DIR;
      else process.env.PE_TOOLS_STATE_DIR = previousStateDirectory;
    }
  },
  runtimeTestTimeout,
);

test(
  "Pea validates native model membership and credentials before public resolution",
  async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pea-models-"));
    const previousStateDirectory = process.env.PE_TOOLS_STATE_DIR;
    process.env.PE_TOOLS_STATE_DIR = path.join(root, "state");
    let runtime: Awaited<ReturnType<typeof createPeaRuntime>> | undefined;
    try {
      runtime = await createPeaRuntime({ workspaceRoot: root });
      const models = [
        {
          id: defaultPeaAgentModelId,
          provider: "anthropic",
          modelName: "claude-opus-5",
          hasApiKey: true,
          useCount: 0,
        },
        {
          id: "openai/disabled",
          provider: "openai",
          modelName: "disabled",
          hasApiKey: false,
          useCount: 0,
        },
      ];
      vi.spyOn(runtime.controller, "listAvailableModels").mockResolvedValue(models);
      expect(await runtime.controller.listAvailableModels()).toEqual(models);
      if (!runtime.session) throw new Error("Expected Pea runtime session.");
      const agent = runtime.controller.getCurrentAgent(runtime.session);
      const activeRuntime = runtime;
      const requestContext = new RequestContext();
      const setContextModel = (modelId: string) =>
        requestContext.set("controller", {
          session: { modelId },
          getState: () => activeRuntime.session?.state.get() ?? {},
        });

      expect(runtime.session.model.get()).toBe(defaultPeaAgentModelId);
      setContextModel(defaultPeaAgentModelId);
      expect((await agent.getModel({ requestContext })).modelId).toBe("claude-opus-5");
      runtime.session.model.set({ modelId: "unknown/model" });
      setContextModel("unknown/model");
      await expect(agent.getModel({ requestContext })).rejects.toThrow(
        "Unknown Pea model 'unknown/model'.",
      );
      runtime.session.model.set({ modelId: "openai/disabled" });
      setContextModel("openai/disabled");
      await expect(agent.getModel({ requestContext })).rejects.toThrow(
        "has no available credentials",
      );
    } finally {
      await runtime?.close?.();
      if (previousStateDirectory === undefined) delete process.env.PE_TOOLS_STATE_DIR;
      else process.env.PE_TOOLS_STATE_DIR = previousStateDirectory;
    }
  },
  runtimeTestTimeout,
);

test(
  "Pea LocalSandbox inherits PATH only",
  async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pea-path-only-"));
    const previousStateDirectory = process.env.PE_TOOLS_STATE_DIR;
    const previousSentinel = process.env.PEA_PATH_ONLY_SENTINEL;
    process.env.PE_TOOLS_STATE_DIR = path.join(root, "state");
    process.env.PEA_PATH_ONLY_SENTINEL = "excluded";
    let runtime: Awaited<ReturnType<typeof createPeaRuntime>> | undefined;
    try {
      runtime = await createPeaRuntime({ workspaceRoot: root });
      if (!runtime.session) throw new Error("Expected Pea runtime session.");
      const workspace = await runtime.controller.getCurrentAgent(runtime.session).getWorkspace();
      const sandbox = workspace?.sandbox;
      expect(sandbox).toBeInstanceOf(LocalSandbox);
      expect((sandbox as LocalSandbox).buildEnv()).toEqual({ PATH: process.env.PATH });
      expect((sandbox as LocalSandbox).buildEnv()).not.toHaveProperty("PEA_PATH_ONLY_SENTINEL");
    } finally {
      await runtime?.close?.();
      if (previousStateDirectory === undefined) delete process.env.PE_TOOLS_STATE_DIR;
      else process.env.PE_TOOLS_STATE_DIR = previousStateDirectory;
      if (previousSentinel === undefined) delete process.env.PEA_PATH_ONLY_SENTINEL;
      else process.env.PEA_PATH_ONLY_SENTINEL = previousSentinel;
    }
  },
  runtimeTestTimeout,
);

test("the model picker's world is the allowlist, in allowlist order", () => {
  const catalog = (ids: string[]) =>
    ids.map((id) => ({
      id,
      provider: id.split("/")[0]!,
      modelName: id.split("/")[1]!,
      hasApiKey: false,
      useCount: 0,
    }));
  const narrowed = peaModels(
    catalog(["anthropic/claude-sonnet-5", "anthropic/claude-opus-5", "openai/gpt-5.6-terra"]),
  );
  expect(narrowed.map((model) => model.id)).toEqual([
    "openai/gpt-5.6-terra",
    "anthropic/claude-opus-5",
  ]);
  expect(peaModelAllowlist).toContain(defaultPeaAgentModelId);
});
