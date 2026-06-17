import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { AgentSideConnection, ndJsonStream, type Stream } from "@agentclientprotocol/sdk";
import { createRuntimeLocalTransportAuth, type RuntimeLocalTransportAuth } from "../transport.ts";
import { createRuntimeAuthDescriptor } from "../auth/types.ts";
import { describeRuntimeProtocolStatus } from "../protocol-status.ts";
import { RuntimeAcpSessionStore } from "./acp-session-store.ts";
import {
  createRuntimeAcpAgent,
  RuntimeAcpAgent,
  runtimeAcpFactory,
  runtimeAcpDescriptor,
  runtimeAcpAuthProfile,
  runtimeAcpWorkbenchExtension,
  type RuntimeAcpAgentOptions,
  type RuntimeAcpAgentSessionStore,
} from "./adapter.ts";
import { Readable, Writable } from "node:stream";

export type { RuntimeAcpAgentOptions } from "./adapter.ts";

export async function runRuntimeAcpAgent(options: RuntimeAcpAgentOptions): Promise<void> {
  const input = Readable.toWeb(process.stdin) as ReadableStream<Uint8Array>;
  const output = Writable.toWeb(process.stdout) as WritableStream<Uint8Array>;
  const stream = ndJsonStream(output, input);
  const connection = new AgentSideConnection(
    (conn) => createRuntimeAcpAgent(conn, options),
    stream,
  );
  await connection.closed;
}

type JsonRpcId = string | number | null;
type AnyMessage =
  | { jsonrpc: "2.0"; id: JsonRpcId; method: string; params?: unknown }
  | { jsonrpc: "2.0"; method: string; params?: unknown }
  | ({ jsonrpc: "2.0"; id: JsonRpcId } & (
      | { result: unknown }
      | { error: { code: number; message: string; data?: unknown } }
    ));

export interface RuntimeAcpTransportOptions {
  port?: number;
  token?: string;
  host?: string;
}

export interface RuntimeAcpHttpAgentOptions extends RuntimeAcpAgentOptions {
  transport?: RuntimeAcpTransportOptions;
  sessionStore?: RuntimeAcpAgentSessionStore;
}

export interface RuntimeAcpHttpAgentStartInfo {
  host: string;
  port: number;
  token: string;
  statusUrl: string;
  rpcUrl: string;
  eventsUrl: string;
}

const defaultPort = 43111;
const defaultHost = "127.0.0.1";

function acpTransport(options: RuntimeAcpHttpAgentOptions): RuntimeAcpTransportOptions {
  return options.transport ?? {};
}

export async function runRuntimeAcpHttpAgent(options: RuntimeAcpHttpAgentOptions): Promise<void> {
  const agent = new RuntimeAcpHttpAgent(options);
  const info = await agent.start();
  console.log(
    `ACP HTTP (${runtimeAcpFactory(options).descriptor.id}) listening at http://${info.host}:${info.port}`,
  );
  console.log(`ACP HTTP token: ${info.token}`);
  console.log(`Status: ${info.statusUrl}`);
  console.log(`RPC: ${info.rpcUrl}`);
  console.log(`Events: ${info.eventsUrl}`);
}

export class RuntimeAcpHttpAgent {
  private readonly host: string;
  private readonly auth: RuntimeLocalTransportAuth;
  private readonly incoming: ReadableStream<AnyMessage>;
  private readonly clients = new Set<ServerResponse>();
  private readonly eventHistory: AnyMessage[] = [];
  private server: Server | null = null;
  private incomingController: ReadableStreamDefaultController<AnyMessage> | null = null;
  private connection: AgentSideConnection;
  private sessionStore: RuntimeAcpAgentSessionStore | null = null;

  constructor(private readonly options: RuntimeAcpHttpAgentOptions) {
    this.host = acpTransport(options).host ?? defaultHost;
    this.auth = createRuntimeLocalTransportAuth({
      token: acpTransport(options).token,
      headerNames: ["x-runtime-acp-token", "x-pea-acp-token"],
    });
    this.incoming = new ReadableStream<AnyMessage>({
      start: (controller) => {
        this.incomingController = controller;
      },
    });
    const stream: Stream = {
      readable: this.incoming,
      writable: new WritableStream<AnyMessage>({
        write: async (message) => this.publish(message),
      }),
    };
    this.connection = new AgentSideConnection((conn) => {
      this.sessionStore = options.sessionStore ?? new RuntimeAcpSessionStore(conn, options);
      return new RuntimeAcpAgent(options, this.sessionStore);
    }, stream);
  }

  async start(): Promise<RuntimeAcpHttpAgentStartInfo> {
    if (this.server) throw new Error("ACP HTTP agent is already running.");

    this.server = createServer((request, response) => {
      this.handle(request, response).catch((error) => this.writeError(response, error));
    });

    const requestedPort = acpTransport(this.options).port ?? defaultPort;
    await new Promise<void>((resolve) => this.server!.listen(requestedPort, this.host, resolve));
    const address = this.server.address();
    const port = typeof address === "object" && address ? address.port : requestedPort;
    return this.startInfo(port);
  }

  async close(): Promise<void> {
    this.incomingController?.close();
    for (const client of this.clients) client.end();
    this.clients.clear();
    await this.sessionStore?.closeAll?.();
    const server = this.server;
    this.server = null;
    if (server)
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    await this.connection.closed;
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    addCorsHeaders(response);
    if (request.method === "OPTIONS") {
      response.writeHead(204).end();
      return;
    }

    const url = new URL(request.url ?? "/", `http://${this.host}`);
    if (!this.isAuthorized(request, url)) {
      response.writeHead(401, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: "Missing or invalid ACP HTTP token." }));
      return;
    }

    if (request.method === "GET" && url.pathname === "/status") {
      this.writeJson(
        response,
        describeRuntimeProtocolStatus({
          runtime: runtimeAcpDescriptor(this.options),
          protocol: "acp",
          transport: "http+sse",
          auth:
            runtimeAcpAuthProfile(this.options)?.descriptor ??
            createRuntimeAuthDescriptor({ source: "none", methods: [] }),
          sessions: (await this.sessionStore?.list())?.length ?? 0,
          capabilities: runtimeAcpWorkbenchExtension(this.options).capabilities,
        }),
      );
      return;
    }

    if (request.method === "GET" && url.pathname === "/events") {
      this.handleEvents(response);
      return;
    }

    if (request.method === "POST" && url.pathname === "/rpc") {
      const body = await readJsonBody<AnyMessage>(request);
      this.enqueue(body);
      response.writeHead(202, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ accepted: true }));
      return;
    }

    response.writeHead(404, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ error: "Not found" }));
  }

  private handleEvents(response: ServerResponse): void {
    response.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    response.write(": connected\n\n");
    this.clients.add(response);
    for (const event of this.eventHistory) response.write(`data: ${JSON.stringify(event)}\n\n`);
    response.on("close", () => this.clients.delete(response));
  }

  private enqueue(message: AnyMessage): void {
    if (!isJsonRpcMessage(message)) throw new Error("Expected a JSON-RPC 2.0 message.");
    if (!this.incomingController) throw new Error("ACP HTTP stream is not ready.");
    this.incomingController.enqueue(message);
  }

  private publish(message: AnyMessage): void {
    this.eventHistory.push(message);
    if (this.eventHistory.length > 500) this.eventHistory.shift();

    const text = `data: ${JSON.stringify(message)}\n\n`;
    for (const client of this.clients) client.write(text);
  }

  private isAuthorized(request: IncomingMessage, url: URL): boolean {
    return this.auth.isAuthorized(request, url);
  }

  private startInfo(port: number): RuntimeAcpHttpAgentStartInfo {
    const base = `http://${this.host}:${port}`;
    const query = `token=${encodeURIComponent(this.auth.token)}`;
    return {
      host: this.host,
      port,
      token: this.auth.token,
      statusUrl: `${base}/status?${query}`,
      rpcUrl: `${base}/rpc?${query}`,
      eventsUrl: `${base}/events?${query}`,
    };
  }

  private writeJson(response: ServerResponse, value: unknown): void {
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify(value));
  }

  private writeError(response: ServerResponse, error: unknown): void {
    if (response.headersSent) {
      response.end();
      return;
    }

    response.writeHead(500, { "Content-Type": "application/json" });
    response.end(
      JSON.stringify({
        error: error instanceof Error ? error.message : String(error),
      }),
    );
  }
}

function isJsonRpcMessage(value: unknown): value is AnyMessage {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { jsonrpc?: unknown }).jsonrpc === "2.0"
  );
}

async function readJsonBody<T>(request: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  for await (const chunk of request)
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  if (chunks.length === 0) return {} as T;
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as T;
}

function addCorsHeaders(response: ServerResponse): void {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader(
    "Access-Control-Allow-Headers",
    "authorization, content-type, x-runtime-acp-token, x-pea-acp-token",
  );
  response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
}
