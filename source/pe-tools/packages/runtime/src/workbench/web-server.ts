import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import path from "node:path";
import {
  RuntimeWorkbenchHttpAgent,
  type RuntimeWorkbenchAgentOptions,
  type RuntimeWorkbenchServerInfo,
} from "./agent.ts";
import type { RuntimeHandleServices } from "../runtime.ts";

export interface RuntimeWorkbenchStaticOptions {
  host?: string;
  port?: number;
  staticDir?: string;
  envVar?: string;
  searchRoots?: string[];
}

export interface RuntimeWorkbenchWebOptions<
  TState extends Record<string, unknown> = Record<string, unknown>,
  TServices extends RuntimeHandleServices = RuntimeHandleServices,
> {
  label: string;
  agent: RuntimeWorkbenchAgentOptions<TState, TServices>;
  static?: RuntimeWorkbenchStaticOptions;
}

interface StaticServerHandle {
  url: string;
  close: () => Promise<void>;
}

export async function runRuntimeWorkbenchWeb<
  TState extends Record<string, unknown> = Record<string, unknown>,
  TServices extends RuntimeHandleServices = RuntimeHandleServices,
>(options: RuntimeWorkbenchWebOptions<TState, TServices>): Promise<void> {
  const workbenchAgent = new RuntimeWorkbenchHttpAgent(options.agent);
  const workbenchInfo = await workbenchAgent.start();
  const staticDir = await resolveWorkbenchStaticDir(options.static);
  const staticHandle = staticDir
    ? await startStaticServer(staticDir, options.static ?? {}, workbenchInfo)
    : undefined;

  if (staticHandle) {
    console.log(`${options.label} web workbench: ${staticHandle.url}`);
    console.log(`${options.label} web static: ${staticDir}`);
  } else {
    console.log(
      `${options.label} web workbench: not serving React app; run \`vp run website#build\` or pass \`--static-dir\`.`,
    );
  }
  console.log(`${options.label} workbench run: ${workbenchInfo.workbenchUrl}`);
  console.log(`${options.label} workbench threads: ${workbenchInfo.threadsUrl}`);

  await waitForShutdown(async () => {
    await Promise.all([staticHandle?.close() ?? Promise.resolve(), workbenchAgent.close()]);
  });
}

async function startStaticServer(
  staticDir: string,
  options: RuntimeWorkbenchStaticOptions,
  workbenchInfo: RuntimeWorkbenchServerInfo,
): Promise<StaticServerHandle> {
  const root = path.resolve(staticDir);
  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? 0;
  const server = createServer((request, response) => {
    handleStaticRequest(root, request, response).catch((error) =>
      writeStaticError(response, error),
    );
  });

  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => reject(error);
    server.once("error", onError);
    server.listen(port, host, () => {
      server.off("error", onError);
      resolve();
    });
  });

  const address = server.address();
  const actualPort = typeof address === "object" && address ? address.port : port;
  return {
    url: webUrlWithWorkbenchParams(`http://${host}:${actualPort}/`, workbenchInfo),
    close: () => closeStaticServer(server),
  };
}

async function handleStaticRequest(
  root: string,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405, { Allow: "GET, HEAD" }).end();
    return;
  }

  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  const filePath = await resolveStaticFile(root, url.pathname);
  if (!filePath) {
    response.writeHead(404, { "Content-Type": "text/plain" }).end("Not found");
    return;
  }

  response.writeHead(200, {
    "Content-Type": contentType(filePath),
    "Cache-Control":
      path.basename(filePath) === "index.html" ? "no-cache" : "public, max-age=31536000",
  });
  if (request.method === "HEAD") {
    response.end();
    return;
  }
  createReadStream(filePath).pipe(response);
}

async function resolveStaticFile(root: string, pathname: string): Promise<string | undefined> {
  const decodedPath = decodeURIComponent(pathname);
  const relativePath = decodedPath.replace(/^\/+/, "") || "index.html";
  const candidate = path.resolve(root, relativePath);
  if (!isInside(root, candidate)) return undefined;

  const candidateStat = await stat(candidate).catch(() => undefined);
  if (candidateStat?.isFile()) return candidate;
  if (candidateStat?.isDirectory()) {
    const indexPath = path.join(candidate, "index.html");
    return (await hasIndexHtml(candidate)) ? indexPath : undefined;
  }
  if (path.extname(candidate)) return undefined;

  const indexPath = path.join(root, "index.html");
  return (await hasIndexHtml(root)) ? indexPath : undefined;
}

function webUrlWithWorkbenchParams(
  baseUrl: string,
  workbenchInfo: RuntimeWorkbenchServerInfo,
): string {
  const url = new URL(baseUrl);
  url.searchParams.set("workbench", workbenchInfo.workbenchUrl);
  return url.toString();
}

async function resolveWorkbenchStaticDir(
  options: RuntimeWorkbenchStaticOptions | undefined,
): Promise<string | undefined> {
  const configured =
    options?.staticDir ?? (options?.envVar ? process.env[options.envVar] : undefined);
  if (configured) return path.resolve(configured);

  let current = path.resolve(process.cwd());
  while (true) {
    for (const candidate of staticDirCandidates(current, options)) {
      if (await hasIndexHtml(candidate)) return candidate;
    }

    const parent = path.dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

function staticDirCandidates(
  current: string,
  options: RuntimeWorkbenchStaticOptions | undefined,
): string[] {
  return [
    ...(options?.searchRoots ?? []),
    path.join(current, "apps", "website", "dist"),
    path.join(current, "source", "pe-tools", "apps", "website", "dist"),
  ];
}

async function hasIndexHtml(directory: string): Promise<boolean> {
  const indexStat = await stat(path.join(directory, "index.html")).catch(() => undefined);
  return indexStat?.isFile() ?? false;
}

function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function contentType(filePath: string): string {
  switch (path.extname(filePath)) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".js":
      return "text/javascript; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".json":
      return "application/json; charset=utf-8";
    case ".svg":
      return "image/svg+xml";
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".webp":
      return "image/webp";
    default:
      return "application/octet-stream";
  }
}

function writeStaticError(response: ServerResponse, error: unknown): void {
  if (response.headersSent) {
    response.end();
    return;
  }
  response.writeHead(500, { "Content-Type": "text/plain" });
  response.end(error instanceof Error ? error.message : String(error));
}

async function closeStaticServer(server: ReturnType<typeof createServer>): Promise<void> {
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
