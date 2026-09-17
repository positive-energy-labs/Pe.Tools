export interface WorkbenchAttachment {
  name?: string;
  mimeType?: string;
  text?: string;
  data?: string;
  size?: number;
}

export interface ChatDraft {
  text: string;
  attachments: WorkbenchAttachment[];
}

export const EMPTY_CHAT_DRAFT: ChatDraft = { text: "", attachments: [] };
