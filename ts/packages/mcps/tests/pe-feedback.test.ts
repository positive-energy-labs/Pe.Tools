import { afterEach, expect, it, vi } from "vite-plus/test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createPeaMcpServer } from "../src/server.ts";
import { peaProductTools } from "../src/pea/index.ts";

afterEach(() => vi.unstubAllGlobals());

const report = { surface: "pe_find", expected: "a row", observed: "nothing" };

it("is a top-level Pea tool with a closed contract and no kind field", () => {
  expect(Object.keys(peaProductTools)).toContain("pe_feedback");
  const schema = peaProductTools.pe_feedback.inputSchema;
  expect(schema.safeParse(report).success).toBe(true);
  expect(schema.safeParse({ ...report, workaround: "w", refs: ["r"] }).success).toBe(true);
  expect(schema.safeParse({ ...report, kind: "bug" }).success).toBe(false);
  expect(schema.safeParse({ ...report, commit: "forged" }).success).toBe(false);
  expect(schema.safeParse({ surface: "x", expected: "y" }).success).toBe(false);
});

it("posts straight to the host and returns the feedbackId, never failing the turn", async () => {
  const calls: string[] = [];
  let reply: () => Response = () =>
    Response.json({ feedbackId: "11111111-1111-4111-8111-111111111111" });
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    calls.push(new URL(url).pathname);
    expect(JSON.parse(String(init.body))).toEqual(report);
    return reply();
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
    expect((await client.listTools()).tools.map((tool) => tool.name)).toContain("pe_feedback");
    const filed = await client.callTool({ name: "pe_feedback", arguments: report });
    expect(filed.isError).not.toBe(true);
    expect(JSON.stringify(filed.content)).toContain("11111111-1111-4111-8111-111111111111");
    reply = () => Response.json({ error: "down" }, { status: 503 });
    const refused = await client.callTool({ name: "pe_feedback", arguments: report });
    expect(JSON.stringify(refused.content)).toContain("keep working");
    expect(calls).toEqual(["/pe/agent-feedback", "/pe/agent-feedback"]);
  } finally {
    await client.close();
    await server.close();
  }
});
