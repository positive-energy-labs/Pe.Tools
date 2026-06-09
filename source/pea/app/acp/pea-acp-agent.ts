import { Readable, Writable } from "node:stream";
import { AgentSideConnection, ndJsonStream } from "@agentclientprotocol/sdk";
import { createPeaAcpAgent, type PeaAcpAgentOptions } from "./pea-acp-adapter.js";

export type { PeaAcpAgentOptions } from "./pea-acp-adapter.js";

export async function runPeaAcpAgent(options: PeaAcpAgentOptions): Promise<void> {
  const input = Readable.toWeb(process.stdin) as ReadableStream<Uint8Array>;
  const output = Writable.toWeb(process.stdout) as WritableStream<Uint8Array>;
  const stream = ndJsonStream(output, input);
  const connection = new AgentSideConnection((conn) => createPeaAcpAgent(conn, options), stream);
  await connection.closed;
}
