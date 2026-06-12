import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import path from "node:path";
import type { WorkbenchEvent, WorkbenchState } from "@pe/agent-contracts";
import type { WorkbenchController, WorkbenchStateHandler } from "@pe/workbench-core";

export interface WorkbenchTransportController {
  getState(): WorkbenchState;
  subscribe(handler: WorkbenchStateHandler): () => void;
  start(): Promise<unknown>;
  send(text: string): Promise<unknown>;
  refreshThreads(): Promise<unknown>;
  loadThread(threadId: string): Promise<unknown>;
  resolveApproval(requestId: string, optionId?: string): void;
  cancel(): Promise<unknown>;
  setModel(request: { modelId: string }): Promise<unknown>;
  setMode(request: { modeId: string }): Promise<unknown>;
  close?(): Promise<unknown> | void;
}

export interface WorkbenchTransportServerOptions {
  host?: string;
  port?: number;
  staticDir?: string;
  openPath?: string;
}

export interface WorkbenchTransportServerHandle {
  server: Server;
  url: string;
  apiUrl: string;
  close(): Promise<void>;
}

export interface BrowserWorkbenchClientOptions {
  baseUrl?: string;
}

export interface BrowserWorkbenchClient {
  getState(): Promise<WorkbenchState>;
  subscribe(handler: (event: WorkbenchEvent) => void): () => void;
  start(): Promise<WorkbenchState>;
  send(text: string): Promise<WorkbenchState>;
  refreshThreads(): Promise<WorkbenchState>;
  loadThread(threadId: string): Promise<WorkbenchState>;
  resolveApproval(requestId: string, optionId?: string): Promise<WorkbenchState>;
  cancel(): Promise<WorkbenchState>;
  setModel(modelId: string): Promise<WorkbenchState>;
  setMode(modeId: string): Promise<WorkbenchState>;
}

export async function startWorkbenchTransportServer(
  controller: WorkbenchController | WorkbenchTransportController,
  options: WorkbenchTransportServerOptions = {},
): Promise<WorkbenchTransportServerHandle> {
  const clients = new Set<ServerResponse>();
  const unsubscribe = controller.subscribe((_state, event) => {
    const payload = ssePayload("workbench-event", event);
    for (const client of clients) client.write(payload);
  });

  const server = createServer((request, response) => {
    void routeRequest(controller, clients, request, response, options.staticDir);
  });

  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? 0;
  await new Promise<void>((resolve) => server.listen(port, host, resolve));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Workbench transport did not bind to a TCP address.");

  const origin = `http://${host}:${address.port}`;
  return {
    server,
    url: `${origin}${options.openPath ?? "/"}`,
    apiUrl: origin,
    close: async () => {
      unsubscribe();
      for (const client of clients) client.end();
      clients.clear();
      await controller.close?.();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    },
  };
}

export function createBrowserWorkbenchClient(
  options: BrowserWorkbenchClientOptions = {},
): BrowserWorkbenchClient {
  const baseUrl = trimTrailingSlash(options.baseUrl ?? "");
  return {
    getState: () => getState(baseUrl),
    subscribe: (handler) => subscribeToEvents(baseUrl, handler),
    start: () => command(baseUrl, "/api/workbench/commands/start"),
    send: (text) => command(baseUrl, "/api/workbench/commands/send", { text }),
    refreshThreads: () => command(baseUrl, "/api/workbench/commands/threads/refresh"),
    loadThread: (threadId) =>
      command(baseUrl, "/api/workbench/commands/threads/load", { threadId }),
    resolveApproval: (requestId, optionId) =>
      command(baseUrl, "/api/workbench/commands/approvals/resolve", { requestId, optionId }),
    cancel: () => command(baseUrl, "/api/workbench/commands/cancel"),
    setModel: (modelId) => command(baseUrl, "/api/workbench/commands/model", { modelId }),
    setMode: (modeId) => command(baseUrl, "/api/workbench/commands/mode", { modeId }),
  };
}

async function routeRequest(
  controller: WorkbenchTransportController,
  clients: Set<ServerResponse>,
  request: IncomingMessage,
  response: ServerResponse,
  staticDir: string | undefined,
): Promise<void> {
  const url = new URL(request.url ?? "/", "http://localhost");

  if (request.method === "OPTIONS") {
    writeCors(response, 204);
    response.end();
    return;
  }

  try {
    if (request.method === "GET" && url.pathname === "/api/workbench/state") {
      writeJson(response, 200, controller.getState());
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/workbench/events") {
      response.writeHead(200, {
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "Content-Type": "text/event-stream",
      });
      response.write(ssePayload("workbench-state", controller.getState()));
      clients.add(response);
      request.on("close", () => clients.delete(response));
      return;
    }

    if (request.method === "POST") {
      await routeCommand(controller, request, response, url.pathname);
      return;
    }

    if (request.method === "GET" && staticDir) {
      await serveStatic(staticDir, url.pathname, response);
      return;
    }

    writeJson(response, 404, { error: "Not found" });
  } catch (error: unknown) {
    writeJson(response, 500, { error: errorMessage(error) });
  }
}

async function routeCommand(
  controller: WorkbenchTransportController,
  request: IncomingMessage,
  response: ServerResponse,
  pathname: string,
): Promise<void> {
  const body = await readJsonBody(request);
  switch (pathname) {
    case "/api/workbench/commands/start":
      await controller.start();
      break;
    case "/api/workbench/commands/send":
      await controller.send(readString(body.text, "text"));
      break;
    case "/api/workbench/commands/threads/refresh":
      await controller.refreshThreads();
      break;
    case "/api/workbench/commands/threads/load":
      await controller.loadThread(readString(body.threadId, "threadId"));
      break;
    case "/api/workbench/commands/approvals/resolve":
      controller.resolveApproval(
        readString(body.requestId, "requestId"),
        readOptionalString(body.optionId),
      );
      break;
    case "/api/workbench/commands/cancel":
      await controller.cancel();
      break;
    case "/api/workbench/commands/model":
      await controller.setModel({ modelId: readString(body.modelId, "modelId") });
      break;
    case "/api/workbench/commands/mode":
      await controller.setMode({ modeId: readString(body.modeId, "modeId") });
      break;
    default:
      writeJson(response, 404, { error: "Unknown command" });
      return;
  }

  writeJson(response, 200, { ok: true, state: controller.getState() });
}

async function serveStatic(
  staticDir: string,
  pathname: string,
  response: ServerResponse,
): Promise<void> {
  const safePath = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const filePath = path.resolve(staticDir, safePath);
  const root = path.resolve(staticDir);
  if (!filePath.startsWith(root)) {
    writeJson(response, 403, { error: "Forbidden" });
    return;
  }

  const fileStat = await stat(filePath).catch(() => undefined);
  const target = fileStat?.isFile() ? filePath : path.join(root, "index.html");
  const targetStat = await stat(target).catch(() => undefined);
  if (!targetStat?.isFile()) {
    writeJson(response, 404, { error: "Not found" });
    return;
  }

  response.writeHead(200, { "Content-Type": contentType(target) });
  createReadStream(target).pipe(response);
}

async function getState(baseUrl: string): Promise<WorkbenchState> {
  const response = await fetch(`${baseUrl}/api/workbench/state`);
  if (!response.ok) throw new Error(await response.text());
  return (await response.json()) as WorkbenchState;
}

function subscribeToEvents(baseUrl: string, handler: (event: WorkbenchEvent) => void): () => void {
  const source = new EventSource(`${baseUrl}/api/workbench/events`);
  source.addEventListener("workbench-event", (message) => {
    handler(JSON.parse(message.data) as WorkbenchEvent);
  });
  return () => source.close();
}

async function command(baseUrl: string, pathName: string, body?: unknown): Promise<WorkbenchState> {
  const response = await fetch(`${baseUrl}${pathName}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  if (!response.ok) throw new Error(await response.text());
  const payload = (await response.json()) as { state: WorkbenchState };
  return payload.state;
}

function ssePayload(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function writeJson(response: ServerResponse, status: number, value: unknown): void {
  writeCors(response, status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(value));
}

function writeCors(
  response: ServerResponse,
  status: number,
  headers: Record<string, string> = {},
): void {
  response.writeHead(status, {
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Origin": "*",
    ...headers,
  });
}

async function readJsonBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of request)
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  if (!chunks.length) return {};
  const value = JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  if (!isRecord(value)) return {};
  return value;
}

function readString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) throw new Error(`Missing ${field}.`);
  return value;
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function contentType(filePath: string): string {
  const extension = path.extname(filePath);
  if (extension === ".html") return "text/html";
  if (extension === ".js") return "text/javascript";
  if (extension === ".css") return "text/css";
  if (extension === ".json") return "application/json";
  if (extension === ".svg") return "image/svg+xml";
  return "application/octet-stream";
}

function trimTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
