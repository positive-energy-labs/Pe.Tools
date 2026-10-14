import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import { createServer, type Server } from "node:http";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { cleanHarnessEnv, createProviders } from "../src/harness/providers.ts";
import { productAccessPath, productProvidersPath } from "../src/product-paths.ts";

let root: string;
let previous: string | undefined;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "pe-provider-state-"));
  previous = process.env.LOCALAPPDATA;
  process.env.LOCALAPPDATA = root;
  process.env.PE_TOOLS_PRODUCT_HOME = join(root, "product");
  process.env.PE_HARNESS_ADAPTER_CLAUDE = join(import.meta.dirname, "fake-acp-agent.mjs");
  process.env.FAKE_ACP_LOG = join(root, "acp-children.jsonl");
});
afterEach(async () => {
  vi.useRealTimers();
  delete process.env.PE_HARNESS_ADAPTER_CLAUDE;
  delete process.env.FAKE_ACP_AUTH;
  delete process.env.FAKE_ACP_AUTH_LATE;
  delete process.env.FAKE_ACP_LOG;
  if (previous === undefined) delete process.env.LOCALAPPDATA;
  else process.env.LOCALAPPDATA = previous;
  await rm(root, { recursive: true, force: true });
});
const request = (path: string, method = "GET", body?: unknown) =>
  new Request(`http://host/pe/${path}`, {
    method,
    headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
const add = {
  harness: "claude",
  name: "Synthetic",
  auth: { kind: "endpoint", baseUrl: "https://synthetic.invalid", apiKey: "synthetic-key" },
};

test("an Anthropic credit refusal crosses add as a classified line without model retries", async () => {
  const raw = JSON.stringify({
    type: "error",
    error: {
      type: "invalid_request_error",
      message: "Your credit balance is too low to access the Anthropic API.",
    },
  });
  let calls = 0;
  const server = createServer((req, res) => {
    if (req.url === "/v1/models") {
      res.writeHead(200).end(JSON.stringify({ data: [{ id: "claude-a" }, { id: "claude-b" }] }));
    } else {
      calls++;
      res.writeHead(400).end(raw);
    }
  });
  const baseUrl = await listen(server);
  try {
    const providers = createProviders({ probeOnStart: false });
    const response = await providers.fetch(
      request("providers", "POST", { ...add, auth: { ...add.auth, baseUrl } }),
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      step: "endpoint",
      message: "billing: Out of credit or billing limit reached.",
      failure: {
        kind: "billing",
        message: "billing: Out of credit or billing limit reached.",
        raw,
      },
    });
    expect(calls).toBe(1);
    expect(providers.get("claude-synthetic")).toBeNull();
  } finally {
    await close(server);
  }
});

test("each child gets fresh PATH and a capture failure is visible in provider readiness", async () => {
  let captures = 0;
  let failed = false;
  const providers = createProviders({
    probeOnStart: false,
    shellPath: async () => {
      if (failed) throw new Error("synthetic profile failure");
      return `C:\\capture-${++captures}`;
    },
  });
  const record = providers.get("claude")!;
  for (const capture of [1, 2]) {
    const env = await providers.env(record);
    const pathKey = Object.keys(env).find((key) => key.toUpperCase() === "PATH")!;
    expect(env[pathKey]?.startsWith(`C:\\capture-${capture};`)).toBe(true);
  }
  failed = true;
  await expect(providers.env(record)).rejects.toThrow("synthetic profile failure");
  const response = await providers.fetch(request("providers/claude/probe", "POST", {}));
  expect((await response.json()).readiness).toEqual({
    state: "unknown",
    message: "The probe failed: synthetic profile failure",
  });
});

test("the refusal logged and copied contains neither endpoint key nor URL query nor inherited credentials", async () => {
  const server = createServer((req, res) => {
    if (req.url === "/v1/models")
      res.writeHead(200).end(JSON.stringify({ data: [{ id: "claude-a" }] }));
    else
      res.writeHead(403).end(
        JSON.stringify({
          error: {
            message: "synthetic-key https://endpoint.invalid/v1?private-query inherited-secret",
          },
        }),
      );
  });
  const baseUrl = await listen(server);
  const providers = createProviders({ probeOnStart: false });
  vi.stubEnv("TEST_SECRET", "inherited-secret");
  const logged = vi.spyOn(console, "log").mockImplementation(() => {});
  try {
    await mkdir(dirname(productProvidersPath()), { recursive: true });
    await writeFile(
      productProvidersPath(),
      JSON.stringify({
        providers: [{ ...add, id: "claude-synthetic", auth: { ...add.auth, baseUrl } }],
      }),
    );
    const provider = await (
      await providers.fetch(request("providers/claude-synthetic/probe", "POST"))
    ).json();
    const detail = provider.readiness.detail;
    expect(detail.step).toBe("endpoint");
    expect(detail.failure.raw).toContain("[redacted]");
    const logs = logged.mock.calls.flat().join("\n");
    expect(logs).toContain(JSON.stringify(detail));
    for (const secret of ["synthetic-key", "private-query", "inherited-secret", "TEST_SECRET"])
      expect(logs + JSON.stringify(provider.readiness)).not.toContain(secret);
  } finally {
    logged.mockRestore();
    vi.unstubAllEnvs();
    await providers.close();
    await close(server);
  }
});

test("known auth overrides are removed case-insensitively while login homes and tool paths remain", () => {
  const inherited = {
    openai_api_key: "synthetic",
    ANTHROPIC_AUTH_TOKEN: "synthetic",
    CLAUDE_CODE_USE_BEDROCK: "1",
    CLAUDE_CODE_OAUTH_TOKEN: "synthetic",
    CODEX_CONFIG: "synthetic",
    MODEL_PROVIDER: "foreign",
    DEFAULT_AUTH_REQUEST: "foreign-login",
    PEA_ENDPOINT_API_KEY: "synthetic",
    PATH: "tools",
    CODEX_HOME: "login-home",
    CLAUDE_CONFIG_DIR: "claude-home",
    AWS_PROFILE: "other-tool-account",
    CUSTOM_UNKNOWN_AUTH: "outside-boundary",
  };
  expect(cleanHarnessEnv(inherited)).toEqual({
    PATH: "tools",
    CODEX_HOME: "login-home",
    CLAUDE_CONFIG_DIR: "claude-home",
    AWS_PROFILE: "other-tool-account",
    CUSTOM_UNKNOWN_AUTH: "outside-boundary",
  });
  expect(inherited.openai_api_key).toBe("synthetic");
});

test.each([
  "{broken synthetic-key",
  '{"providers":[{"id":"lost","auth":{"apiKey":"synthetic-key"}}]}',
])(
  "unreadable provider state stays intact and the host still lists subscriptions: %s",
  async (bytes) => {
    const path = productProvidersPath();
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, bytes);
    const providers = createProviders({ probeOnStart: false });
    const list = await providers.fetch(request("providers"));
    expect(list.status).toBe(200);
    expect(await list.json()).toHaveLength(2);
    const refused = await providers.fetch(request("providers", "POST", add));
    expect(refused.status).toBe(409);
    expect(await refused.text()).not.toContain("synthetic-key");
    expect(await readFile(path, "utf8")).toBe(bytes);
  },
);

test("unreadable approvals fail guarded and refuse overwriting the original", async () => {
  const path = productAccessPath();
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, "{broken");
  const providers = createProviders({ probeOnStart: false });
  const current = await providers.fetch(request("access"));
  expect(await current.json()).toMatchObject({ guarded: true, readError: expect.any(String) });
  expect((await providers.fetch(request("access", "PUT", { guarded: false }))).status).toBe(409);
  expect(await readFile(path, "utf8")).toBe("{broken");
});

const listen = async (server: Server) => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server.address() as { port: number }).port}`;
};
const close = (server: Server) => new Promise<void>((resolve) => server.close(() => resolve()));

test("Codex endpoints publish startup config without keys and retain separate stable homes", async () => {
  vi.stubEnv("CODEX_HOME", join(root, "subscription-home"));
  vi.stubEnv("PE_HARNESS_ADAPTER_CODEX", join(import.meta.dirname, "fake-acp-agent.mjs"));
  const server = createServer((_req, res) =>
    res.end(
      JSON.stringify({
        data: [{ id: "gpt-6.1-sol" }],
        output: [{ type: "message", content: [{ type: "output_text", text: "OK" }] }],
      }),
    ),
  );
  const baseUrl = await listen(server);
  const providers = createProviders({ probeOnStart: false });
  try {
    const homes: string[] = [];
    for (const name of ["First", 'Second "quoted"']) {
      const response = await providers.fetch(
        request("providers", "POST", {
          ...add,
          harness: "codex",
          name,
          auth: { ...add.auth, baseUrl },
        }),
      );
      expect(response.status).toBe(200);
      const record = providers.get((await response.json()).id)!;
      const env = await providers.env(record);
      const config = JSON.parse(env.CODEX_CONFIG!);
      const startup = await readFile(join(env.CODEX_HOME!, "config.toml"), "utf8");
      expect(startup).toContain('model_provider = "pea_endpoint"');
      for (const [key, value] of Object.entries(config.model_providers.pea_endpoint))
        expect(startup).toContain(`${key} = ${JSON.stringify(value)}`);
      expect(startup).not.toContain(add.auth.apiKey);
      expect(env.PEA_ENDPOINT_API_KEY).toBe(add.auth.apiKey);
      expect((await providers.env(record)).CODEX_HOME).toBe(env.CODEX_HOME);
      homes.push(env.CODEX_HOME!);
    }
    expect(new Set(homes).size).toBe(2);
    expect((await providers.env(providers.get("codex")!)).CODEX_HOME).toBe(process.env.CODEX_HOME);
    expect(homes).not.toContain(process.env.CODEX_HOME);
  } finally {
    await providers.close();
    await close(server);
    vi.unstubAllEnvs();
  }
});

test("Claude validation rejects redirects before forwarding its synthetic key", async () => {
  const received: unknown[] = [];
  const sink = createServer((req, res) => {
    received.push(req.headers["x-api-key"]);
    res.end("{}");
  });
  const destination = await listen(sink);
  const redirect = createServer((_req, res) =>
    res.writeHead(307, { location: `${destination}/v1/models` }).end(),
  );
  const baseUrl = await listen(redirect);
  try {
    const providers = createProviders({ probeOnStart: false });
    await expect(
      providers.validateModel(
        {
          id: "claude-test",
          harness: "claude",
          name: "test",
          auth: { kind: "endpoint", baseUrl, apiKey: "synthetic-key" },
        },
        "claude-test",
      ),
    ).rejects.toThrow();
    expect(received).toEqual([]);
  } finally {
    await close(redirect);
    await close(sink);
  }
});

test("old readiness remains inspectable without periodic paid inference, and a failed probe replaces it", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  const providers = createProviders({ probeOnStart: false });
  expect((await providers.fetch(request("providers/claude/probe", "POST", {}))).status).toBe(200);
  vi.setSystemTime(Date.now() + 61_000);
  const expired = await providers.fetch(request("providers/claude"));
  const last = await expired.json();
  expect(last.readiness.state).toBe("ready");
  expect(Date.now() - Date.parse(last.probedAt)).toBeGreaterThanOrEqual(61_000);
  for (let i = 0; i < 3; i++) {
    vi.setSystemTime(Date.now() + 61_000);
    expect(
      (await providers.snapshot()).providers.find((item) => item.id === "claude")?.probedAt,
    ).toBe(last.probedAt);
  }
  const children = (await readFile(process.env.FAKE_ACP_LOG!, "utf8")).trim().split("\n");
  expect(children).toHaveLength(1);
  expect(JSON.parse(children[0]!)).toEqual({ pid: expect.any(Number) });
  process.env.FAKE_ACP_AUTH = "none";
  const failed = await providers.fetch(request("providers/claude/probe", "POST", {}));
  expect((await failed.json()).readiness.state).toBe("refused");
});

test("external corruption after a successful read still refuses provider writes", async () => {
  const providers = createProviders({ probeOnStart: false });
  await providers.fetch(request("providers"));
  const path = productProvidersPath();
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, "{broken");
  expect((await providers.fetch(request("providers", "POST", add))).status).toBe(409);
  expect(await readFile(path, "utf8")).toBe("{broken");
});

test("known keys still redact thread output after their provider file becomes unreadable", async () => {
  const path = productProvidersPath();
  await mkdir(dirname(path), { recursive: true });
  await writeFile(
    path,
    JSON.stringify({
      providers: [{ id: "claude-test", harness: "claude", name: "test", auth: add.auth }],
    }),
  );
  const providers = createProviders({ probeOnStart: false });
  expect(providers.keys()).toEqual(["synthetic-key"]);
  await writeFile(path, "{broken");
  expect(providers.keys()).toEqual(["synthetic-key"]);
});

test("a session response before its auth report cannot certify a signed-out subscription as ready", async () => {
  process.env.FAKE_ACP_AUTH = "none";
  process.env.FAKE_ACP_AUTH_LATE = "true";
  const providers = createProviders({ probeOnStart: false });
  const response = await providers.fetch(request("providers/claude/probe", "POST", {}));
  expect((await response.json()).readiness.state).toBe("refused");
});

test("two adds sharing an identity produce one saved key, and failed validation invalidates readiness", async () => {
  let models = 0;
  let failed = false;
  const pending: (() => void)[] = [];
  const server = createServer((req, res) => {
    const send = (body: unknown) =>
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(body));
    if (failed) {
      res.writeHead(503).end("synthetic failure");
      return;
    }
    if (req.url === "/v1/models") {
      pending.push(() => send({ data: [{ id: "claude-test" }] }));
      if (++models >= 2) for (const answer of pending.splice(0)) answer();
    } else send({ content: [{ type: "text", text: "OK" }] });
  });
  const baseUrl = await listen(server);
  try {
    const providers = createProviders({ probeOnStart: false });
    const input = { ...add, auth: { ...add.auth, baseUrl } };
    const responses = await Promise.all([
      providers.fetch(request("providers", "POST", input)),
      providers.fetch(request("providers", "POST", input)),
    ]);
    expect(responses.map((response) => response.status).sort((a, b) => a - b)).toEqual([200, 409]);
    expect(JSON.parse(await readFile(productProvidersPath(), "utf8")).providers).toHaveLength(1);
    const record = providers.get("claude-synthetic")!;
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 61_000);
    await providers.snapshot();
    expect(models).toBe(2);
    await providers.env(record);
    expect(models).toBe(3);
    failed = true;
    await expect(providers.validateModel(record, "claude-test")).rejects.toThrow();
    expect(providers.readiness().find((item) => item.id === record.id)?.readiness.state).toBe(
      "refused",
    );
    expect(providers.models(record.id)).toEqual([]);
  } finally {
    await close(server);
  }
});
