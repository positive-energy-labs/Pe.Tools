import { AgentSideConnection, ndJsonStream } from "@agentclientprotocol/sdk";
import { Readable, Writable } from "node:stream";
import { createRuntimeAcpAgent, type RuntimeAcpAgentOptions } from "./adapter.ts";
import type { RuntimeHandleServices } from "../runtime.ts";

export type { RuntimeAcpAgentOptions } from "./adapter.ts";

/** Run the runtime as an ACP agent over stdio (the transport editor clients speak). */
export async function runRuntimeAcpAgent<
  TState extends Record<string, unknown> = Record<string, unknown>,
  TServices extends RuntimeHandleServices = RuntimeHandleServices,
>(options: RuntimeAcpAgentOptions<TState, TServices>): Promise<void> {
  const stream = ndJsonStream(
    Writable.toWeb(process.stdout) as WritableStream<Uint8Array>,
    Readable.toWeb(process.stdin) as ReadableStream<Uint8Array>,
  );
  const connection = new AgentSideConnection(
    (conn) => createRuntimeAcpAgent(conn, options),
    stream,
  );
  await connection.closed;
}
