import type { RuntimeJsonValue } from "./events.ts";
import type { RuntimeToolMetadata } from "@pe/agent-contracts";

export interface RuntimeClientPermissionToolCall {
  toolCallId: string;
  toolName: string;
  title?: string;
  kind?: string;
  input?: RuntimeJsonValue;
  tool?: RuntimeToolMetadata;
}

export interface RuntimeClientPermissionOption {
  optionId: string;
  name: string;
  kind: "allow_once" | "allow_always" | "reject_once" | "reject_always";
}

export interface RuntimeClientPermissionRequest {
  sessionId: string;
  toolCall: RuntimeClientPermissionToolCall;
  options?: RuntimeClientPermissionOption[];
}

export type RuntimeClientPermissionResponse =
  | { outcome: "cancelled" }
  | { outcome: "selected"; optionId: string };

export function defaultRuntimePermissionOptions(): RuntimeClientPermissionOption[] {
  return [
    {
      optionId: "allow_once",
      name: "Allow once",
      kind: "allow_once",
    },
    {
      optionId: "reject_once",
      name: "Reject once",
      kind: "reject_once",
    },
  ];
}
