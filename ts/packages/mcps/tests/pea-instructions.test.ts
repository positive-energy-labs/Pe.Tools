import { machineFixture } from "../../agent-contracts/tests/machine-fixture.ts";
import { expect, test, vi } from "vite-plus/test";
import { createHash } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { address, emptyThreadHead, type ThreadHead } from "@pe/agent-contracts";
import { createPeaMcpServer } from "../src/server.ts";
import { bundledPeaSkills } from "../src/pea/skills.ts";
import { peaAgentInstructions } from "../src/pea/instructions.ts";
import { fakeRuntimeHost } from "./runtime-host-fixture.ts";
import { defaultReadImageMaxBytes } from "../src/shared/read-image.ts";
import { peaProductTools } from "../src/pea/index.ts";

test("kernel starts with live discovery and makes Revit orientation conditional", () => {
  for (const door of ["pe_find", "pe_read", "pe_do", "target_set"])
    expect(peaAgentInstructions).toContain(door);
  expect(peaAgentInstructions).toContain("start with pe_find without a query");
  expect(peaAgentInstructions).toContain("Distinguish the thread's selected target");
  expect(peaAgentInstructions).toContain("When discovery shows connected Revit");
  expect(peaAgentInstructions).toContain("capture_view");
  for (const text of [
    "skill:@product/skills/make-page",
    "<kind>:@<manifest-id>/<path>",
    "pe_do",
    "binding",
    "Page action door",
  ])
    expect(peaAgentInstructions).toContain(text);
  expect(peaAgentInstructions).not.toContain("Revit is connected:");
  expect(peaAgentInstructions).not.toMatch(/subagent|forked/i);
});

test("capability doors describe the head grant rather than per-call approval", () => {
  for (const tool of Object.values(peaProductTools))
    expect(tool.description).not.toMatch(/approval-gated/i);
  expect(peaProductTools.pe_do.description).toContain("granted head");
  expect(peaProductTools.target_set.description).toContain("Pea's own");
});

test("one MCP connection discovers session and target changes without startup context", async () => {
  fakeRuntimeHost("http://127.0.0.1:9");
  // A harness child: the host minted its context at spawn, so its own scope answers.
  vi.stubEnv("PE_CONTEXT", "test-context");
  let head: ThreadHead = emptyThreadHead;
  let machine = machineFixture();
  const fetch = vi.fn(async (input: string | URL | Request) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.pathname === "/pe/scope/self") return Response.json({ thread: "t1", ...head });
    if (url.pathname === "/pe/capabilities")
      return Response.json({
        at: new Date().toISOString(),
        machine,
        sources: { catalog: "ok" },
        diagnostics: [],
        capabilities: [],
      });
    throw new Error(`unexpected ${url.pathname}`);
  });
  vi.stubGlobal("fetch", fetch);
  const server = await createPeaMcpServer({ hostBaseUrl: "http://127.0.0.1:9" });
  const client = new Client({ name: "discovery-fixture", version: "1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    expect(client.getInstructions()).toBe(peaAgentInstructions);
    expect(fetch).not.toHaveBeenCalled();
    const discover = async () => {
      const result = await client.callTool({ name: "pe_find", arguments: {} });
      expect(result.isError).not.toBe(true);
      const content = result.content as Array<{ text: string }>;
      return JSON.parse(content[0]!.text);
    };
    expect(await discover()).toMatchObject({ target: null, revision: 0, machine });
    machine = machineFixture([{ session: "s1", documents: null }]);
    expect(await discover()).toMatchObject({ target: null, machine });
    for (const [index, openId] of ["a", "b"].entries()) {
      head = {
        ...head,
        defaultTarget: { kind: "open", ref: { session: "s1", openId } },
        revision: index + 1,
      };
      expect(await discover()).toMatchObject({
        target: head.defaultTarget,
        revision: head.revision,
        defaultDocument: { session: "s1", openId },
        machine,
      });
    }
    machine = machineFixture();
    expect(await discover()).toMatchObject({ target: head.defaultTarget, machine });
    expect(client.getInstructions()).toBe(peaAgentInstructions);
  } finally {
    await client.close();
    await server.close();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  }
});

test("bundled skills are unique, parseable, and carry a trigger", () => {
  const names = bundledPeaSkills.map((skill) => skill.name);
  expect(new Set(names).size).toBe(names.length);
  for (const skill of bundledPeaSkills) {
    const description = /^description:\s*(.+)$/m.exec(skill.content)?.[1] ?? "";
    expect(skill.content.startsWith(`---\nname: ${skill.name}\n`)).toBe(true);
    // gray-matter drops a skill whose description contains `: "` (AGENTS.md footgun).
    expect(description).not.toContain(': "');
    expect(description).toMatch(/\bUse (when|for|after|before|at)\b/);
  }
});

test("capture_view refuses null and named targets before host work and preserves exact open targeting", async () => {
  fakeRuntimeHost("http://127.0.0.1:9");
  // A harness child: the host minted its context at spawn, so its own scope answers.
  vi.stubEnv("PE_CONTEXT", "test-context");
  let head: ThreadHead = emptyThreadHead;
  const paths: string[] = [];
  const image = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  );
  const capturePath = `/captures/${createHash("sha256").update(image).digest("hex")}.png`;
  let returnedCapturePath = capturePath;
  let reportedSize = image.length;
  let imageResponse = () => new Response(image, { headers: { "content-type": "image/png" } });
  vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    paths.push(url.pathname);
    if (url.pathname === "/pe/scope/self") return Response.json({ thread: "capture", ...head });
    if (url.pathname === "/ops")
      return Response.json({
        operations: [{ key: "revit.context.view-image", intent: "Read", needs: "document" }],
      });
    if (url.pathname === capturePath) {
      expect(url.origin).toBe("http://127.0.0.1:9");
      expect(init?.redirect).toBe("error");
      return imageResponse();
    }
    expect(url.pathname).toBe("/call");
    const headers = new Headers(init?.headers);
    expect(headers.get("x-pe-bridge-session-id")).toBe("selected-session");
    expect(headers.get("x-pe-open-document-id")).toBe("selected-open");
    expect(headers.has("x-pe-action-actor")).toBe(false);
    expect(JSON.parse(typeof init?.body === "string" ? init.body : "{}").key).toBe(
      "revit.context.view-image",
    );
    return Response.json(
      { view: { label: "Selected view" }, byteSize: reportedSize, pixelSize: 1500 },
      {
        headers: { "x-pe-capture-id": "capture-1", "x-pe-capture-url": returnedCapturePath },
      },
    );
  });
  const server = await createPeaMcpServer({ hostBaseUrl: "http://127.0.0.1:9" });
  const client = new Client({ name: "capture-fixture", version: "1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    for (const target of [
      null,
      { kind: "named" as const, session: "selected-session", address: address("C:/Models/A.rvt") },
    ]) {
      head = { ...head, defaultTarget: target, revision: head.revision + 1 };
      paths.length = 0;
      const result = await client.callTool({ name: "capture_view", arguments: {} });
      expect(result.isError).toBe(true);
      expect(JSON.stringify(result.content)).toContain("requires an exact selected open document");
      expect(paths).toEqual(["/pe/scope/self"]);
    }
    head = {
      ...head,
      defaultTarget: {
        kind: "open",
        ref: { session: "selected-session", openId: "selected-open" },
      },
      revision: head.revision + 1,
    };
    paths.length = 0;
    const captured = await client.callTool({ name: "capture_view", arguments: {} });
    expect(captured.isError).not.toBe(true);
    const content = captured.content as Array<{
      type: string;
      text?: string;
      data?: string;
      mimeType?: string;
    }>;
    expect(content.map((part) => part.type)).toEqual(["text", "image"]);
    expect(content[0]?.text).toContain(capturePath);
    expect(content[0]?.text).toContain("capture-1");
    expect(content[0]?.text).not.toContain(image.toString("base64"));
    expect(content[1]?.mimeType).toBe("image/png");
    expect(Buffer.from(content[1]?.data ?? "", "base64").equals(image)).toBe(true);
    expect(paths).toEqual(["/pe/scope/self", "/ops", "/call", capturePath]);
    for (const invalid of ["https://foreign.test/image.png", "/captures/../secret.png"]) {
      returnedCapturePath = invalid;
      paths.length = 0;
      const result = await client.callTool({ name: "capture_view", arguments: {} });
      expect(result.isError).toBe(true);
      expect(JSON.stringify(result.content)).toContain("invalid capture URL");
      expect(paths.every((path) => path === "/pe/scope/self" || path === "/call")).toBe(true);
    }
    returnedCapturePath = capturePath;
    reportedSize = defaultReadImageMaxBytes + 1;
    paths.length = 0;
    const oversized = await client.callTool({ name: "capture_view", arguments: {} });
    expect(oversized.isError).toBe(true);
    expect(JSON.stringify(oversized.content)).toContain("5MB limit");
    expect(paths).not.toContain(capturePath);
    reportedSize = image.length;
    for (const response of [
      () => Response.redirect("https://foreign.test/image.png"),
      () => new Response(image, { headers: { "content-type": "text/html" } }),
      () => new Response(new Uint8Array([1]), { headers: { "content-type": "image/png" } }),
    ]) {
      imageResponse = response;
      const result = await client.callTool({ name: "capture_view", arguments: {} });
      expect(result.isError).toBe(true);
      expect(JSON.stringify(result.content)).toContain(capturePath);
      expect((result.content as Array<{ type: string }>).map((part) => part.type)).toEqual([
        "text",
      ]);
    }
    let cancelled = false;
    imageResponse = () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new Uint8Array(defaultReadImageMaxBytes + 1));
          },
          cancel() {
            cancelled = true;
          },
        }),
        { headers: { "content-type": "image/png" } },
      );
    const streamed = await client.callTool({ name: "capture_view", arguments: {} });
    expect(streamed.isError).toBe(true);
    expect(JSON.stringify(streamed.content)).toContain("5MB limit");
    expect(cancelled).toBe(true);
  } finally {
    await client.close();
    await server.close();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  }
});

test("kernel confines diagrams to Pages unless the user asks for one-shot output", () => {
  expect(peaAgentInstructions).toMatch(/use diagram only inside that Page/i);
  expect(peaAgentInstructions).toMatch(/never write mermaid fences/i);
});

test("kernel and bundled skills route visual explanations through a hosted Page", () => {
  expect(peaAgentInstructions).toContain("go in a hosted Pe.Tools Page first");
  expect(peaAgentInstructions).toContain("Use diagram only inside that Page");
  const page = bundledPeaSkills.find((skill) => skill.name === "make-page")?.content ?? "";
  const script =
    bundledPeaSkills.find((skill) => skill.name === "write-revit-csharp-script")?.content ?? "";
  expect(page).toContain("return its openUrl with a short takeaway");
  expect(page).toContain("page:@snowdon-ducts/pages/tour");
  expect(script).toContain("Do not create or register a script without a connected document");
});
