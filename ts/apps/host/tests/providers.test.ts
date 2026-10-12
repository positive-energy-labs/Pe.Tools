import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import { createServer, type Server } from "node:http";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createProviders } from "../src/harness/providers.ts";
import { productAccessPath, productProvidersPath } from "../src/product-paths.ts";

let root: string;
let previous: string | undefined;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "pe-provider-state-"));
  previous = process.env.LOCALAPPDATA;
  process.env.LOCALAPPDATA = root;
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
