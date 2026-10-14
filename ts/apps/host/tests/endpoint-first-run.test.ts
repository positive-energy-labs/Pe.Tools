import { expect, test, vi } from "vite-plus/test";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createServer } from "node:http";
import { spawnSync } from "node:child_process";
import { PROTOCOL_VERSION } from "@agentclientprotocol/sdk";
import { createProviders } from "../src/harness/providers.ts";
import { adapterCli, openAdapter, stopChild } from "../src/harness/adapter.ts";

// Opt-in real CLI proof. isolated-home owns product state; no user auth/config is read or copied.
// FOOTGUN: codex-acp 2.1.0 checks startup auth before CODEX_CONFIG. On 0.162.1 this test first
// returned "The harness refused the endpoint: Authentication required" without any saved login.
test.skipIf(!process.env.PE_TEST_HARNESS_AUTH)(
  "endpoint works before CLI onboarding or login",
  async () => {
    const harness = process.env.PE_TEST_HARNESS_AUTH === "claude" ? "claude" : "codex";
    const live = process.env.PE_TEST_ENDPOINT_LIVE === "1";
    const apiKey = live ? process.env.OPENAI_API_KEY : "synthetic-first-run-key";
    if (!apiKey || (live && harness !== "codex"))
      throw new Error("Live proof requires an OpenAI key");
    const root = process.env.PE_TOOLS_PRODUCT_HOME!;
    const loginHome = join(root, "empty-login-home");
    mkdirSync(loginHome, { recursive: true });
    vi.stubEnv("CODEX_HOME", loginHome);
    vi.stubEnv("CLAUDE_CONFIG_DIR", loginHome);
    vi.stubEnv("APP_SERVER_LOGS", join(root, "adapter-logs"));
    const cli = adapterCli(harness);
    const version = spawnSync(cli, ["--version"], { encoding: "utf8", env: process.env });
    console.log(`${cli}: ${version.stdout.trim()}`);
    expect(version.status).toBe(0);
    const received: { path: string; authorized: boolean }[] = [];
    const server = createServer((req, res) => {
      received.push({
        path: req.url!,
        authorized:
          req.headers.authorization === `Bearer ${apiKey}` || req.headers["x-api-key"] === apiKey,
      });
      req.resume();
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify(
          req.url?.includes("/count_tokens")
            ? { input_tokens: 1 }
            : req.url?.endsWith("/models")
              ? { data: [{ id: harness === "codex" ? "gpt-6.1-sol" : "claude-sonnet-4-6" }] }
              : {
                  content: [{ type: "text", text: "OK" }],
                  output: [{ type: "message", content: [{ type: "output_text", text: "OK" }] }],
                },
        ),
      );
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const baseUrl = live
      ? "https://api.openai.com/v1"
      : `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    const providers = createProviders({ probeOnStart: false });
    let opened: ReturnType<typeof openAdapter> | undefined;
    try {
      expect(existsSync(join(loginHome, "auth.json"))).toBe(false);
      expect(existsSync(join(loginHome, "config.toml"))).toBe(false);
      const response = await providers.fetch(
        new Request("http://host/pe/providers", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            harness,
            name: "First run",
            auth: { kind: "endpoint", baseUrl, apiKey },
          }),
        }),
      );
      const result = await response.json();
      expect(result, JSON.stringify(result)).toMatchObject({ readiness: { state: "ready" } });
      expect(response.status).toBe(200);
      if (!live) {
        const apiCalls = received.filter((r) => r.path.startsWith("/v1/"));
        expect(
          apiCalls.length > 0 && apiCalls.every((r) => r.authorized),
          JSON.stringify(received),
        ).toBe(true);
      }
      const env = await providers.env(providers.get(result.id)!);
      if (harness === "codex") {
        expect(env.CODEX_HOME).not.toBe(loginHome);
        expect(readFileSync(join(env.CODEX_HOME!, "config.toml"), "utf8").includes(apiKey)).toBe(
          false,
        );
        expect(existsSync(join(env.CODEX_HOME!, "auth.json"))).toBe(false);
      }
      if (live) {
        let text = "";
        opened = openAdapter(harness, root, env, () => ({
          sessionUpdate: async ({ update }) => {
            if (update.sessionUpdate === "agent_message_chunk" && update.content.type === "text")
              text += update.content.text;
          },
          requestPermission: async () => ({ outcome: { outcome: "cancelled" } }),
        }));
        await opened.conn.initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} });
        const session = await opened.conn.newSession({ cwd: root, mcpServers: [] });
        const reply = await opened.conn.prompt({
          sessionId: session.sessionId,
          prompt: [{ type: "text", text: "Reply with only OK. Do not use tools." }],
        });
        expect(reply.stopReason).toBe("end_turn");
        expect(text.trim()).toBe("OK");
        console.log("Real Codex ACP turn: OK; no onboarding or login");
        await stopChild(opened.child);
        opened = openAdapter(harness, root, await providers.env(providers.get(result.id)!), () => ({
          sessionUpdate: async () => {},
          requestPermission: async () => ({ outcome: { outcome: "cancelled" } }),
        }));
        await opened.conn.initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} });
        await opened.conn.resumeSession({
          sessionId: session.sessionId,
          cwd: root,
          mcpServers: [],
        });
        expect(existsSync(join(env.CODEX_HOME!, "auth.json"))).toBe(false);
        console.log("Endpoint session resumed in a new adapter process; auth.json absent");
      }
      expect(existsSync(join(loginHome, "auth.json"))).toBe(false);
      expect(existsSync(join(loginHome, "config.toml"))).toBe(false);
    } finally {
      await stopChild(opened?.child ?? null);
      await providers.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      vi.unstubAllEnvs();
    }
  },
  60_000,
);
