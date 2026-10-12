import type { PromptAttachment } from "@pe/agent-contracts";

export interface ChatDraft {
  text: string;
  attachments: PromptAttachment[];
}

export const EMPTY_CHAT_DRAFT: ChatDraft = { text: "", attachments: [] };
