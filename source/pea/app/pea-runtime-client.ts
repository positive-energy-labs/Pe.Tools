import type { PeaJsonValue } from "./pea-runtime-events.js";

export interface PeaRuntimeClientPermissionToolCall {
  toolCallId: string;
  toolName: string;
  title?: string;
  kind?: string;
  input?: PeaJsonValue;
}

export interface PeaRuntimeClientPermissionOption {
  optionId: string;
  name: string;
  kind: "allow_once" | "allow_always" | "reject_once" | "reject_always";
}

export interface PeaRuntimeClientPermissionRequest {
  sessionId: string;
  toolCall: PeaRuntimeClientPermissionToolCall;
  options?: PeaRuntimeClientPermissionOption[];
}

export type PeaRuntimeClientPermissionResponse =
  | { outcome: "cancelled" }
  | { outcome: "selected"; optionId: string };

export function defaultPeaRuntimePermissionOptions(): PeaRuntimeClientPermissionOption[] {
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
