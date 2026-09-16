import { useContext } from "react";
import { type AgentControllerThreadInfo, type PlanResume } from "@mastra/client-js";
import { readRecord, readString, shortId, type Approval, type ChatState } from "../chat-state";
import { type WorkbenchAttachment } from "../store";
import type {
  MessageFile,
  SessionClient,
  StoredThreadSummary,
  ToolResume,
  WorkbenchContextValue,
} from "./thread-summary";
import { WorkbenchContext } from "./thread-summary";

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

export function resumeDataForSuspension(
  toolName: string | undefined,
  suspendPayload: unknown,
  response?: ToolResume,
): ToolResume {
  const payload = readRecord(suspendPayload);
  const reject = response === "reject_once";
  if (toolName === "submit_plan") {
    return {
      action: reject ? "rejected" : "approved",
      ...(reject ? { feedback: "Rejected from workbench." } : {}),
      ...copyStrings(payload, ["path", "title", "plan"]),
    };
  }
  if (toolName === "request_access") return reject ? "No" : "Yes";
  if (toolName === "ask_user") {
    if (typeof response === "string" || Array.isArray(response)) return response;
    const options = readArray(payload?.options)?.map(optionText).filter(Boolean) as
      | string[]
      | undefined;
    const first = options?.[0] ?? "Approved";
    return payload?.selectionMode === "multiple" ? [first] : first;
  }
  return reject ? "Rejected" : "Approved";
}

export async function rejectApproval(
  session: Pick<SessionClient, "respondToToolSuspension" | "approveTool">,
  approval: Approval,
): Promise<void> {
  if (approval.kind === "suspension") {
    await session.respondToToolSuspension(
      approval.toolCallId,
      approval.toolName === "ask_user"
        ? "(skipped)"
        : resumeDataForSuspension(approval.toolName, approval.payload, "reject_once"),
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
      // Mastra inlines a text file into the prompt only when it is `text/*` or JSON, and decodes
      // only a `data:` URL; bare base64 reached the model as base64.
      const mediaType =
        attachment.mimeType === "application/json" ? "application/json" : "text/plain";
      return [
        {
          data: `data:${mediaType};base64,${toBase64(attachment.text)}`,
          mediaType,
          ...(attachment.name ? { filename: attachment.name } : {}),
        },
      ];
    }
    return [];
  });
  return files.length ? files : undefined;
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
