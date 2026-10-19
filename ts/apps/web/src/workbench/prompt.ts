import type { Mention, PromptAttachment } from "@pe/agent-contracts";

export interface ChatDraft {
  text: string;
  attachments: PromptAttachment[];
  /** What the `@Title` tokens in `text` point at; a token deleted from the text drops its mention. */
  mentions: Mention[];
}

export const EMPTY_CHAT_DRAFT: ChatDraft = { text: "", attachments: [], mentions: [] };

/** Why a prompt cannot go: nothing typed, attached or mentioned (the host's own rule). */
export const emptyPrompt = (prompt: {
  text: string;
  attachments?: readonly unknown[];
  mentions?: readonly unknown[];
}): string | null =>
  prompt.text.trim() || prompt.attachments?.length || prompt.mentions?.length
    ? null
    : "Enter a prompt, attachment or mention";
