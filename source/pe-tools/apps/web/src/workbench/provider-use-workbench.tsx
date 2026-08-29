import { useContext } from "react";
import {
  type AgentControllerThreadInfo,
  type MastraDBMessage,
  type PlanResume,
} from "@mastra/client-js";
import { peUrl, type WorkbenchEndpointConfig } from "./config";
import { readRecord, readString, shortId, type ChatState, type PeInspect } from "./chat-state";
import { type WorkbenchAttachment } from "./store";
import type {
  MessageFile,
  SessionClient,
  StoredThreadSummary,
  ToolResume,
  WorkbenchContextValue,
} from "./provider-stored-thread-summary";
import { WorkbenchContext } from "./provider-stored-thread-summary";

export function useWorkbench(): WorkbenchContextValue {
  const context = useContext(WorkbenchContext);
  if (!context) throw new Error("useWorkbench must be used inside WorkbenchProvider.");
  return context;
}

export function withoutGate(
  display: ChatState["display"],
  toolCallId: string,
): ChatState["display"] {
  const suspensions = { ...display.pendingSuspensions };
  delete suspensions[toolCallId];
  return {
    ...display,
    pendingApproval:
      display.pendingApproval?.toolCallId === toolCallId ? null : display.pendingApproval,
    pendingSuspensions: suspensions,
  };
}

export async function forkSessionThread(
  session: Pick<SessionClient, "cloneThread">,
  currentThreadId: string,
  gotoThread: (threadId: string) => Promise<void>,
) {
  const clone = await session.cloneThread({ sourceThreadId: currentThreadId });
  await gotoThread(clone.id);
}

export async function deleteSessionThread(
  session: Pick<SessionClient, "deleteThread">,
  currentThreadId: string,
  threadId: string,
  gotoThread: (threadId: string) => Promise<void>,
) {
  if (threadId === currentThreadId) await gotoThread(crypto.randomUUID());
  await session.deleteThread(threadId);
}

export function resumeDataForSuspension(
  toolName: string | undefined,
  suspendPayload: unknown,
  reject: boolean,
): ToolResume {
  const payload = readRecord(suspendPayload);
  if (toolName === "submit_plan") {
    return {
      action: reject ? "rejected" : "approved",
      ...(reject ? { feedback: "Rejected from workbench." } : {}),
      ...copyStrings(payload, ["path", "title", "plan"]),
    };
  }
  if (toolName === "request_access") return reject ? "No" : "Yes";
  if (toolName === "ask_user") {
    if (reject) return "(skipped)";
    const options = readArray(payload?.options)?.map(optionText).filter(Boolean) as
      | string[]
      | undefined;
    const first = options?.[0] ?? "Approved";
    return payload?.selectionMode === "multiple" ? [first] : first;
  }
  return reject ? "Rejected" : "Approved";
}

export async function rejectApproval(
  session: SessionClient,
  approval: { toolCallId: string; toolName: string; suspended: boolean; suspendPayload?: unknown },
): Promise<void> {
  if (approval.suspended) {
    await session.respondToToolSuspension(
      approval.toolCallId,
      resumeDataForSuspension(approval.toolName, approval.suspendPayload, true),
    );
    return;
  }
  await session.approveTool(approval.toolCallId, false);
}

export function toFiles(attachments: WorkbenchAttachment[] | undefined): MessageFile[] | undefined {
  if (!attachments?.length) return undefined;
  const files = attachments.flatMap((attachment) => {
    if (attachment.data) {
      return [
        {
          data: attachment.data,
          mediaType: attachment.mimeType ?? "application/octet-stream",
          ...(attachment.name ? { filename: attachment.name } : {}),
        },
      ];
    }
    if (attachment.text !== undefined) {
      return [
        {
          data: toBase64(attachment.text),
          mediaType: attachment.mimeType ?? "text/plain",
          ...(attachment.name ? { filename: attachment.name } : {}),
        },
      ];
    }
    return [];
  });
  return files.length ? files : undefined;
}

export function optimisticMessage(
  content: string,
  files: MessageFile[] | undefined,
): MastraDBMessage {
  const parts: MastraDBMessage["content"]["parts"] = [];
  if (content) parts.push({ type: "text", text: content });
  for (const file of files ?? []) {
    parts.push({ type: "file", mimeType: file.mediaType, data: file.data });
  }
  return {
    id: `local-user-${Date.now()}`,
    role: "user",
    createdAt: new Date(),
    content: { format: 2, parts },
  };
}

// ponytail: fine for text attachments; chunk the byte loop if multi-MB text ever needs base64ing.
export function toBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function toSummaries(threads: AgentControllerThreadInfo[]): StoredThreadSummary[] {
  return threads
    .map((thread) => ({
      id: thread.id,
      // Empty-string titles (not just null) render as blank rows — fall back to a short id.
      title: thread.title?.trim() || shortId(thread.id),
      updatedAt: thread.updatedAt ?? new Date(0).toISOString(),
    }))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export async function fetchPeInspect(config: WorkbenchEndpointConfig): Promise<PeInspect> {
  const response = await fetch(peUrl(config, "/inspect"), {
    headers: { Accept: "application/json" },
  });
  if (!response.ok) return {};
  return (await response.json().catch(() => ({}))) as PeInspect;
}

export function readArray(value: unknown): unknown[] | undefined {
  return Array.isArray(value) ? value : undefined;
}

export function optionText(value: unknown): string {
  return readString(value) ?? readString(readRecord(value)?.label) ?? "";
}

export function copyStrings(
  source: Record<string, unknown> | undefined,
  keys: string[],
): Partial<Pick<PlanResume, "path" | "title" | "plan">> {
  return Object.fromEntries(
    keys.flatMap((key) => {
      const value = readString(source?.[key]);
      return value ? [[key, value]] : [];
    }),
  );
}

export function errorMessage(value: unknown): string {
  return value instanceof Error ? value.message : String(value);
}
