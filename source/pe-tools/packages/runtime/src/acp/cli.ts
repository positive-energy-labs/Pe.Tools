import type { RuntimeAcpAgentOptions } from "../acp/adapter.ts";
import {
  runRuntimeAcpAgent,
  runRuntimeAcpHttpAgent,
  type RuntimeAcpTransportOptions,
} from "./agent.ts";

export interface RuntimeAcpCliOptions extends RuntimeAcpAgentOptions {
  protocolTransport?: "stdio" | "http";
  transport?: RuntimeAcpTransportOptions;
}

export interface ParsedRuntimeAcpCliOptions {
  transport: "stdio" | "http";
  port?: number;
  token?: string;
  hostBaseUrl?: string;
  workspaceKey?: string;
  workspaceRoot?: string;
  modelId?: string;
  allowOauthBetaAuth?: boolean;
  authSource?: string;
}

// TODO: convert all custom parsing into Gunshii args object. While porting reevaluate the necessity of all options
export const argsAcp = {
  acpTransport: {
    type: "string",
    description: "ACP transport: stdio or http. Defaults to stdio.",
    default: "stdio",
  },
  acpPort: {
    type: "string",
    description:
      "Port for ACP HTTP transport. Defaults to 43111; use 0 for an ephemeral port.",
  },
  acpToken: {
    type: "string",
    description:
      "Bearer/query token for ACP HTTP transport. Defaults to a generated token.",
  },
  modelId: {
    type: "string",
    description: "Optional model id to force for the ACP-backed runtime.",
  },
} as const;

export async function runRuntimeAcpFromCli(
  options: RuntimeAcpCliOptions,
): Promise<void> {
  const {
    protocolTransport,
    acpTransport,
    port,
    token,
    transport,
    ...agentOptions
  } = options;
  const selectedTransport = protocolTransport ?? acpTransport;
  const localTransport = {
    ...transport,
    port: transport?.port ?? port,
    token: transport?.token ?? token,
  };
  if (selectedTransport === "http") {
    await runRuntimeAcpHttpAgent({
      ...agentOptions,
      transport: localTransport,
    });
    return;
  }
  await runRuntimeAcpAgent(agentOptions);
}

export function parseAcpOptions(
  args: string[],
): ParsedRuntimeAcpCliOptions | null {
  if (args.includes("--help") || args.includes("-h")) return null;

  const explicitAcp = hasFlag(args, "acp");
  if (!explicitAcp) return null;

  return {
    transport: parseAcpTransport(
      readOption(args, "acp-transport") ?? readOption(args, "acpTransport"),
    ),
    port: parseOptionalPort(
      readOption(args, "acp-port") ?? readOption(args, "acpPort"),
      "ACP HTTP port",
    ),
    token: readOption(args, "acp-token") ?? readOption(args, "acpToken"),
    hostBaseUrl: readOption(args, "host"),
    workspaceKey: readOption(args, "workspace"),
    workspaceRoot:
      readOption(args, "workspace-root") ?? readOption(args, "workspaceRoot"),
    modelId: readOption(args, "model-id") ?? readOption(args, "modelId"),
    allowOauthBetaAuth:
      hasFlag(args, "allow-oauth-beta-auth") ||
      hasFlag(args, "allowOauthBetaAuth"),
    authSource:
      readOption(args, "auth-source") ?? readOption(args, "authSource"),
  };
}

function parseAcpTransport(value: string | undefined): "stdio" | "http" {
  if (!value) return "stdio";

  switch (normalizeOption(value)) {
    case "stdio":
      return "stdio";
    case "http":
    case "httpsse":
      return "http";
    default:
      throw new Error("Unknown ACP transport. Expected stdio or http.");
  }
}

function normalizeOption(value: string): string {
  return value.toLowerCase().replace(/[-_]/g, "");
}

function parseOptionalPort(
  value: string | number | undefined,
  label: string,
): number | undefined {
  if (value == null || value === "") return undefined;

  const port = typeof value === "number" ? value : Number.parseInt(value, 10);
  if (!Number.isInteger(port) || port < 0 || port > 65535)
    throw new Error(`${label} must be an integer from 0 to 65535.`);
  return port;
}

function readOption(args: string[], name: string): string | undefined {
  const longName = `--${name}`;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === longName) return args[index + 1];
    if (arg?.startsWith(`${longName}=`)) return arg.slice(longName.length + 1);
  }
  return undefined;
}

function hasFlag(args: string[], name: string): boolean {
  return args.includes(`--${name}`);
}

export type PeaAcpCliOptions = RuntimeAcpCliOptions;
export type ParsedPeaAcpCliOptions = ParsedRuntimeAcpCliOptions;
export { runRuntimeAcpFromCli as runPeaAcpFromCli };
