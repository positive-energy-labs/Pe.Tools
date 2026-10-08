import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";

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
  const host = createServer((request, response) => {
    paths.push(request.url!);
    response.setHeader("content-type", "application/json");
    response.end(
      JSON.stringify({
        at: "2026-10-08T00:00:00Z",
        sessions: [],
        sources: { catalog: "ok" },
        capabilities: [],
      }),
    );
  });
  host.listen(0, "127.0.0.1");
  await once(host, "listening");
  const url = `http://127.0.0.1:${(host.address() as AddressInfo).port}`;
  const workspace = join(import.meta.dirname, "../../..");
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PE_TOOLS_HOST_BASE_URL: "http://127.0.0.1:9",
  };
  delete env.PE_THREAD;
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
    expect(paths.length).toBeGreaterThanOrEqual(3);
    expect(paths.every((path) => new URL(path, url).pathname === "/pe/capabilities")).toBe(true);
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
