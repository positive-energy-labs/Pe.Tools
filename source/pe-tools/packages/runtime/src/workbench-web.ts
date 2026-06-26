import { once } from "node:events";
import fs from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import path from "node:path";
import { createRuntimeLocalTransportAuth, type RuntimeLocalTransportAuth } from "./transport.ts";
import { createWorkbenchKernel, type WorkbenchKernel } from "./workbench/kernel.ts";
import {
  errorMessage,
  readAccessLevel,
  readArray,
  readRecord,
  readString,
} from "./workbench/shared.ts";
import type {
  RuntimeWorkbenchHandle,
  WorkbenchContext,
  WorkbenchRunAttachment,
} from "./workbench/types.ts";

export { nextForkTitle } from "./workbench/kernel.ts";

export interface RuntimeWorkbenchWebOptions<TRuntimeOptions = unknown> {
  label: string;
  title?: string;
  createRuntime: (options: TRuntimeOptions) => Promise<unknown>;
  runtimeOptions?: TRuntimeOptions;
  host?: string;
  port?: number;
  staticDir?: string;
  workbenchPort?: number;
  workbenchToken?: string;
}

function requireRuntimeWorkbenchHandle(value: unknown): RuntimeWorkbenchHandle {
  const runtime = readRecord(value);
  const harness = readRecord(runtime.harness);
  if (
    typeof harness.listAvailableModels !== "function" ||
    typeof harness.listModes !== "function"
  ) {
    throw new Error("Runtime workbench web requires a harness with model and mode listing.");
  }
  return value as RuntimeWorkbenchHandle;
}

export async function runRuntimeWorkbenchWeb<TRuntimeOptions = unknown>(
  options: RuntimeWorkbenchWebOptions<TRuntimeOptions>,
): Promise<void> {
  const runtime = requireRuntimeWorkbenchHandle(
    await options.createRuntime((options.runtimeOptions ?? {}) as TRuntimeOptions),
  );
  const session = runtime.session;
  if (!session) throw new Error(`Expected ${options.label} runtime session.`);

  const label = options.label;
  const title = options.title ?? label;
  const host = options.host ?? "127.0.0.1";
  const workbenchPort = options.workbenchPort ?? 43112;
  const auth = createRuntimeLocalTransportAuth({
    token: options.workbenchToken ?? process.env.PE_WORKBENCH_DEV_TOKEN ?? "dev-loopback",
    headerNames: ["x-runtime-workbench-token", "x-runtime-local-token", "x-pea-local-token"],
  });
  const context: WorkbenchContext = { label, title, runtime, session };
  const kernel = createWorkbenchKernel(context);
  const workbenchServer = createServer(
    (request, response) => void handleWorkbenchRequest(context, kernel, auth, request, response),
  );
  await listen(workbenchServer, host, workbenchPort);
  const workbenchUrl = `http://${host}:${addressPort(workbenchServer)}?token=${encodeURIComponent(auth.token)}`;

  let appServer: ReturnType<typeof createServer> | undefined;
  let appUrl: string | undefined;
  if (options.staticDir) {
    appServer = createServer(
      (request, response) =>
        void handleStaticRequest(options.staticDir!, workbenchUrl, request, response),
    );
    await listen(appServer, host, options.port ?? 0);
    appUrl = `http://${host}:${addressPort(appServer)}?workbench=${encodeURIComponent(workbenchUrl)}`;
  }

  console.log(`${label} workbench API ${workbenchUrl}`);
  if (appUrl) console.log(`${label} website ${appUrl}`);

  await waitForShutdown(async () => {
    await Promise.all([
      appServer ? closeHttpServer(appServer) : Promise.resolve(),
      closeHttpServer(workbenchServer),
      runtime.close?.() ?? Promise.resolve(),
    ]);
  });
}

async function handleWorkbenchRequest(
  context: WorkbenchContext,
  kernel: WorkbenchKernel,
  auth: RuntimeLocalTransportAuth,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  setCors(response);
  if (request.method === "OPTIONS") {
    response.writeHead(204).end();
    return;
  }
  if (!url.pathname.startsWith("/workbench")) {
    sendJson(response, 404, { error: "Not found" });
    return;
  }
  if (!auth.isAuthorized(request, url)) {
    sendJson(response, 401, { error: "Unauthorized" });
    return;
  }

  try {
    if (request.method === "GET" && url.pathname === "/workbench/threads") {
      sendJson(response, 200, { threads: await kernel.listThreads() });
      return;
    }
    if (request.method === "POST" && url.pathname === "/workbench/threads") {
      sendJson(response, 200, await kernel.createThread());
      return;
    }
    if (request.method === "GET" && url.pathname === "/workbench/state") {
      const threadId = url.searchParams.get("threadId") ?? context.session.thread.getId();
      if (!threadId) throw new Error("No active thread.");
      sendJson(response, 200, { state: await kernel.getState(threadId) });
      return;
    }
    if (request.method === "GET" && url.pathname === "/workbench/tool") {
      const threadId = url.searchParams.get("threadId") ?? context.session.thread.getId();
      const id = url.searchParams.get("id");
      if (!id) throw new Error("Missing tool id.");
      const started = Date.now();
      const tool = await kernel.getToolIo({ threadId: threadId ?? undefined, toolCallId: id });
      console.log(`[TOOLIO] id=${id} ms=${Date.now() - started}`);
      sendJson(response, 200, { tool });
      return;
    }
    if (request.method === "GET" && url.pathname === "/workbench/hydrate") {
      const threadId = url.searchParams.get("threadId") ?? context.session.thread.getId();
      if (!threadId) throw new Error("No active thread.");
      sendJson(response, 200, { state: await kernel.getState(threadId) });
      return;
    }
    if (request.method === "POST" && url.pathname === "/workbench/run") {
      await handleRun(context, kernel, request, response);
      return;
    }
    if (request.method === "POST" && url.pathname === "/workbench/approve") {
      const body = await readJsonBody(request);
      sendJson(response, 200, {
        state: await kernel.resolveApproval({
          threadId: readString(body.threadId) ?? context.session.thread.getId() ?? undefined,
          requestId: readString(body.requestId),
          optionId: readString(body.optionId),
        }),
      });
      return;
    }
    if (request.method === "POST" && url.pathname === "/workbench/model") {
      const body = await readJsonBody(request);
      sendJson(response, 200, {
        state: await kernel.setModel({
          threadId: readString(body.threadId),
          modelId: readString(body.modelId),
        }),
      });
      return;
    }
    if (request.method === "POST" && url.pathname === "/workbench/access") {
      const body = await readJsonBody(request);
      sendJson(response, 200, {
        state: await kernel.setAccessLevel({
          threadId: readString(body.threadId),
          accessLevel: readAccessLevel(body.accessLevel),
        }),
      });
      return;
    }
    if (request.method === "POST" && url.pathname === "/workbench/fork") {
      const body = await readJsonBody(request);
      const sourceThreadId = readString(body.threadId) ?? context.session.thread.getId();
      if (!sourceThreadId) throw new Error("No thread to fork.");
      sendJson(
        response,
        200,
        await kernel.forkThread({
          threadId: sourceThreadId,
          messageId: readString(body.messageId),
        }),
      );
      return;
    }
    const deleteMatch = /^\/workbench\/threads\/([^/]+)$/.exec(url.pathname);
    if (request.method === "DELETE" && deleteMatch) {
      await kernel.deleteThread(decodeURIComponent(deleteMatch[1]!));
      sendJson(response, 200, { ok: true });
      return;
    }
    sendJson(response, 404, { error: "Not found" });
  } catch (error) {
    sendJson(response, 500, { error: errorMessage(error) });
  }
}

async function handleRun(
  context: WorkbenchContext,
  kernel: WorkbenchKernel,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const body = await readJsonBody(request);
  const threadId = readString(body.threadId) ?? context.session.thread.getId();
  if (!threadId) throw new Error("Missing threadId.");

  const drainAbort = new AbortController();
  response.on("close", () => drainAbort.abort());
  writeSseHeaders(response);

  let frame = 0;
  let peak = 0;
  await kernel.run({
    threadId,
    text: readString(body.text) ?? "",
    clientId: readString(body.clientId) ?? "unknown",
    attachments: readAttachments(readArray(body.attachments)),
    signal: drainAbort.signal,
    emit: async (payload) => {
      if (response.destroyed || response.writableEnded) return;
      const json = JSON.stringify(payload);
      const flushed = response.write(`data: ${json}\n\n`);
      frame++;
      const buffered = response.writableLength;
      if (buffered > peak) peak = buffered;
      console.log(
        `[FRAME] #${frame} bytes=${json.length} (${(json.length / 1e6).toFixed(2)}MB) buffered=${(buffered / 1e6).toFixed(2)}MB peak=${(peak / 1e6).toFixed(2)}MB`,
      );
      if (!flushed) {
        await once(response, "drain", { signal: drainAbort.signal }).catch(() => undefined);
      }
    },
  });

  if (!response.destroyed && !response.writableEnded) response.end();
}

function readAttachments(value: unknown[] | undefined): WorkbenchRunAttachment[] | undefined {
  const files = (value ?? []).flatMap((entry) => {
    const record = readRecord(entry);
    const data = readString(record.data) ?? readString(record.text);
    if (!data) return [];
    return [
      {
        data,
        mediaType: readString(record.mimeType) ?? "text/plain",
        ...(readString(record.name) ? { filename: readString(record.name) } : {}),
      },
    ];
  });
  return files.length > 0 ? files : undefined;
}

async function handleStaticRequest(
  staticDir: string,
  workbenchUrl: string,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  const pathname = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
  const filePath = path.resolve(staticDir, `.${pathname}`);
  const root = path.resolve(staticDir);
  if (!filePath.startsWith(root)) {
    response.writeHead(403).end("Forbidden");
    return;
  }
  try {
    let body = await fs.readFile(filePath);
    if (pathname.endsWith("index.html")) {
      const text = body
        .toString("utf8")
        .replace(
          "</head>",
          `<script>window.__PE_WORKBENCH_URL__=${JSON.stringify(workbenchUrl)}</script></head>`,
        );
      body = Buffer.from(text);
    }
    response.writeHead(200, { "Content-Type": contentType(filePath) });
    response.end(body);
  } catch {
    response.writeHead(404).end("Not found");
  }
}

function writeSseHeaders(response: ServerResponse): void {
  setCors(response);
  response.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
}

function sendJson(response: ServerResponse, status: number, payload: unknown): void {
  setCors(response);
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(payload));
}

function setCors(response: ServerResponse): void {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader(
    "Access-Control-Allow-Headers",
    "content-type, authorization, x-runtime-workbench-token, x-runtime-local-token, x-pea-local-token",
  );
  response.setHeader("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS");
}

async function readJsonBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of request)
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  const text = Buffer.concat(chunks).toString("utf8").trim();
  if (!text) return {};
  const parsed = JSON.parse(text) as unknown;
  return readRecord(parsed);
}

function listen(
  server: ReturnType<typeof createServer>,
  host: string,
  port: number,
): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolve();
    });
  });
}

function addressPort(server: ReturnType<typeof createServer>): number {
  const address = server.address();
  if (address && typeof address === "object") return address.port;
  throw new Error("Server did not expose a TCP address.");
}

function contentType(filePath: string): string {
  if (filePath.endsWith(".html")) return "text/html; charset=utf-8";
  if (filePath.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (filePath.endsWith(".css")) return "text/css; charset=utf-8";
  if (filePath.endsWith(".svg")) return "image/svg+xml";
  if (filePath.endsWith(".png")) return "image/png";
  return "application/octet-stream";
}

async function closeHttpServer(server: ReturnType<typeof createServer>): Promise<void> {
  server.closeIdleConnections?.();
  const closed = new Promise<void>((resolve) => server.close(() => resolve()));
  const timeout = new Promise<void>((resolve) =>
    setTimeout(() => {
      server.closeAllConnections?.();
      resolve();
    }, 1_000),
  );
  await Promise.race([closed, timeout]);
}

async function waitForShutdown(close: () => Promise<void>): Promise<void> {
  let closing = false;
  await new Promise<void>((resolve) => {
    const shutdown = () => {
      if (closing) return;
      closing = true;
      void close().finally(resolve);
    };
    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
  });
}
