import type {
  RuntimeAgUiAgentOptions,
  RuntimeAgUiTransportOptions,
} from "./agent.ts";
import { RuntimeAgUiHttpAgent } from "./agent.ts";

export interface RuntimeAgUiCliOptions extends RuntimeAgUiAgentOptions {
  transport?: RuntimeAgUiTransportOptions;
}

export interface ParsedRuntimeAgUiCliOptions {
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
export const argsAgui = {
  agUiPort: {
    type: "string",
    description:
      "Port for native AG-UI HTTP/SSE transport. Defaults to 43112; use 0 for an ephemeral port.",
  },
  agUiToken: {
    type: "string",
    description:
      "Bearer/query token for native AG-UI HTTP/SSE transport. Defaults to no token for local development.",
  },
  modelId: {
    type: "string",
    description: "Optional model id to force for the AG-UI-backed runtime.",
  },
} as const;

export async function runRuntimeAgUiFromCli(
  options: RuntimeAgUiCliOptions,
): Promise<void> {
  const { port, token, transport, ...agentOptions } = options;
  const localTransport = {
    ...transport,
    port: transport?.port ?? port,
    token: transport?.token ?? token,
  };
  const agent = new RuntimeAgUiHttpAgent({
    ...agentOptions,
    transport: localTransport,
  });
  const info = await agent.start();
  console.log(
    `AG-UI (${runtimeDescriptorId(options)}) listening at ${info.runUrl}`,
  );
  if (info.token) console.log(`AG-UI token: ${info.token}`);
  await new Promise<void>(() => undefined);
}

export function parseAgUiOptions(
  args: string[],
): ParsedRuntimeAgUiCliOptions | null {
  if (args.includes("--help") || args.includes("-h")) return null;
  if (!hasFlag(args, "ag-ui") && !hasFlag(args, "agUi")) return null;

  return {
    port: parseOptionalPort(
      readOption(args, "ag-ui-port") ?? readOption(args, "agUiPort"),
      "AG-UI HTTP port",
    ),
    token: readOption(args, "ag-ui-token") ?? readOption(args, "agUiToken"),
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

function runtimeDescriptorId(options: RuntimeAgUiCliOptions): string {
  const factory = options.runtime?.factory ?? options.factory;
  if (!factory) throw new Error("Runtime AG-UI CLI requires runtime.factory.");
  return (
    options.runtime?.descriptor ??
    options.descriptor ??
    factory.descriptor
  ).id;
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

export type PeaAgUiCliOptions = RuntimeAgUiCliOptions;
export type ParsedPeaAgUiCliOptions = ParsedRuntimeAgUiCliOptions;
export { runRuntimeAgUiFromCli as runPeaAgUiFromCli };
