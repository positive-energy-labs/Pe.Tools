import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { AgentController } from "@mastra/core/agent-controller";
import { RequestContext } from "@mastra/core/request-context";
import { LocalSandbox } from "@mastra/core/workspace";
import { TOOL_CATEGORIES, getToolsForCategory } from "@mastra/code-sdk/permissions";
import { expect, test, vi } from "vite-plus/test";
import { permissionRulesForAccessLevel, type RuntimeAccessLevel } from "@pe/agent-contracts";
import { peaProductToolCatalog } from "@pe/mcps";
import {
  buildAgentControllerApp,
  createRuntimeController,
  type RuntimeInjectedControllerConfig,
} from "../src/index.ts";
import { createPeaRuntime, defaultPeaAgentModelId } from "../src/pea-runtime.ts";

const runtimeTestTimeout = 60_000;

test("runtime controller close closes injected storage", async () => {
  let storageClosed = false;
  const config: RuntimeInjectedControllerConfig = {
    storage: {
      close: async () => {
        storageClosed = true;
      },
    },
  };
  const runtime = await createRuntimeController({
    config,
    controller: {},
  });

  expect(runtime.session).toBeUndefined();
  await runtime.close?.();
  expect(storageClosed).toBe(true);
});

test("buildAgentControllerApp mounts the /pe/info handshake for a pea runtime", async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "pea-app-"));
  const runtime = await createPeaRuntime({ workspaceRoot });

  try {
    const app = await buildAgentControllerApp({ runtime, label: "pea" });
    const response = await app.fetch(new Request("http://local/pe/info"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      controllerId: "pea",
      resourceId: runtime.session?.identity.getResourceId(),
    });
  } finally {
    await runtime.close?.();
    await rm(workspaceRoot, { recursive: true, force: true });
  }
}, 30_000);

test(
  "Pea uses native category resolution and exact permission matrices",
  async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pea-permissions-"));
    const previousStateDirectory = process.env.PE_TOOLS_STATE_DIR;
    process.env.PE_TOOLS_STATE_DIR = path.join(root, "state");
    const expected = {
      "read-only": { read: "allow", edit: "deny", execute: "deny", mcp: "deny", other: "deny" },
      ask: { read: "allow", edit: "ask", execute: "ask", mcp: "ask", other: "deny" },
      trusted: { read: "allow", edit: "allow", execute: "allow", mcp: "allow", other: "deny" },
    } as const;

    try {
      for (const accessLevel of Object.keys(expected) as RuntimeAccessLevel[]) {
        const runtime = await createPeaRuntime({
          accessLevel,
          workspaceRoot: path.join(root, accessLevel),
        });
        try {
          expect(runtime.session?.state.get().yolo).toBe(false);
          expect(runtime.session?.permissions.getRules()).toEqual({
            categories: expected[accessLevel],
            tools: {},
          });
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
          for (const [toolName, metadata] of peaProductToolCatalog) {
            const expectedCategory =
              metadata.kind === "read" ||
              metadata.kind === "search" ||
              metadata.kind === "fetch" ||
              metadata.kind === "think"
                ? "read"
                : metadata.kind === "edit" || metadata.kind === "delete"
                  ? "edit"
                  : metadata.kind;
            expect(session.resolveToolApproval(toolName), toolName).toBe(
              expectedCategory === category ? "allow" : "deny",
            );
          }
        }
        for (const category of ["read", "edit", "execute", "mcp"] as const) {
          await session.permissions.setForCategory({ category, policy: "allow" });
        }
        await session.permissions.setForCategory({ category: "other", policy: "deny" });
        expect(session.resolveToolApproval("unknown_tool")).toBe("deny");
        await session.permissions.setForTool({ toolName: "script_execute", policy: "deny" });
        expect(session.resolveToolApproval("script_execute")).toBe("deny");
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
  "Pea persists native rules, preserves overrides, and falls closed on malformed state",
  async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pea-permission-state-"));
    const previousStateDirectory = process.env.PE_TOOLS_STATE_DIR;
    process.env.PE_TOOLS_STATE_DIR = path.join(root, "state");
    try {
      const persistedProfile = vi
        .spyOn(AgentController.prototype, "createSession")
        .mockImplementationOnce(async function (
          this: AgentController<Record<string, unknown>>,
          ...args
        ) {
          persistedProfile.mockRestore();
          const session = await this.createSession(...args);
          await session.state.set({
            yolo: false,
            permissionRules: permissionRulesForAccessLevel("trusted"),
          });
          await session.permissions.setForTool({ toolName: "script_execute", policy: "deny" });
          return session;
        });
      const readback = await createPeaRuntime({ workspaceRoot: path.join(root, "readback") });
      expect(readback.session?.permissions.getRules()).toEqual({
        ...permissionRulesForAccessLevel("trusted"),
        tools: { script_execute: "deny" },
      });
      expect(readback.session?.state.get().yolo).toBe(false);
      await readback.close?.();
      persistedProfile.mockRestore();

      const malformedProfile = vi
        .spyOn(AgentController.prototype, "createSession")
        .mockImplementationOnce(async function (
          this: AgentController<Record<string, unknown>>,
          ...args
        ) {
          malformedProfile.mockRestore();
          const session = await this.createSession(...args);
          await session.state.set({
            yolo: true,
            permissionRules: { categories: { read: "allow" }, tools: { script_execute: "wat" } },
          });
          return session;
        });
      const malformed = await createPeaRuntime({ workspaceRoot: path.join(root, "malformed") });
      expect(malformed.session?.permissions.getRules()).toEqual(
        permissionRulesForAccessLevel("read-only"),
      );
      expect(malformed.session?.state.get().yolo).toBe(false);
      await malformed.close?.();
      malformedProfile.mockRestore();
    } finally {
      if (previousStateDirectory === undefined) delete process.env.PE_TOOLS_STATE_DIR;
      else process.env.PE_TOOLS_STATE_DIR = previousStateDirectory;
    }
  },
  runtimeTestTimeout,
);

test(
  "Pea aborts construction when native permission readback mismatches",
  async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pea-permission-mismatch-"));
    const previousStateDirectory = process.env.PE_TOOLS_STATE_DIR;
    process.env.PE_TOOLS_STATE_DIR = path.join(root, "state");
    const createSession = vi
      .spyOn(AgentController.prototype, "createSession")
      .mockImplementation(async function (this: AgentController<Record<string, unknown>>, ...args) {
        createSession.mockRestore();
        const session = await this.createSession(...args);
        vi.spyOn(session.state, "set").mockResolvedValue();
        return session;
      });
    try {
      await expect(createPeaRuntime({ workspaceRoot: root })).rejects.toThrow(
        "Pea permission state did not persist exactly.",
      );
    } finally {
      createSession.mockRestore();
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
    const runtime = await createPeaRuntime({ workspaceRoot: root });
    try {
      const models = [
        {
          id: defaultPeaAgentModelId,
          provider: "openai",
          modelName: "gpt-5.6-terra",
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
      const requestContext = new RequestContext();
      const setContextModel = (modelId: string) =>
        requestContext.set("controller", {
          session: { modelId },
          getState: () => runtime.session?.state.get() ?? {},
        });

      expect(runtime.session.model.get()).toBe(defaultPeaAgentModelId);
      setContextModel(defaultPeaAgentModelId);
      expect((await agent.getModel({ requestContext })).modelId).toBe("gpt-5.6-terra");
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
      await runtime.close?.();
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
    const runtime = await createPeaRuntime({ workspaceRoot: root });
    try {
      if (!runtime.session) throw new Error("Expected Pea runtime session.");
      const workspace = await runtime.controller.getCurrentAgent(runtime.session).getWorkspace();
      const sandbox = workspace?.sandbox;
      expect(sandbox).toBeInstanceOf(LocalSandbox);
      expect((sandbox as LocalSandbox).buildEnv()).toEqual({ PATH: process.env.PATH });
      expect((sandbox as LocalSandbox).buildEnv()).not.toHaveProperty("PEA_PATH_ONLY_SENTINEL");
    } finally {
      await runtime.close?.();
      if (previousStateDirectory === undefined) delete process.env.PE_TOOLS_STATE_DIR;
      else process.env.PE_TOOLS_STATE_DIR = previousStateDirectory;
      if (previousSentinel === undefined) delete process.env.PEA_PATH_ONLY_SENTINEL;
      else process.env.PEA_PATH_ONLY_SENTINEL = previousSentinel;
    }
  },
  runtimeTestTimeout,
);
