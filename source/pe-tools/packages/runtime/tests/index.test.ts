import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
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
const permissionSettingKey = "pea.permissions";
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

test("buildAgentControllerApp mounts the /pe/info handshake for a pea runtime", async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "pea-app-"));
  const previousStateDirectory = process.env.PE_TOOLS_STATE_DIR;
  process.env.PE_TOOLS_STATE_DIR = await mkdtemp(path.join(os.tmpdir(), "pea-app-state-"));
  let runtime: Awaited<ReturnType<typeof createPeaRuntime>> | undefined;

  try {
    runtime = await createPeaRuntime({ workspaceRoot });
    const app = await buildAgentControllerApp({ runtime, label: "pea" });
    const response = await app.fetch(new Request("http://local/pe/info"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      controllerId: "pea",
      resourceId: runtime.session?.identity.getResourceId(),
    });
  } finally {
    await runtime?.close?.();
    if (previousStateDirectory === undefined) delete process.env.PE_TOOLS_STATE_DIR;
    else process.env.PE_TOOLS_STATE_DIR = previousStateDirectory;
    await rm(workspaceRoot, { recursive: true, force: true });
  }
}, 30_000);

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
  "Pea rehydrates exact thread permissions across processes",
  async () => {
    const probe = await createPermissionProbe();
    try {
      await probe.run("seed");
      await probe.run("verify");
    } finally {
      await probe.dispose();
    }
  },
  runtimeTestTimeout,
);

test(
  "Pea aborts on durable or active native readback mismatch",
  async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pea-permission-mismatch-"));
    const previousStateDirectory = process.env.PE_TOOLS_STATE_DIR;
    process.env.PE_TOOLS_STATE_DIR = path.join(root, "state");
    let prototype: { createSession: (...args: any[]) => Promise<any> } | undefined;
    let createSession: ((...args: any[]) => Promise<any>) | undefined;
    try {
      const bootstrap = await createPeaRuntime({ workspaceRoot: path.join(root, "prototype") });
      prototype = Object.getPrototypeOf(bootstrap.controller);
      createSession = prototype!.createSession;
      await bootstrap.close?.();

      for (const mode of ["durable", "active"] as const) {
        prototype!.createSession = async function (...args) {
          prototype!.createSession = createSession!;
          const session = await createSession!.apply(this, args);
          if (mode === "durable") {
            const setSetting = session.thread.setSetting.bind(session.thread);
            session.thread.setSetting = async (request: { key: string; value: unknown }) => {
              await setSetting(request);
              await setSetting({
                ...request,
                value: { yolo: false, permissionRules: expectedPermissionRules["read-only"] },
              });
            };
          } else {
            const setState = session.state.set.bind(session.state);
            session.state.set = async (updates: Record<string, unknown>) => {
              await setState(updates);
              await setState({
                permissionRules: {
                  ...expectedPermissionRules.ask,
                  tools: { script_execute: "deny" },
                },
              });
            };
          }
          return session;
        };
        await expect(createPeaRuntime({ workspaceRoot: path.join(root, mode) })).rejects.toThrow(
          "Pea permission state did not persist exactly.",
        );
      }
    } finally {
      if (prototype && createSession) prototype.createSession = createSession;
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

type PermissionProbeMode = "seed" | "verify";

async function createPermissionProbe() {
  const root = await mkdtemp(path.join(os.tmpdir(), "pea-permissions-"));
  const scriptPath = path.join(root, "probe.ts");
  const runtimeUrl = new URL("../src/pea-runtime.ts", import.meta.url).href;
  const jitiEntry = createRequire(import.meta.url).resolve("jiti");
  const jitiCli = path.resolve(path.dirname(jitiEntry), "../lib/jiti-cli.mjs");
  await writeFile(scriptPath, permissionProbeSource(runtimeUrl), "utf8");

  return {
    run: (mode: PermissionProbeMode) => runPermissionProbe({ jitiCli, mode, root, scriptPath }),
    dispose: () => rm(root, { recursive: true }),
  };
}

function permissionProbeSource(runtimeUrl: string): string {
  return `
import assert from "node:assert/strict";
import path from "node:path";
import { createPeaRuntime } from ${JSON.stringify(runtimeUrl)};

const settingKey = ${JSON.stringify(permissionSettingKey)};
const expected = ${JSON.stringify(expectedPermissionRules)};
const mode = process.env.PEA_WAVE3A_PROBE_MODE; const root = process.env.PEA_WAVE3A_PROBE_ROOT;
assert.ok(mode && root); const workspace = (name) => path.join(root, name);
const trustedRecord = { yolo: false, permissionRules: { ...expected.trusted, tools: { script_execute: "deny" } } };
const readOnlyRecord = { yolo: false, permissionRules: expected["read-only"] }; const invalidRecords = {
  malformed: { yolo: false, permissionRules: { categories: expected.trusted.categories, tools: { script_execute: "wat" } } },
  partial: { yolo: false, permissionRules: { categories: { read: "allow" }, tools: {} } },
  yolo: { yolo: true, permissionRules: expected.trusted },
};

function sessionOf(runtime) { assert.ok(runtime.session); return runtime.session; }

if (mode === "seed") {
  const runtime = await createPeaRuntime({ accessLevel: "trusted", workspaceRoot: workspace("threads") });
  const session = sessionOf(runtime);
  const trustedThreadId = session.thread.requireId(); await session.thread.rename({ title: "trusted" });
  await session.thread.setSetting({ key: settingKey, value: trustedRecord });
  await session.state.set({ yolo: false, permissionRules: trustedRecord.permissionRules });
  const readOnlyThread = await session.thread.create({ title: "read-only" });
  await session.thread.switch({ threadId: trustedThreadId }); await session.thread.switch({ threadId: readOnlyThread.id });
  await session.thread.setSetting({ key: settingKey, value: readOnlyRecord });
  await session.state.set({ yolo: false, permissionRules: readOnlyRecord.permissionRules });
  await runtime.close?.();

  for (const [name, record] of Object.entries(invalidRecords)) {
    const invalid = await createPeaRuntime({ workspaceRoot: workspace(name) });
    await sessionOf(invalid).thread.setSetting({ key: settingKey, value: record });
    await invalid.close?.();
  }
} else if (mode === "verify") {
  const runtime = await createPeaRuntime({ workspaceRoot: workspace("threads") });
  const session = sessionOf(runtime);
  const threads = await session.thread.list();
  const trusted = threads.find((thread) => thread.title === "trusted");
  const readOnly = threads.find((thread) => thread.title === "read-only");
  assert.ok(trusted && readOnly);

  assert.equal(session.thread.getId(), readOnly.id);
  assert.deepStrictEqual(session.permissions.getRules(), readOnlyRecord.permissionRules);
  assert.deepStrictEqual(await session.thread.getSetting({ key: settingKey }), readOnlyRecord);
  await session.thread.switch({ threadId: trusted.id });
  assert.deepStrictEqual(session.permissions.getRules(), trustedRecord.permissionRules);
  assert.deepStrictEqual(await session.thread.getSetting({ key: settingKey }), trustedRecord);
  assert.equal(session.resolveToolApproval("script_execute"), "deny");
  await session.thread.switch({ threadId: readOnly.id });
  assert.deepStrictEqual(session.permissions.getRules(), readOnlyRecord.permissionRules);
  assert.deepStrictEqual(await session.thread.getSetting({ key: settingKey }), readOnlyRecord);
  await runtime.close?.();
  await runtime.close?.();

  for (const name of Object.keys(invalidRecords)) {
    const invalid = await createPeaRuntime({ accessLevel: "trusted", workspaceRoot: workspace(name) });
    const invalidSession = sessionOf(invalid);
    assert.deepStrictEqual(invalidSession.permissions.getRules(), readOnlyRecord.permissionRules);
    assert.deepStrictEqual(
      await invalidSession.thread.getSetting({ key: settingKey }),
      readOnlyRecord,
    );
    assert.equal(invalidSession.state.get().yolo, false);
    await invalid.close?.();
  }
} else {
  throw new Error(\`Unknown probe mode '\${mode}'.\`);
}
`;
}

async function runPermissionProbe(options: {
  jitiCli: string;
  mode: PermissionProbeMode;
  root: string;
  scriptPath: string;
}): Promise<void> {
  const child = spawn(process.execPath, [options.jitiCli, options.scriptPath], {
    cwd: path.resolve(import.meta.dirname, "../../.."),
    env: {
      ...process.env,
      PE_TOOLS_STATE_DIR: path.join(options.root, "state"),
      PEA_WAVE3A_PROBE_MODE: options.mode,
      PEA_WAVE3A_PROBE_ROOT: options.root,
    },
    signal: AbortSignal.timeout(runtimeTestTimeout),
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => (stdout += chunk));
  child.stderr.on("data", (chunk) => (stderr += chunk));
  const code = await new Promise<number | null>((resolve, reject) => {
    child.on("error", reject);
    child.on("close", resolve);
  });
  if (code !== 0) {
    throw new Error(
      `Permission probe '${options.mode}' exited ${code}.\nstdout:\n${stdout}\nstderr:\n${stderr}`,
    );
  }
}
