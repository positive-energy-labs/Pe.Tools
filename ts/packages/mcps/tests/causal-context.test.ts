import { afterEach, expect, test, vi } from "vite-plus/test";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { peRoutes } from "@pe/agent-contracts/pe-api";
import { createPeaMcpServer } from "../src/server.ts";

afterEach(() => vi.unstubAllGlobals());

test("a delayed MCP invocation keeps its immutable run transport across a later turn", async () => {
  let enter!: () => void;
  let release!: () => void;
  const entered = new Promise<void>((resolve) => {
    enter = resolve;
  });
  const delayed = new Promise<void>((resolve) => {
    release = resolve;
  });
  const headers = { "x-pe-context": "host-run-one" };
  const seen: string[] = [];
  const posted: { path: string; key: unknown }[] = [];
  vi.stubGlobal("fetch", async (url: unknown, init: RequestInit) => {
    seen.push(new Headers(init.headers).get("x-pe-context")!);
    posted.push({
      path: new URL(String(url)).pathname,
      key: JSON.parse(String(init.body)).key,
    });
    return Response.json({ ok: true });
  });
  const old = await createPeaMcpServer({
    hostBaseUrl: "http://causal.test",
    headers,
    beforeTool: async () => {
      enter();
      await delayed;
    },
  });
  const client = new Client({ name: "causal-fixture", version: "1" });
  const [left, right] = InMemoryTransport.createLinkedPair();
  await old.connect(right);
  await client.connect(left);
  try {
    const pending = client.callTool({
      name: "pe_do",
      arguments: {
        kind: "page",
        slug: "test",
        title: "Test",
        html: "<!doctype html><title>Test</title>",
      },
    });
    await entered;
    // A later turn cannot replace a context already bound to this server/invocation.
    headers["x-pe-context"] = "host-run-two";
    release();
    await pending;
    expect(seen).toEqual(["host-run-one"]);
    // A Page is published through the one admission door, where a re-sent tool call is guarded.
    expect(posted).toEqual([{ path: peRoutes["actions.admit"].path, key: "page.publish" }]);
  } finally {
    release();
    await client.close();
    await old.close();
  }
});
