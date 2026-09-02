import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { Session } from "@mastra/core/agent-controller";
import { createSignal } from "@mastra/core/agent";
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
import { createPeaRuntime } from "../src/pea-runtime.ts";

const runtimeTestTimeout = 60_000;
const defaultPeaAgentModelId = "openai/gpt-5.6-terra";
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
      const resourceId = runtime.resourceId!;
      await expect(runtime.controller.createSession({ resourceId, scope: "A" })).rejects.toThrow(
        "requires threadId equal to scope",
      );
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
  "Pea runtime defaults closed and offers Revit tools only when asserted",
  async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pea-capabilities-"));
    const previousStateDirectory = process.env.PE_TOOLS_STATE_DIR;
    process.env.PE_TOOLS_STATE_DIR = path.join(root, "state");
    const productToolNames = Object.keys(peaProductToolMetadata);
    const noRevitToolNames = [
      "request_access",
      "read_image",
      "revit_api_docs_search",
      "revit_api_docs_fetch",
      "route_state_read",
      "route_state_apply",
      "route_command",
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
  "Pea rehydrates exact thread permissions across processes",
  async () => {
    const probe = await createPermissionProbe();
    await probe("seed");
    await probe("verify");
  },
  runtimeTestTimeout,
);

test(
  "Pea persists concurrent native permission mutations",
  async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pea-native-permissions-"));
    const previousStateDirectory = process.env.PE_TOOLS_STATE_DIR;
    process.env.PE_TOOLS_STATE_DIR = path.join(root, "state");
    const sendSignal = vi.spyOn(Session.prototype, "sendSignal").mockReturnValue({
      id: "stub",
      type: "user",
      accepted: Promise.resolve({ accepted: true }),
    } as never);
    let runtime: Awaited<ReturnType<typeof createPeaRuntime>> | undefined;
    const expected = {
      yolo: false,
      permissionRules: {
        categories: { ...expectedPermissionRules.trusted.categories },
        tools: { script_execute: "deny" as const },
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
        session.permissions.setForTool({ toolName: "script_execute", policy: "deny" }),
      ]);
      expect(await session.thread.getSetting({ key: "pea.permissions" })).toEqual(expected);
      await expect(
        session.sendMessage({ content: "guarded before restart" }),
      ).resolves.toBeUndefined();

      await runtime.close?.();
      runtime = await createPeaRuntime({ workspaceRoot: root, protocol: "web" });
      session = await runtime.controller.createSession({
        resourceId: runtime.resourceId,
        scope: "browser-thread",
        threadId: "browser-thread",
      });
      expect(session.permissions.getRules()).toEqual(expected.permissionRules);
      expect(await session.thread.getSetting({ key: "pea.permissions" })).toEqual(expected);
      await expect(
        session.sendMessage({ content: "guarded after restart" }),
      ).resolves.toBeUndefined();
      expect(sendSignal).toHaveBeenCalledTimes(2);
    } finally {
      await runtime?.close?.();
      sendSignal.mockRestore();
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
            tools: { script_execute: "deny" },
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
      const activeRuntime = runtime;
      const requestContext = new RequestContext();
      const setContextModel = (modelId: string) =>
        requestContext.set("controller", {
          session: { modelId },
          getState: () => activeRuntime.session?.state.get() ?? {},
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

async function createPermissionProbe() {
  const root = await mkdtemp(path.join(os.tmpdir(), "pea-permissions-"));
  const scriptPath = path.join(root, "probe.ts");
  const runtimeUrl = new URL("../src/pea-runtime.ts", import.meta.url).href;
  const jitiEntry = createRequire(import.meta.url).resolve("jiti");
  const jitiCli = path.resolve(path.dirname(jitiEntry), "../lib/jiti-cli.mjs");
  await writeFile(scriptPath, permissionProbeSource(runtimeUrl), "utf8");
  return (mode: "seed" | "verify") =>
    promisify(execFile)(process.execPath, [jitiCli, scriptPath], {
      cwd: path.resolve(import.meta.dirname, "../../.."),
      env: {
        ...process.env,
        PE_TOOLS_STATE_DIR: path.join(root, "state"),
        PEA_WAVE3A_PROBE_MODE: mode,
        PEA_WAVE3A_PROBE_ROOT: root,
      },
      signal: AbortSignal.timeout(runtimeTestTimeout),
    });
}

function permissionProbeSource(runtimeUrl: string): string {
  return `
import assert from "node:assert/strict"; import path from "node:path"; import { createPeaRuntime } from ${JSON.stringify(runtimeUrl)};
const settingKey = "pea.permissions"; const expected = ${JSON.stringify(expectedPermissionRules)};
const mode = process.env.PEA_WAVE3A_PROBE_MODE; const root = process.env.PEA_WAVE3A_PROBE_ROOT; assert.ok(mode && root);
const workspace = (name) => path.join(root, name); function sessionOf(runtime) { assert.ok(runtime.session); return runtime.session; }
const trustedRecord = { yolo: false, permissionRules: { ...expected.trusted, tools: { script_execute: "deny" } } }; const readOnlyRecord = { yolo: false, permissionRules: expected["read-only"] }; const invalidRecords = { malformed: { yolo: false, permissionRules: { categories: expected.trusted.categories, tools: { script_execute: "wat" } } }, partial: { yolo: false, permissionRules: { categories: { read: "allow" }, tools: {} } }, yolo: { yolo: true, permissionRules: expected.trusted } }; if (mode === "seed") {
  const runtime = await createPeaRuntime({ accessLevel: "trusted", workspaceRoot: workspace("threads") }); const session = sessionOf(runtime);
  const trustedThreadId = session.thread.requireId(); await session.thread.rename({ title: "trusted" }); await session.thread.setSetting({ key: settingKey, value: trustedRecord });
  await session.state.set({ yolo: false, permissionRules: trustedRecord.permissionRules }); const readOnlyThread = await session.thread.create({ title: "read-only" });
  await session.thread.switch({ threadId: trustedThreadId }); await session.thread.switch({ threadId: readOnlyThread.id });
  await session.thread.setSetting({ key: settingKey, value: readOnlyRecord }); await session.state.set({ yolo: false, permissionRules: readOnlyRecord.permissionRules }); await runtime.close?.();
  for (const [name, record] of Object.entries(invalidRecords)) { const invalid = await createPeaRuntime({ workspaceRoot: workspace(name) }); await sessionOf(invalid).thread.setSetting({ key: settingKey, value: record }); await invalid.close?.(); }
} else if (mode === "verify") {
  const runtime = await createPeaRuntime({ workspaceRoot: workspace("threads") }); const session = sessionOf(runtime);
  const threads = await session.thread.list(); const trusted = threads.find((thread) => thread.title === "trusted"); const readOnly = threads.find((thread) => thread.title === "read-only"); assert.ok(trusted && readOnly);
  assert.equal(session.thread.getId(), readOnly.id); assert.deepStrictEqual(session.permissions.getRules(), readOnlyRecord.permissionRules); assert.deepStrictEqual(await session.thread.getSetting({ key: settingKey }), readOnlyRecord);
  await session.thread.switch({ threadId: trusted.id }); assert.deepStrictEqual(session.permissions.getRules(), trustedRecord.permissionRules); assert.deepStrictEqual(await session.thread.getSetting({ key: settingKey }), trustedRecord); assert.equal(session.resolveToolApproval("script_execute"), "deny");
  await session.thread.switch({ threadId: readOnly.id }); assert.deepStrictEqual(session.permissions.getRules(), readOnlyRecord.permissionRules); assert.deepStrictEqual(await session.thread.getSetting({ key: settingKey }), readOnlyRecord);
  const askRecord = { yolo: false, permissionRules: { ...expected.ask, tools: { script_execute: "deny" } } };
  const getSetting = session.thread.getSetting.bind(session.thread); const originalSetSetting = session.thread.setSetting.bind(session.thread); const originalSetState = session.state.set.bind(session.state);
  for (const delayed of ["active", "durable"]) { await session.thread.switch({ threadId: readOnly.id }); await session.thread.setSettingOn({ threadId: trusted.id, key: settingKey, value: trustedRecord }); let releaseOldA, reachOldA, inFlight = 0, maxInFlight = 0, durableWrites = 0, activeWrites = 0, delay = true; const oldAReleased = new Promise((resolve) => { releaseOldA = resolve; }); const oldAReached = new Promise((resolve) => { reachOldA = resolve; });
    const mutate = async (kind, delegate, value) => { inFlight++; maxInFlight = Math.max(maxInFlight, inFlight); try { if (delay && delayed === kind) { delay = false; reachOldA(); await oldAReleased; } await delegate(value); } finally { inFlight--; } }; session.thread.setSetting = async (request) => { durableWrites++; await mutate("durable", originalSetSetting, request); }; session.state.set = async (updates) => { activeWrites++; await mutate("active", originalSetState, updates); }; const changed = (threadId) => new Promise((resolve) => { const unsubscribe = session.subscribe((event) => { if (event.type === "thread_changed" && event.threadId === threadId) { unsubscribe(); resolve(); } }); });
    const oldA = session.thread.switch({ threadId: trusted.id }); await oldAReached; const reachedB = changed(readOnly.id); const switchB = session.thread.switch({ threadId: readOnly.id }); await reachedB;
    await session.thread.setSettingOn({ threadId: trusted.id, key: settingKey, value: askRecord }); const reachedNewA = changed(trusted.id); const newA = session.thread.switch({ threadId: trusted.id }); await reachedNewA; await Promise.resolve(); await Promise.resolve();
    if (maxInFlight > 1) { await newA; const writesAtExact = [durableWrites, activeWrites]; releaseOldA(); await oldA.catch(() => {}); assert.deepStrictEqual([durableWrites, activeWrites], writesAtExact); } else releaseOldA(); const settled = await Promise.allSettled([oldA, switchB, newA]); assert.equal(settled[1].status, "fulfilled"); assert.equal(settled[2].status, "fulfilled"); assert.equal(maxInFlight, 1);
    assert.deepStrictEqual(session.permissions.getRules(), askRecord.permissionRules, delayed + " active"); assert.deepStrictEqual(await getSetting({ key: settingKey }), askRecord, delayed + " durable"); session.thread.setSetting = originalSetSetting; session.state.set = originalSetState; }
  await runtime.close?.(); await runtime.close?.();
  const bootstrap = await createPeaRuntime({ workspaceRoot: workspace("signal-bootstrap") }); const sessionPrototype = Object.getPrototypeOf(sessionOf(bootstrap)); const coreSendSignal = sessionPrototype.sendSignal; await bootstrap.close?.();
  const admissions = []; const delegated = { accepted: true, action: "wake" }; sessionPrototype.sendSignal = function (input, options) { admissions.push({ input, options }); return { id: "delegated", type: "user", accepted: input.content === "reject" ? Promise.reject(new Error("delegated rejection")) : Promise.resolve(delegated) }; };
  let admission; try { admission = await createPeaRuntime({ workspaceRoot: workspace("signal") }); } finally { sessionPrototype.sendSignal = coreSendSignal; }
  const admissionSession = sessionOf(admission); const admissionGetSetting = admissionSession.thread.getSetting.bind(admissionSession.thread);
  let releaseAdmission, reachAdmission; const admissionReleased = new Promise((resolve) => { releaseAdmission = resolve; }); const admissionReached = new Promise((resolve) => { reachAdmission = resolve; });
  admissionSession.thread.getSetting = async (request) => { const value = await admissionGetSetting(request); reachAdmission(); await admissionReleased; return value; };
  await admissionSession.thread.create({ title: "TUI new thread" }); const idleInput = { content: "ordinary", ifIdle: { attributes: { path: "idle" } } }; const idleOptions = { requireDelivery: true }; const idle = admissionSession.sendSignal(idleInput, idleOptions);
  admissionSession.run.ensureAbortController(); const activeInput = { content: "interjection", ifActive: { attributes: { path: "active" } } }; const active = admissionSession.sendSignal(activeInput);
  await admissionReached; assert.equal(admissions.length, 0); releaseAdmission();
  assert.deepStrictEqual(await idle.accepted, delegated); assert.deepStrictEqual(await active.accepted, delegated); assert.deepStrictEqual([idle.type, active.type], ["user", "user"]);
  assert.equal(admissions[0].input, idleInput); assert.equal(admissions[0].options, idleOptions); assert.equal(admissions[1].input, activeInput); assert.deepStrictEqual(admissions.slice(0, 2).map(({ input }) => input), [idleInput, activeInput]); admissionSession.run.reset();
  const union = [{ id: "user", type: "user", contents: "u" }, { id: "state", type: "state", cacheKey: "state", contents: "s" }, { id: "reactive", type: "reactive", contents: "r" }, { id: "notification", type: "notification", contents: "n" }, { id: "legacy-user", type: "user-message", contents: "lu" }, { id: "legacy-system", type: "system-reminder", contents: "ls" }]; for (const input of union) { const receipt = admissionSession.sendSignal(input); assert.equal(receipt.id, input.id); assert.equal(receipt.type, input.type === "user-message" ? "user" : input.type === "system-reminder" ? "reactive" : input.type); await receipt.accepted; assert.equal(admissions.at(-1).input, input); } await assert.rejects(admissionSession.sendSignal({ content: "reject" }).accepted, /delegated rejection/); const isActive = admissionSession.stream.isActive.bind(admissionSession.stream); admissionSession.stream.isActive = () => true; const beforeMessage = admissions.length; await admissionSession.sendMessage({ content: "message" }); assert.equal(admissions.length, beforeMessage + 1); admissionSession.stream.isActive = isActive; await admission.close?.();
  let coreAdmissions = 0, agentAdmissions = 0; sessionPrototype.sendSignal = function (input, options) { coreAdmissions++; return coreSendSignal.call(this, input, options); }; let guarded; try { guarded = await createPeaRuntime({ workspaceRoot: workspace("guarded-signal") }); } finally { sessionPrototype.sendSignal = coreSendSignal; } const guardedSession = sessionOf(guarded); const threadA = guardedSession.thread.requireId(); const threadB = await guardedSession.thread.create({ title: "guarded B" }); await guardedSession.thread.switch({ threadId: threadA }); const admittedThreads = []; const guardedAgent = guarded.controller.getCurrentAgent(guardedSession); guardedAgent.sendSignal = (signal) => { agentAdmissions++; admittedThreads.push(guardedSession.thread.requireId()); return { signal, accepted: Promise.resolve({ action: "deliver", runId: "probe" }), persisted: Promise.resolve() }; }; for (let race = 0; race < 40; race++) { const submitted = guardedSession.thread.requireId(); const target = submitted === threadA ? threadB.id : threadA; const before = agentAdmissions; const receipt = guardedSession.sendSignal({ content: "race " + race }); const switched = guardedSession.thread.switch({ threadId: target }); const [accepted] = await Promise.allSettled([receipt.accepted, switched]); if (accepted.status === "fulfilled") { assert.equal(agentAdmissions, before + 1); assert.equal(admittedThreads.at(-1), submitted); } else assert.equal(agentAdmissions, before); } assert.equal(coreAdmissions, agentAdmissions); coreAdmissions = 0; agentAdmissions = 0; const closingReceipt = guardedSession.sendSignal({ content: "close admission" }); const closing = guarded.close(); await assert.rejects(closingReceipt.accepted, /changed during hydration/); await closing; await guarded.close(); assert.deepStrictEqual([coreAdmissions, agentAdmissions], [0, 0]);
  for (const [name, before, after, expectedAttributes] of [["idle", false, false, { idle: true }], ["active", true, true, { active: true, delivery: "while-active" }], ["idle-active", false, true, { active: true, delivery: "while-active" }], ["active-idle", true, false, { idle: true }]]) { const transition = await createPeaRuntime({ workspaceRoot: workspace(name) }); const transitionSession = sessionOf(transition); const agent = transition.controller.getCurrentAgent(transitionSession); const agentSendSignal = agent.sendSignal.bind(agent); let admitted; agent.sendSignal = (signal, target) => { admitted = { ...signal.attributes, ...(after ? target.ifActive : target.ifIdle)?.attributes }; return { signal, accepted: Promise.resolve({ action: "deliver", runId: "probe" }), persisted: Promise.resolve() }; }; const transitionGetSetting = transitionSession.thread.getSetting.bind(transitionSession.thread); let release, reach; const released = new Promise((resolve) => { release = resolve; }); const reached = new Promise((resolve) => { reach = resolve; }); transitionSession.thread.getSetting = async (request) => { const value = await transitionGetSetting(request); reach(); await released; return value; };
    await transitionSession.thread.create({ title: name }); if (before) transitionSession.run.ensureAbortController(); const receipt = transitionSession.sendSignal({ content: name, ifIdle: { attributes: { idle: true } }, ifActive: { attributes: { active: true } } }); if (after) transitionSession.run.ensureAbortController(); else transitionSession.run.reset(); await reached; release(); await receipt.accepted; assert.deepStrictEqual(admitted, expectedAttributes, name); agent.sendSignal = agentSendSignal; transitionSession.run.reset(); await transition.close?.(); }
  for (const name of Object.keys(invalidRecords)) {
    const invalid = await createPeaRuntime({ accessLevel: "trusted", workspaceRoot: workspace(name) }); const invalidSession = sessionOf(invalid); assert.deepStrictEqual(invalidSession.permissions.getRules(), readOnlyRecord.permissionRules); assert.deepStrictEqual(await invalidSession.thread.getSetting({ key: settingKey }), readOnlyRecord);
    assert.equal(invalidSession.state.get().yolo, false); await invalid.close?.();
  }
} else throw new Error(\`Unknown probe mode '\${mode}'.\`);
`;
}

test(
  "a send persists the client message id and binding on the signal row",
  async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pea-send-signal-"));
    const previousStateDirectory = process.env.PE_TOOLS_STATE_DIR;
    process.env.PE_TOOLS_STATE_DIR = path.join(root, "state");
    const sent: unknown[] = [];
    const sendSignal = vi.spyOn(Session.prototype, "sendSignal").mockImplementation(((
      input: unknown,
    ) => {
      sent.push(input);
      return { id: "stub", type: "user", accepted: Promise.resolve({ accepted: true }) };
    }) as never);
    let runtime: Awaited<ReturnType<typeof createPeaRuntime>> | undefined;
    try {
      runtime = await createPeaRuntime({ workspaceRoot: root, protocol: "web" });
      const session = await runtime.controller.createSession({
        resourceId: runtime.resourceId,
        scope: "browser-thread",
        threadId: "browser-thread",
      });
      const requestContext = new RequestContext();
      requestContext.set("clientMessageId", "client-7");
      requestContext.set("binding", { doc: "revit://doc/1", target: "selection" });
      await session.sendMessage({
        content: "hello",
        files: [
          { data: "data:text/plain;base64,aGk=", mediaType: "text/plain", filename: "a.txt" },
        ],
        requestContext,
      });
      expect(sent).toHaveLength(1);
      // The vendor serializer is the same one the DB row goes through: id and metadata survive.
      const row = createSignal(sent[0] as never).toDBMessage({ threadId: "browser-thread" });
      expect(row.id).toBe("client-7");
      expect(row.content.metadata).toMatchObject({
        signal: {
          id: "client-7",
          metadata: { binding: { doc: "revit://doc/1", target: "selection" } },
        },
      });
      const text = row.content.parts.map((part) => ("text" in part ? part.text : "")).join("\n");
      expect(text).toContain("hello");
      expect(text).toContain("[File: a.txt]\n```\nhi\n```");
    } finally {
      await runtime?.close?.();
      sendSignal.mockRestore();
      if (previousStateDirectory === undefined) delete process.env.PE_TOOLS_STATE_DIR;
      else process.env.PE_TOOLS_STATE_DIR = previousStateDirectory;
    }
  },
  runtimeTestTimeout,
);
