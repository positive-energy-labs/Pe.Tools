import { Readable, Writable } from "node:stream";
import { AgentSideConnection, ndJsonStream } from "@agentclientprotocol/sdk";
import type {
  AgentController,
  AgentControllerMode,
  Session,
} from "@mastra/core/agent-controller";
import { MastraCodeAcpAgent } from "mastracode/acp";

export interface RunRuntimeAcpAgentOptions {
  controller: AgentController;
  session: Session;
  modes: AgentControllerMode[];
  cleanup?: () => Promise<void> | void;
}

export async function runRuntimeAcpAgent(options: RunRuntimeAcpAgentOptions): Promise<void> {
  const originalConsoleLog = console.log;
  let agent: MastraCodeAcpAgent | undefined;

  console.log = (...args) => {
    process.stderr.write(`${args.map(String).join(" ")}\n`);
  };

  try {
    const stream = ndJsonStream(Writable.toWeb(process.stdout), Readable.toWeb(process.stdin));
    const connection = new AgentSideConnection((conn) => {
      agent = new MastraCodeAcpAgent(conn, options.controller, options.session, options.modes);
      return agent;
    }, stream);

    await connection.closed;
  } finally {
    agent?.dispose();
    console.log = originalConsoleLog;
    await options.cleanup?.();
  }
}
