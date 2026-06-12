import { tmpdir } from "node:os";
import path from "node:path";
import type { MastraCompositeStore } from "@mastra/core/storage";
import { LibSQLStore } from "@mastra/libsql";
import { expect, test } from "vite-plus/test";
import {
  createMastraGatewayRouterModel,
  createPeaCloudGatewayRuntimeAuthProfile,
  createRuntimeDescriptor,
  createRuntimeHarness,
  defaultMastraCodeApiKeyEnvVars,
  hasMastraCodeStoredAuth,
  loadStoredMastraCodeApiKeysIntoEnv,
  createRuntimeLibSqlStorage,
  createRuntimeMemoryOptions,
  RuntimeProtocolSessions,
  type RuntimeFactory,
  type RuntimeHandle,
  type RuntimeHarnessConfig,
} from "../src/index.ts";

test("exports runtime contracts", () => {
  expect(createRuntimeDescriptor("test-runtime").id).toBe("test-runtime");
});

test("describes Pea Cloud Gateway auth without provider keys by default", () => {
  const profile = createPeaCloudGatewayRuntimeAuthProfile();

  expect(profile.descriptor.source).toBe("gateway");
  expect(profile.descriptor.methods).toEqual([
    expect.objectContaining({
      id: "pea-cloud-gateway",
      kind: "agent",
    }),
  ]);
  expect(profile.descriptor.metadata).toEqual({
    gateway: "mastra",
    gatewayAuthority: "pea-cloud",
  });
});

test("centralizes MastraCode auth storage env mapping and provider checks", () => {
  let loadedProviders: Record<string, string> | undefined;
  const authStorage = {
    loadStoredApiKeysIntoEnv: (providers: Record<string, string>) => {
      loadedProviders = providers;
    },
    hasStoredApiKey: (provider: string) => provider === "openai",
    isLoggedIn: (provider: string) => provider === "anthropic",
  };

  loadStoredMastraCodeApiKeysIntoEnv(authStorage);

  expect(loadedProviders).toEqual(defaultMastraCodeApiKeyEnvVars);
  expect(hasMastraCodeStoredAuth(authStorage, "openai")).toBe(true);
  expect(hasMastraCodeStoredAuth(authStorage, "anthropic")).toBe(true);
  expect(hasMastraCodeStoredAuth(authStorage, "groq")).toBe(false);
});

test("creates a Mastra Gateway model router", () => {
  const model = createMastraGatewayRouterModel("openai/gpt-5.5", {
    apiKey: "test-key",
    baseUrl: "https://gateway.example.test/v1",
  });

  expect(model).toBeInstanceOf(Object);
  expect(model.gatewayId).toBe("mastra");
  expect(model.provider).toBe("openai");
  expect(model.modelId).toBe("gpt-5.5");
});

test("creates LibSQL storage without eager init", async () => {
  const originalInitDescriptor = Object.getOwnPropertyDescriptor(LibSQLStore.prototype, "init");
  let initCalls = 0;
  LibSQLStore.prototype.init = async function init() {
    initCalls += 1;
  };

  try {
    const storage = await createRuntimeLibSqlStorage({
      id: "test-storage",
      url: `file:${path.join(tmpdir(), `pe-runtime-test-${Date.now()}.db`)}`,
      disableInit: true,
    });

    expect(storage).toBeInstanceOf(LibSQLStore);
    expect(initCalls).toBe(0);
  } finally {
    if (originalInitDescriptor) {
      Object.defineProperty(LibSQLStore.prototype, "init", originalInitDescriptor);
    }
  }
});

test("initializes runtime harness storage unless init is explicitly disabled", async () => {
  const initializedStorage = createInitSpyStorage(false);
  const disabledStorage = createInitSpyStorage(true);

  const initializedRuntime = await createRuntimeHarness({
    config: createStorageInitHarnessConfig(initializedStorage.storage),
  });
  const disabledRuntime = await createRuntimeHarness({
    config: createStorageInitHarnessConfig(disabledStorage.storage),
  });

  expect(initializedStorage.initCalls()).toBe(1);
  expect(disabledStorage.initCalls()).toBe(0);

  await initializedRuntime.close?.();
  await disabledRuntime.close?.();
});

test("merges observational memory model options without conflicting top-level model", () => {
  const defaults = createRuntimeMemoryOptions(undefined);
  expect(defaults.observationalMemory).toEqual(
    expect.objectContaining({ model: expect.any(String) }),
  );

  const withObservationModel = createRuntimeMemoryOptions({
    observationalMemory: { observation: { model: "openai/observer" } },
  });
  expect(withObservationModel.observationalMemory).not.toHaveProperty("model");
  expect(withObservationModel.observationalMemory).toEqual(
    expect.objectContaining({
      observation: expect.objectContaining({ model: "openai/observer" }),
    }),
  );

  const withReflectionModel = createRuntimeMemoryOptions({
    observationalMemory: { reflection: { model: "openai/reflector" } },
  });
  expect(withReflectionModel.observationalMemory).not.toHaveProperty("model");
  expect(withReflectionModel.observationalMemory).toEqual(
    expect.objectContaining({
      reflection: expect.objectContaining({ model: "openai/reflector" }),
    }),
  );

  expect(createRuntimeMemoryOptions({ observationalMemory: false }).observationalMemory).toBe(
    false,
  );
});

test("closes protocol session runtimes during close, delete, and closeAll", async () => {
  const closeCalls: string[] = [];
  const factory: RuntimeFactory = {
    descriptor: createRuntimeDescriptor("test-runtime"),
    create: async () => createTestRuntimeHandle(closeCalls),
  };
  const sessions = new RuntimeProtocolSessions({
    factory,
    idPrefix: "test-session",
    sessionRegistryPath: null,
  });

  const closed = await sessions.createSession({ protocol: "acp" });
  await sessions.close(closed.id);
  expect(closeCalls).toEqual([closed.threadId]);
  expect(sessions.listSessions()).toHaveLength(1);
  expect(() => sessions.getSession(closed.id)).toThrow("Unknown Runtime session");

  const deleted = await sessions.createSession({ protocol: "acp" });
  await sessions.delete(deleted.id);
  expect(closeCalls).toEqual([closed.threadId, deleted.threadId]);
  expect(sessions.listSessions()).toHaveLength(1);

  const first = await sessions.createSession({ protocol: "ag-ui" });
  const second = await sessions.createSession({ protocol: "ag-ui" });
  await sessions.closeAll();
  expect(closeCalls).toEqual([closed.threadId, deleted.threadId, first.threadId, second.threadId]);
  expect(sessions.listSessions()).toHaveLength(3);
});

function createInitSpyStorage(disableInit: boolean): {
  storage: MastraCompositeStore;
  initCalls: () => number;
} {
  let initCalls = 0;
  return {
    storage: {
      disableInit,
      init: () => {
        initCalls += 1;
      },
      close: () => undefined,
    } as unknown as MastraCompositeStore,
    initCalls: () => initCalls,
  };
}

function createStorageInitHarnessConfig(storage: MastraCompositeStore): RuntimeHarnessConfig {
  return {
    id: "storage-init-test",
    storage,
    modes: [
      {
        id: "test",
        agent: (() => ({})) as unknown as RuntimeHarnessConfig["modes"][number]["agent"],
      },
    ],
  };
}

function createTestRuntimeHandle(closeCalls: string[]): RuntimeHandle {
  const threadId = `thread-${closeCalls.length + 1}`;
  return {
    harness: {} as RuntimeHandle["harness"],
    sessions: {
      createThreadSession: async () => ({ threadId, resourceId: `resource-${threadId}` }),
      switchThread: async () => undefined,
      sendMessage: async () => undefined,
      abort: () => undefined,
      subscribe: () => () => undefined,
    },
    close: () => {
      closeCalls.push(threadId);
    },
  };
}
