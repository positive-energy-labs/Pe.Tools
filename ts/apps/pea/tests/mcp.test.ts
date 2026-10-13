import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";
import { withInvocationContext } from "../../../packages/mcps/src/shared/invocation-context.ts";
import { createMcpDoor } from "../../host/src/mcp-route.ts";
import { callerOf } from "../../host/src/control.ts";

type Reply = {
  id: number;
  result?: {
    instructions?: string;
    tools?: { name: string }[];
    content?: { text: string }[];
    isError?: boolean;
  };
  error?: unknown;
};

test("pea mcp initializes, lists tools and reads its explicit host with no stdout banner", async () => {
  const paths: string[] = [];
  let url = "";
  // The host's real /mcp door: external stdio negotiates initialize through it, so the fixture does too.
  const door = createMcpDoor(() => url);
  const host = createServer((request, response) => {
    void (async () => {
      paths.push(request.url!);
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const body = Buffer.concat(chunks).toString();
      const headers = Object.fromEntries(
        Object.entries(request.headers).map(([key, value]) => [
          key,
          Array.isArray(value) ? value.join(",") : (value ?? ""),
        ]),
      );
      const path = new URL(request.url!, url).pathname;
      if (path === "/mcp") {
        const identity = callerOf({ kind: "local" }, headers);
        if ("refusal" in identity) return Response.json(identity, { status: 403 });
        return withInvocationContext(
          { principal: { kind: "local" }, caller: identity.caller, headers: {} },
          () =>
            door.fetch(
              new Request(new URL(request.url!, url), {
                method: request.method,
                headers,
                ...(body ? { body } : {}),
              }),
            ),
        );
      }
      return Response.json({
        at: "2026-10-08T00:00:00Z",
        sessions: [],
        sources: { catalog: "ok" },
        capabilities: [],
      });
    })()
      .then(async (reply) => {
        response.writeHead(reply.status, Object.fromEntries(reply.headers));
        response.end(Buffer.from(await reply.arrayBuffer()));
      })
      .catch((error) => {
        response.writeHead(500);
        response.end(String(error));
      });
  });
  host.listen(0, "127.0.0.1");
  await once(host, "listening");
  url = `http://127.0.0.1:${(host.address() as AddressInfo).port}`;
  const workspace = join(import.meta.dirname, "../../..");
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PE_TOOLS_HOST_BASE_URL: "http://127.0.0.1:9",
  };
  delete env.PE_CONTEXT;
  const child = spawn(
    process.execPath,
    [
      join(workspace, "node_modules/jiti/lib/jiti-cli.mjs"),
      join(workspace, "apps/pea/src/main.ts"),
      "mcp",
      "--host",
      url,
    ],
    { env, windowsHide: true, stdio: "pipe" },
  );
  const exited = once(child, "exit");
  const replies: Reply[] = [];
  const invalid: string[] = [];
  let buffered = "";
  let stderr = "";
  child.stderr.on("data", (chunk) => (stderr += chunk));
  child.stdout.on("data", (chunk) => {
    buffered += chunk;
    let end: number;
    while ((end = buffered.indexOf("\n")) >= 0) {
      const line = buffered.slice(0, end);
      buffered = buffered.slice(end + 1);
      try {
        replies.push(JSON.parse(line) as Reply);
      } catch {
        invalid.push(line);
      }
    }
  });
  const call = async (id: number, method: string, params: object) => {
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    await expect
      .poll(() => replies.find((reply) => reply.id === id), { timeout: 10_000 })
      .toBeDefined();
    const reply = replies.find((item) => item.id === id)!;
    expect(reply.error, stderr).toBeUndefined();
    return reply.result!;
  };
  try {
    const init = await call(1, "initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "pea-stdio-proof", version: "1" },
    });
    expect(init.instructions).toContain("Positive Energy Agent, Pea");
    child.stdin.write(
      `${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`,
    );
    expect((await call(2, "tools/list", {})).tools?.map((tool) => tool.name)).toContain("pe_find");
    const found = await call(3, "tools/call", { name: "pe_find", arguments: {} });
    expect(found.isError).not.toBe(true);
    expect(JSON.parse(found.content![0]!.text).sources).toEqual({ catalog: "ok" });
    const refused = await call(4, "tools/call", {
      name: "pe_read",
      arguments: { key: "op:absent" },
    });
    expect(refused.isError).toBe(true);
    const pathnames = paths.map((path) => new URL(path, url).pathname);
    expect(pathnames).toContain("/mcp");
    expect(pathnames).toContain("/pe/capabilities");
    expect(invalid).toEqual([]);
    expect(buffered).toBe("");
    child.stdin.end();
    await expect.poll(() => child.exitCode, { timeout: 5_000 }).toBe(0);
  } finally {
    if (child.exitCode === null) child.kill();
    await exited;
    await new Promise<void>((resolve) => host.close(() => resolve()));
  }
}, 25_000);
