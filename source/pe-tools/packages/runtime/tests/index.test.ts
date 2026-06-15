import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Agent } from "@mastra/core/agent";
import type { MastraCompositeStore } from "@mastra/core/storage";
import { LibSQLStore } from "@mastra/libsql";
import { expect, test } from "vite-plus/test";
import {
  createMastraGatewayRouterModel,
  createPeaCloudGatewayRuntimeAuthProfile,
  createRuntimeDescriptor,
  createRuntimeFactory,
  createRuntimeHarness,
  defaultMastraCodeApiKeyEnvVars,
  hasMastraCodeStoredAuth,
  loadStoredMastraCodeApiKeysIntoEnv,
  createRuntimeLibSqlStorage,
  createRuntimeMemoryOptions,
  createRuntimeThreadLock,
  isThreadLockError,
  openMostRecentUnlockedRuntimeThread,
  RuntimeProtocolSessions,
  sessionInfo,
  type RuntimeFactory,
  type RuntimeHandle,
  type RuntimeHarnessConfig,
} from "../src/index.ts";

test("exports runtime contracts", () => {
  expect(createRuntimeDescriptor("test-runtime").id).toBe("test-runtime");
});

test("runtime factory opens the most recent unlocked TUI thread during creation", async () => {
  const switchCalls: string[] = [];
  const runtime = createStartupThreadRuntimeHandle({ switchCalls });
  const factory = createRuntimeFactory(
    createRuntimeDescriptor("startup-test"),
    async () => runtime,
  );

  await factory.create({ protocol: "tui" });

  expect(switchCalls).toEqual(["newer"]);
});

test("runtime factory skips locked startup threads and resumes the most recent unlocked thread", async () => {
  const switchCalls: string[] = [];
  const runtime = createStartupThreadRuntimeHandle({
    switchCalls,
    lockedThreadIds: new Set(["newer"]),
  });
  const factory = createRuntimeFactory(
    createRuntimeDescriptor("startup-test"),
    async () => runtime,
  );

  await factory.create({ protocol: "tui" });

  expect(switchCalls).toEqual(["newer", "older-untried"]);
});

test("runtime factory creates a startup thread when every existing thread is locked", async () => {
  const switchCalls: string[] = [];
  const createdThreads: string[] = [];
  const runtime = createStartupThreadRuntimeHandle({
    switchCalls,
    createdThreads,
    lockedThreadIds: new Set(["newer", "older-untried"]),
  });
  const factory = createRuntimeFactory(
    createRuntimeDescriptor("startup-test"),
    async () => runtime,
  );

  await factory.create({ protocol: "tui" });

  expect(switchCalls).toEqual(["newer", "older-untried"]);
  expect(createdThreads).toEqual(["New thread"]);
});

test("runtime factory leaves non-TUI runtime creation on a new thread", async () => {
  const switchCalls: string[] = [];
  const runtime = createStartupThreadRuntimeHandle({ switchCalls });
  const factory = createRuntimeFactory(
    createRuntimeDescriptor("startup-test"),
    async () => runtime,
  );

  await factory.create({ protocol: "acp" });

  expect(switchCalls).toEqual([]);
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

test("runtime harness enables a default thread lock and releases it on close", async () => {
  const originalStateDir = process.env.PE_TOOLS_STATE_DIR;
  const stateDir = path.join(tmpdir(), `pe-runtime-locks-${Date.now()}`);
  mkdirSync(stateDir, { recursive: true });
  process.env.PE_TOOLS_STATE_DIR = stateDir;

  try {
    const storage = await createRuntimeLibSqlStorage({
      id: "thread-lock-storage",
      url: `file:${path.join(stateDir, "thread-lock-test.db")}`,
      disableInit: false,
    });
    const runtime = await createRuntimeHarness({
      config: createThreadLockHarnessConfig(storage),
    });

    const thread = await runtime.harness.createThread({ title: "Lock Test" });
    const lockPath = path.join(
      stateDir,
      "locks",
      `${thread.id.replace(/[^a-zA-Z0-9_-]/g, "_")}.lock`,
    );

    expect(readFileSync(lockPath, "utf8").trim()).toBe(String(process.pid));

    await runtime.close?.();
    expect(existsSync(lockPath)).toBe(false);
  } finally {
    if (originalStateDir == null) delete process.env.PE_TOOLS_STATE_DIR;
    else process.env.PE_TOOLS_STATE_DIR = originalStateDir;
  }
});

test("runtime sessions keep the created thread lock active", async () => {
  const originalStateDir = process.env.PE_TOOLS_STATE_DIR;
  const stateDir = path.join(tmpdir(), `pe-runtime-session-locks-${Date.now()}`);
  mkdirSync(stateDir, { recursive: true });
  process.env.PE_TOOLS_STATE_DIR = stateDir;

  try {
    const storage = await createRuntimeLibSqlStorage({
      id: "session-thread-lock-storage",
      url: `file:${path.join(stateDir, "session-thread-lock-test.db")}`,
      disableInit: false,
    });
    const runtime = await createRuntimeHarness({
      config: createThreadLockHarnessConfig(storage),
    });

    const session = await runtime.sessions.createThreadSession({ title: "Session Lock Test" });
    const lockPath = path.join(
      stateDir,
      "locks",
      `${session.threadId.replace(/[^a-zA-Z0-9_-]/g, "_")}.lock`,
    );

    expect(readFileSync(lockPath, "utf8").trim()).toBe(String(process.pid));

    await runtime.close?.();
    expect(existsSync(lockPath)).toBe(false);
  } finally {
    if (originalStateDir == null) delete process.env.PE_TOOLS_STATE_DIR;
    else process.env.PE_TOOLS_STATE_DIR = originalStateDir;
  }
});

test("runtime harness keeps the lock when switching to the current thread", async () => {
  const originalStateDir = process.env.PE_TOOLS_STATE_DIR;
  const stateDir = path.join(tmpdir(), `pe-runtime-same-thread-locks-${Date.now()}`);
  mkdirSync(stateDir, { recursive: true });
  process.env.PE_TOOLS_STATE_DIR = stateDir;

  try {
    const storage = await createRuntimeLibSqlStorage({
      id: "same-thread-lock-storage",
      url: `file:${path.join(stateDir, "same-thread-lock-test.db")}`,
      disableInit: false,
    });
    const runtime = await createRuntimeHarness({
      config: createThreadLockHarnessConfig(storage),
    });

    const thread = await runtime.harness.createThread({ title: "Same Thread Lock Test" });
    const lockPath = path.join(
      stateDir,
      "locks",
      `${thread.id.replace(/[^a-zA-Z0-9_-]/g, "_")}.lock`,
    );

    await runtime.harness.switchThread({ threadId: thread.id });
    expect(readFileSync(lockPath, "utf8").trim()).toBe(String(process.pid));

    await runtime.close?.();
    expect(existsSync(lockPath)).toBe(false);
  } finally {
    if (originalStateDir == null) delete process.env.PE_TOOLS_STATE_DIR;
    else process.env.PE_TOOLS_STATE_DIR = originalStateDir;
  }
});

test("runtime harness uses the MastraCode lock directory for mastracode-compatible storage", async () => {
  const originalAppData = process.env.APPDATA;
  const appData = path.join(tmpdir(), `pe-runtime-appdata-${Date.now()}`);
  mkdirSync(appData, { recursive: true });
  process.env.APPDATA = appData;

  try {
    const storage = await createRuntimeLibSqlStorage({
      id: "mastracode-lock-storage",
      url: `file:${path.join(appData, "mastracode-lock-test.db")}`,
      disableInit: false,
    });
    const runtime = await createRuntimeHarness({
      config: createThreadLockHarnessConfig(storage),
      storageProfile: {
        id: "mastracode-compatible-test",
        kind: "mastracode-compatible",
        createStore: async () => storage,
      },
    });

    const thread = await runtime.harness.createThread({ title: "MastraCode Lock Test" });
    const lockPath = path.join(
      appData,
      "mastracode",
      "locks",
      `${thread.id.replace(/[^a-zA-Z0-9_-]/g, "_")}.lock`,
    );

    expect(readFileSync(lockPath, "utf8").trim()).toBe(String(process.pid));

    await runtime.close?.();
    expect(existsSync(lockPath)).toBe(false);
  } finally {
    if (originalAppData == null) delete process.env.APPDATA;
    else process.env.APPDATA = originalAppData;
  }
});

test("runtime thread lock allows only one concurrent owner per thread", async () => {
  const originalStateDir = process.env.PE_TOOLS_STATE_DIR;
  const stateDir = path.join(tmpdir(), `pe-runtime-race-locks-${Date.now()}`);
  mkdirSync(stateDir, { recursive: true });
  process.env.PE_TOOLS_STATE_DIR = stateDir;

  const bunPath = resolveBunPath();
  const threadId = `race-thread-${Date.now()}`;
  const startAt = Date.now() + 600;
  const childModuleUrl = new URL("../src/harness/thread-lock.ts", import.meta.url).href;
  const childScript = `
    import { createRuntimeThreadLock, isThreadLockError } from ${JSON.stringify(childModuleUrl)};

    const threadId = process.argv[2];
    const startAt = Number(process.argv[3]);
    while (Date.now() < startAt) {}

    const threadLock = createRuntimeThreadLock();
    try {
      threadLock.acquire(threadId);
      setTimeout(() => {
        threadLock.release(threadId);
        process.exit(0);
      }, 300);
    } catch (error) {
      if (isThreadLockError(error)) process.exit(3);
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  `;

  try {
    const [firstExitCode, secondExitCode] = await Promise.all([
      spawnBunProcess(bunPath, childScript, [threadId, String(startAt)], {
        ...process.env,
        PE_TOOLS_STATE_DIR: stateDir,
      }),
      spawnBunProcess(bunPath, childScript, [threadId, String(startAt)], {
        ...process.env,
        PE_TOOLS_STATE_DIR: stateDir,
      }),
    ]);

    expect([firstExitCode, secondExitCode].sort((left, right) => left - right)).toEqual([0, 3]);
  } finally {
    if (originalStateDir == null) delete process.env.PE_TOOLS_STATE_DIR;
    else process.env.PE_TOOLS_STATE_DIR = originalStateDir;
  }
});

test("thread lock errors are detected after MastraCode compatibility remapping", () => {
  const threadLock = createRuntimeThreadLock();
  const threadId = `compat-thread-${Date.now()}`;
  threadLock.acquire(threadId);

  try {
    expect(() => threadLock.acquire(threadId)).not.toThrow();

    const foreignError = Object.assign(new Error("Thread locked"), {
      name: "ThreadLockError",
      threadId,
      ownerPid: process.pid + 1,
    });
    expect(isThreadLockError(foreignError)).toBe(true);
  } finally {
    threadLock.release(threadId);
  }
});

test("startup thread selection skips locked threads and opens the newest unlocked thread", async () => {
  const switchCalls: string[] = [];
  const result = await openMostRecentUnlockedRuntimeThread({
    listThreads: async () => [
      {
        id: "locked-newest",
        resourceId: "resource",
        title: "Locked",
        createdAt: new Date("2026-06-15T17:00:00.000Z"),
        updatedAt: new Date("2026-06-15T19:00:00.000Z"),
      },
      {
        id: "unlocked-older",
        resourceId: "resource",
        title: "Unlocked",
        createdAt: new Date("2026-06-15T16:00:00.000Z"),
        updatedAt: new Date("2026-06-15T18:00:00.000Z"),
      },
    ],
    switchThread: async ({ threadId }: { threadId: string }) => {
      switchCalls.push(threadId);
      if (threadId === "locked-newest") throw threadLockError(threadId, 12345);
    },
    createThread: async () => {
      throw new Error("createThread should not run when an unlocked thread exists");
    },
    getCurrentThreadId: () => "unlocked-older",
  } as never);

  expect(result).toMatchObject({
    status: "selected",
    threadId: "unlocked-older",
    lockedThreadIds: ["locked-newest"],
  });
  expect(switchCalls).toEqual(["locked-newest", "unlocked-older"]);
});

test("startup thread selection creates a thread when all candidates are locked", async () => {
  const result = await openMostRecentUnlockedRuntimeThread(
    {
      listThreads: async () => [
        {
          id: "locked",
          resourceId: "resource",
          title: "Locked",
          createdAt: new Date("2026-06-15T17:00:00.000Z"),
          updatedAt: new Date("2026-06-15T18:00:00.000Z"),
        },
      ],
      switchThread: async ({ threadId }: { threadId: string }) => {
        throw threadLockError(threadId, 12345);
      },
      createThread: async ({ title }: { title?: string }) => ({
        id: `created:${title}`,
        resourceId: "resource",
        title,
        createdAt: new Date("2026-06-15T19:00:00.000Z"),
        updatedAt: new Date("2026-06-15T19:00:00.000Z"),
      }),
      getCurrentThreadId: () => "created:New thread",
    } as never,
    {
      createTitle: "New thread",
    },
  );

  expect(result).toMatchObject({
    status: "created",
    threadId: "created:New thread",
    lockedThreadIds: ["locked"],
  });
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
  const threads = new Map<string, { threadId: string; resourceId: string; title?: string }>();
  const factory: RuntimeFactory = {
    descriptor: createRuntimeDescriptor("test-runtime"),
    create: async () => createTestRuntimeHandle(closeCalls, threads),
  };
  const sessions = new RuntimeProtocolSessions({
    factory,
  });

  const closed = await sessions.createSession({ protocol: "acp" });
  await sessions.close(closed.id);
  expect(closeCalls).toEqual([closed.threadId]);
  await expect(sessions.listSessions()).resolves.toHaveLength(1);
  expect(() => sessions.getSession(closed.id)).toThrow("Unknown Runtime session");

  const deleted = await sessions.createSession({ protocol: "acp" });
  await sessions.delete(deleted.id);
  expect(closeCalls).toEqual([closed.threadId, deleted.threadId]);
  await expect(sessions.listSessions()).resolves.toHaveLength(1);

  const first = await sessions.createSession({ protocol: "ag-ui" });
  const second = await sessions.createSession({ protocol: "ag-ui" });
  await sessions.closeAll();
  expect(closeCalls).toEqual([closed.threadId, deleted.threadId, first.threadId, second.threadId]);
  await expect(sessions.listSessions()).resolves.toHaveLength(3);
});

test("protocol session resume preserves existing additionalDirectories when omitted", async () => {
  const sessions = new RuntimeProtocolSessions({
    factory: {
      descriptor: createRuntimeDescriptor("test-runtime"),
      create: async () => createTestRuntimeHandle([], new Map()),
    },
  });

  const session = await sessions.createSession({
    protocol: "acp",
    additionalDirectories: ["C:/allowed"],
  });

  const resumed = await sessions.resumeSession(session.id);

  expect(resumed.additionalDirectories).toEqual([path.resolve("C:/allowed")]);
});

test("protocol session derives rehydrated sandboxAllowedPaths without mutating additionalDirectories", async () => {
  const threads = new Map<string, { threadId: string; resourceId: string; title?: string }>();
  const sessions = new RuntimeProtocolSessions({
    factory: {
      descriptor: createRuntimeDescriptor("test-runtime"),
      create: async () =>
        createTestRuntimeHandle([], threads, {
          harnessState: { sandboxAllowedPaths: ["C:/restored"] },
        }),
    },
  });

  const session = await sessions.createSession({ protocol: "acp" });
  await sessions.close(session.id);

  const resumed = await sessions.resumeSession(session.id, { protocol: "acp" });

  expect(resumed.additionalDirectories).toEqual([]);
  expect(sessionInfo(resumed).additionalDirectories).toEqual([path.resolve("C:/restored")]);
});

test("protocol session derives newly granted sandbox paths after a prompt", async () => {
  const threads = new Map<string, { threadId: string; resourceId: string; title?: string }>();
  const harnessState: { sandboxAllowedPaths?: string[] } = {};
  const sessions = new RuntimeProtocolSessions({
    factory: {
      descriptor: createRuntimeDescriptor("test-runtime"),
      create: async () =>
        createTestRuntimeHandle([], threads, {
          harnessState,
          onSendMessage: () => {
            harnessState.sandboxAllowedPaths = ["C:/granted"];
          },
        }),
    },
  });

  const session = await sessions.createSession({ protocol: "acp" });
  await sessions.sendPrompt(session.id, { content: "grant access" });

  const current = sessions.getSession(session.id);
  expect(current.additionalDirectories).toEqual([]);
  expect(sessionInfo(current).additionalDirectories).toEqual([path.resolve("C:/granted")]);
});

test("protocol session fork seeds sandboxAllowedPaths without copying projection directories", async () => {
  const threads = new Map<string, TestRuntimeThread>();
  const harnessStates: Array<{ sandboxAllowedPaths?: string[] }> = [
    { sandboxAllowedPaths: ["C:/source-grant"] },
    {},
  ];
  const sessions = new RuntimeProtocolSessions({
    factory: {
      descriptor: createRuntimeDescriptor("test-runtime"),
      create: async () =>
        createTestRuntimeHandle([], threads, {
          harnessState: harnessStates.shift() ?? {},
        }),
    },
  });

  const source = await sessions.createSession({ protocol: "acp" });
  const forked = await sessions.forkSession(source.id, {
    protocol: "acp",
    cwd: source.cwd,
  });

  expect(forked.additionalDirectories).toEqual([]);
  expect(sessionInfo(forked).additionalDirectories).toEqual([path.resolve("C:/source-grant")]);
});

test("protocol session rehydrate seeds sandboxAllowedPaths from thread metadata", async () => {
  const threads = new Map<string, TestRuntimeThread>();
  const harnessState: { sandboxAllowedPaths?: string[] } = {};
  const sessions = new RuntimeProtocolSessions({
    factory: {
      descriptor: createRuntimeDescriptor("test-runtime"),
      create: async () =>
        createTestRuntimeHandle([], threads, {
          harnessState,
        }),
    },
  });

  const session = await sessions.createSession({ protocol: "acp" });
  threads.set(session.threadId, {
    threadId: session.threadId,
    resourceId: session.resourceId,
    title: session.title,
    metadata: { sandboxAllowedPaths: ["C:/metadata-grant"] },
  });
  await sessions.close(session.id);

  const resumed = await sessions.resumeSession(session.id, { protocol: "acp" });

  expect(resumed.additionalDirectories).toEqual([]);
  expect(sessionInfo(resumed).additionalDirectories).toEqual([path.resolve("C:/metadata-grant")]);
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

function createStartupThreadRuntimeHandle(options: {
  switchCalls: string[];
  createdThreads?: string[];
  lockedThreadIds?: Set<string>;
}): RuntimeHandle {
  let currentThreadId = "";
  return {
    harness: {
      listThreads: async () => [
        {
          id: "older-untried",
          title: "Older",
          updatedAt: new Date("2026-06-15T17:00:00.000Z"),
          metadata: {},
        },
        {
          id: "newer",
          title: "Newer",
          updatedAt: new Date("2026-06-15T18:00:00.000Z"),
          metadata: {},
        },
      ],
      switchThread: async ({ threadId }: { threadId: string }) => {
        options.switchCalls.push(threadId);
        if (options.lockedThreadIds?.has(threadId)) throw threadLockError(threadId, 12345);
        currentThreadId = threadId;
      },
      createThread: async ({ title }: { title?: string } = {}) => {
        options.createdThreads?.push(title ?? "");
        currentThreadId = "created-thread";
        return {
          id: currentThreadId,
          title,
          updatedAt: new Date("2026-06-15T20:00:00.000Z"),
          metadata: {},
        };
      },
      getCurrentThreadId: () => currentThreadId,
    } as RuntimeHandle["harness"],
    sessions: {
      createThreadSession: async () => ({ threadId: "created", resourceId: "resource" }),
      switchThread: async () => undefined,
      sendMessage: async () => undefined,
      abort: () => undefined,
      subscribe: () => () => undefined,
    },
  };
}

function threadLockError(threadId: string, ownerPid: number): Error {
  return Object.assign(new Error(`Thread ${threadId} is locked by ${ownerPid}`), {
    name: "ThreadLockError",
    threadId,
    ownerPid,
  });
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

function createThreadLockHarnessConfig(storage: MastraCompositeStore): RuntimeHarnessConfig {
  return {
    id: "thread-lock-test",
    storage,
    modes: [
      {
        id: "test",
        default: true,
        agent: new Agent({
          name: "test-agent",
          instructions: "You are a test agent.",
          model: { provider: "openai", name: "gpt-4o", toolChoice: "auto" },
        } as any),
      },
    ],
  };
}

function createTestRuntimeHandle(
  closeCalls: string[],
  threads: Map<string, TestRuntimeThread>,
  options: {
    harnessState?: { sandboxAllowedPaths?: string[] };
    onSendMessage?: () => void;
  } = {},
): RuntimeHandle {
  const threadId = `thread-${threads.size + 1}`;
  let createdThreadId: string | undefined;
  return {
    harness: {
      getState: () => options.harnessState ?? {},
      setState: async (updates: Partial<{ sandboxAllowedPaths?: string[] }>) => {
        Object.assign(options.harnessState ?? {}, updates);
      },
    } as RuntimeHandle["harness"],
    sessions: {
      createThreadSession: async (options) => {
        const session = { threadId, resourceId: `resource-${threadId}`, title: options?.title };
        threads.set(threadId, session);
        createdThreadId = threadId;
        return session;
      },
      switchThread: async () => undefined,
      listThreadSessions: async () =>
        Array.from(threads.values()).map((thread) => ({
          ...thread,
          createdAt: new Date(0).toISOString(),
          updatedAt: new Date(0).toISOString(),
        })),
      deleteThreadSession: async (options) => {
        threads.delete(options.threadId);
      },
      getResourceId: () => `resource-${threadId}`,
      sendMessage: async () => {
        options.onSendMessage?.();
      },
      abort: () => undefined,
      subscribe: () => () => undefined,
    },
    close: () => {
      if (createdThreadId) closeCalls.push(createdThreadId);
    },
  };
}

interface TestRuntimeThread {
  threadId: string;
  resourceId: string;
  title?: string;
  metadata?: Record<string, unknown>;
}

function resolveBunPath(): string {
  const installRoot = process.env.BUN_INSTALL;
  if (installRoot) {
    return path.join(installRoot, "bin", process.platform === "win32" ? "bun.exe" : "bun");
  }
  return process.platform === "win32"
    ? path.join(process.env.USERPROFILE ?? "", ".bun", "bin", "bun.exe")
    : "bun";
}

function spawnBunProcess(
  bunPath: string,
  script: string,
  args: string[],
  env: NodeJS.ProcessEnv,
): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(bunPath, ["-e", script, ...args], {
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (signal) {
        reject(new Error(`bun child exited via signal ${signal}`));
        return;
      }
      if (code == null) {
        reject(new Error("bun child exited without a status code"));
        return;
      }
      if (code === 1 && stderr.trim().length > 0) {
        reject(new Error(stderr.trim()));
        return;
      }
      resolve(code);
    });
  });
}
