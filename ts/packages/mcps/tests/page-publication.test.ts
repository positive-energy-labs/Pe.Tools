import { afterEach, expect, it, vi } from "vite-plus/test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createPeaMcpServer } from "../src/server.ts";
import { peDo, peRead } from "../src/pea/capability-tools.ts";

const input = {
  kind: "page",
  slug: "flow",
  title: "Flow",
  html: "<!doctype html><title>Flow</title><p>Flow</p>",
};
afterEach(() => vi.unstubAllGlobals());

it("admits the publication arm without changing the key-shaped read/do arms", () => {
  expect(peDo.inputSchema.safeParse(input).success).toBe(true);
  expect(peDo.inputSchema.safeParse({ key: "op:example" }).success).toBe(true);
  expect(peRead.inputSchema.safeParse(input).success).toBe(false);
  expect(peDo.inputSchema.safeParse({ ...input, target: { id: "dev" } }).success).toBe(false);
  expect(peDo.inputSchema.safeParse({ ...input, slug: "../escape" }).success).toBe(false);
});

it("serializes publication as a real MCP PNG block without scope/catalog scans", async () => {
  const capture = {
    mimeType: "image/png",
    data: "cG5n",
    width: 1000,
    height: 600,
    sha256: "a".repeat(64),
    url: `http://host/captures/${"a".repeat(64)}.png`,
  };
  const calls: string[] = [];
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    calls.push(String(url));
    expect(new URL(url).pathname).toBe("/pe/pages/publish");
    expect(JSON.parse(String(init.body))).toEqual(input);
    return Response.json({
      ok: true,
      kind: "page",
      slug: "flow",
      title: "Flow",
      key: "page:@pages/flow",
      openUrl: "http://host/pages/flow/",
      capture,
    });
  });
  const server = await createPeaMcpServer({
    hostBaseUrl: "http://host",
    caller: { kind: "pea", context: "fixture", thread: "thread" },
  });
  const client = new Client({ name: "fixture", version: "1" });
  const [left, right] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(right);
    await client.connect(left);
    const tools = await client.listTools();
    expect(
      tools.tools
        .map((tool) => tool.name)
        .filter((name) => name.startsWith("pe_") || name === "target_set")
        .sort(),
    ).toEqual(["pe_do", "pe_find", "pe_read", "target_set"]);
    expect(tools.tools.find((tool) => tool.name === "pe_do")?.inputSchema.type).toBe("object");
    const result = await client.callTool({ name: "pe_do", arguments: input });
    expect(result.isError).not.toBe(true);
    const content = result.content as Array<{
      type: string;
      text?: string;
      data?: string;
      mimeType?: string;
    }>;
    expect(JSON.parse(content[0]!.text!)).toEqual({
      ok: true,
      kind: "page",
      slug: "flow",
      title: "Flow",
      key: "page:@pages/flow",
      openUrl: "http://host/pages/flow/",
      capture: {
        mimeType: "image/png",
        width: 1000,
        height: 600,
        sha256: capture.sha256,
        url: capture.url,
      },
    });
    expect(content[1]).toEqual({ type: "image", mimeType: "image/png", data: capture.data });
    expect(content).toHaveLength(2);
    expect(calls).toHaveLength(1);
  } finally {
    await client.close();
    await server.close();
  }
});
