import type {
  ClientCapabilities,
  PermissionOption,
  RequestPermissionRequest,
  RequestPermissionResponse,
  ToolCallUpdate,
} from "@agentclientprotocol/sdk";
import {
  defaultPeaRuntimePermissionOptions,
  type PeaRuntimeClientPermissionRequest,
  type PeaRuntimeClientPermissionResponse,
} from "../pea-runtime-client.js";
import { toAcpToolKind, toAcpToolTitle } from "./tool-kind.js";

export interface PeaAcpClientTransport {
  requestPermission?(params: RequestPermissionRequest): Promise<RequestPermissionResponse>;
}

export class PeaAcpRuntimeClient {
  constructor(private readonly transport: PeaAcpClientTransport) {}

  configure(_clientCapabilities: ClientCapabilities | undefined): void {}

  async requestPermission(
    request: PeaRuntimeClientPermissionRequest,
  ): Promise<PeaRuntimeClientPermissionResponse> {
    if (!this.transport.requestPermission) return { outcome: "cancelled" };

    const response = await this.transport.requestPermission({
      sessionId: request.sessionId,
      toolCall: toAcpToolCallUpdate(request),
      options: toAcpPermissionOptions(request.options ?? defaultPeaRuntimePermissionOptions()),
    });
    return response.outcome.outcome === "selected"
      ? { outcome: "selected", optionId: response.outcome.optionId }
      : { outcome: "cancelled" };
  }
}

function toAcpToolCallUpdate(request: PeaRuntimeClientPermissionRequest): ToolCallUpdate {
  const title = request.toolCall.title || toAcpToolTitle(request.toolCall.toolName);
  return {
    toolCallId: request.toolCall.toolCallId,
    title,
    kind: toAcpToolKind(request.toolCall.toolName),
    status: "pending",
    rawInput: request.toolCall.input,
  };
}

function toAcpPermissionOptions(
  options: NonNullable<PeaRuntimeClientPermissionRequest["options"]>,
): PermissionOption[] {
  return options.map((option) => ({
    optionId: option.optionId,
    name: option.name,
    kind: option.kind,
  }));
}
