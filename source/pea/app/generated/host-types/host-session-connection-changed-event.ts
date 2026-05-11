/**
 * This is a TypeGen auto-generated file.
 * Any changes made to this file can be lost when this file is regenerated.
 */

import type { HostSessionConnectionChangeReason } from "./host-session-connection-change-reason.js";

export interface HostSessionConnectionChangedEvent {
  reason: HostSessionConnectionChangeReason;
  bridgeIsConnected: boolean;
  sessionId?: string;
  processId?: number;
  revitVersion?: string;
  runtimeFramework?: string;
  openDocumentCount: number;
  disconnectReason?: string;
}
