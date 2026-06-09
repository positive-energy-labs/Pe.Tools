import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { AgentSideConnection, type Stream } from "@agentclientprotocol/sdk";
import {
  createPeaLocalTransportAuth,
  type PeaLocalTransportAuth,
} from "../pea-local-transport-auth.js";
import { describePeaRuntimeProtocolStatus } from "../pea-runtime-protocol-status.js";
import { PeaAcpSessionStore } from "./acp-session-store.js";
import {
  PeaAcpAgent,
  type PeaAcpAgentOptions,
  type PeaAcpAgentSessionStore,
} from "./pea-acp-adapter.js";

type JsonRpcId = string | number | null;
type AnyMessage =
  | { jsonrpc: "2.0"; id: JsonRpcId; method: string; params?: unknown }
  | { jsonrpc: "2.0"; method: string; params?: unknown }
  | ({ jsonrpc: "2.0"; id: JsonRpcId } & (
      | { result: unknown }
      | { error: { code: number; message: string; data?: unknown } }
    ));

export interface PeaAcpHttpAgentOptions extends PeaAcpAgentOptions {
  port?: number;
  token?: string;
  host?: string;
  sessionStore?: PeaAcpAgentSessionStore;
}

export interface PeaAcpHttpAgentStartInfo {
  host: string;
  port: number;
  token: string;
  statusUrl: string;
  rpcUrl: string;
  eventsUrl: string;
}

const defaultPort = 43111;
const defaultHost = "127.0.0.1";

export async function runPeaAcpHttpAgent(options: PeaAcpHttpAgentOptions): Promise<void> {
  const agent = new PeaAcpHttpAgent(options);
  const info = await agent.start();
  console.log(`Pea ACP HTTP (${options.runtime}) listening at http://${info.host}:${info.port}`);
  console.log(`ACP HTTP token: ${info.token}`);
  console.log(`Status: ${info.statusUrl}`);
  console.log(`RPC: ${info.rpcUrl}`);
  console.log(`Events: ${info.eventsUrl}`);
}

export class PeaAcpHttpAgent {
  private readonly host: string;
  private readonly auth: PeaLocalTransportAuth;
  private readonly incoming: ReadableStream<AnyMessage>;
  private readonly clients = new Set<ServerResponse>();
  private readonly eventHistory: AnyMessage[] = [];
  private server: Server | null = null;
  private incomingController: ReadableStreamDefaultController<AnyMessage> | null = null;
  private connection: AgentSideConnection;
  private sessionStore: PeaAcpAgentSessionStore | null = null;

  constructor(private readonly options: PeaAcpHttpAgentOptions) {
    this.host = options.host ?? defaultHost;
    this.auth = createPeaLocalTransportAuth({
      token: options.token,
      headerNames: ["x-pea-acp-token"],
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
      this.sessionStore = options.sessionStore ?? new PeaAcpSessionStore(conn, options);
      return new PeaAcpAgent(options, this.sessionStore);
    }, stream);
  }

  async start(): Promise<PeaAcpHttpAgentStartInfo> {
    if (this.server) throw new Error("Pea ACP HTTP agent is already running.");

    this.server = createServer((request, response) => {
      this.handle(request, response).catch((error) => this.writeError(response, error));
    });

    const requestedPort = this.options.port ?? defaultPort;
    await new Promise<void>((resolve) => this.server!.listen(requestedPort, this.host, resolve));
    const address = this.server.address();
    const port = typeof address === "object" && address ? address.port : requestedPort;
    return this.startInfo(port);
  }

  async close(): Promise<void> {
    this.incomingController?.close();
    for (const client of this.clients) client.end();
    this.clients.clear();
    this.sessionStore?.closeAll?.();
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
        describePeaRuntimeProtocolStatus({
          runtimeId: this.options.runtime,
          protocol: "acp",
          transport: "http+sse",
          authSource: this.options.authSource,
          allowOauthBetaAuth: this.options.allowOauthBetaAuth,
          sessions: this.sessionStore?.list().length ?? 0,
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

  private startInfo(port: number): PeaAcpHttpAgentStartInfo {
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
    response.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
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
    "authorization, content-type, x-pea-acp-token",
  );
  response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
}
