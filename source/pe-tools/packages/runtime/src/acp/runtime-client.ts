import type {
  ClientCapabilities,
  PermissionOption,
  RequestPermissionRequest,
  RequestPermissionResponse,
  ToolCallUpdate,
} from "@agentclientprotocol/sdk";
import {
  defaultRuntimePermissionOptions,
  type RuntimeClientPermissionRequest,
  type RuntimeClientPermissionResponse,
} from "../client.ts";
import { toAcpToolKind, toAcpToolTitle } from "./tool-kind.ts";

export interface RuntimeAcpClientTransport {
  requestPermission?(params: RequestPermissionRequest): Promise<RequestPermissionResponse>;
}

export class RuntimeAcpClient {
  constructor(private readonly transport: RuntimeAcpClientTransport) {}

  configure(_clientCapabilities: ClientCapabilities | undefined): void {}

  async requestPermission(
    request: RuntimeClientPermissionRequest,
  ): Promise<RuntimeClientPermissionResponse> {
    if (!this.transport.requestPermission) return { outcome: "cancelled" };

    const response = await this.transport.requestPermission({
      sessionId: request.sessionId,
      toolCall: toAcpToolCallUpdate(request),
      options: toAcpPermissionOptions(request.options ?? defaultRuntimePermissionOptions()),
    });
    return response.outcome.outcome === "selected"
      ? { outcome: "selected", optionId: response.outcome.optionId }
      : { outcome: "cancelled" };
  }
}

function toAcpToolCallUpdate(request: RuntimeClientPermissionRequest): ToolCallUpdate {
  const tool = request.toolCall.tool;
  return {
    toolCallId: request.toolCall.toolCallId,
    title: tool?.title ?? request.toolCall.title ?? toAcpToolTitle(request.toolCall.toolName, tool),
    kind: toAcpToolKind(request.toolCall.toolName, tool),
    status: "pending",
    rawInput: request.toolCall.input,
  };
}

function toAcpPermissionOptions(
  options: NonNullable<RuntimeClientPermissionRequest["options"]>,
): PermissionOption[] {
  return options.map((option) => ({
    optionId: option.optionId,
    name: option.name,
    kind: option.kind,
  }));
}
