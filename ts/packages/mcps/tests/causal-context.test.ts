import { afterEach, expect, test, vi } from "vite-plus/test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
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
  vi.stubGlobal("fetch", async (_url: unknown, init: RequestInit) => {
    seen.push(new Headers(init.headers).get("x-pe-context")!);
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
  } finally {
    release();
    await client.close();
    await old.close();
  }
});
