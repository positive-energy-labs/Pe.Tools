import type { ChatState } from "./chat-state";
import type { SessionClient } from "./provider/thread-summary";
import { toFiles } from "./provider/use-workbench";
import type { WorkbenchAttachment } from "./prompt";

export type ChatActionService = Pick<
  SessionClient,
  "sendMessage" | "abort" | "approveTool" | "respondToToolSuspension"
>;
export interface ChatActionContext {
  readonly session: ChatActionService | undefined;
  readonly display: ChatState["display"];
}
export interface PromptInput {
  text: string;
  attachments?: WorkbenchAttachment[];
}

/** What one chat action is: a refusal sentence first, then the run. No stages, no bindings. */
interface ChatAction<I> {
  label: string;
  needs: string;
  ready: (context: ChatActionContext, input: I) => string | null;
  run: (context: ChatActionContext, input: I) => Promise<unknown>;
}

export const CHAT_ACTIONS = {
  send: {
    label: "send",
    needs: "A session and a prompt or attachment",
    ready: (context: ChatActionContext, input: PromptInput) =>
      !context.session
        ? "Session is not ready"
        : !input.text.trim() && !input.attachments?.length
          ? "Enter a prompt or attachment"
          : null,
    run: async (context: ChatActionContext, input: PromptInput) => {
      if (!context.session) throw Error("Session is not ready");
      return context.session.sendMessage({
        content: input.text.trim(),
        files: toFiles(input.attachments),
      });
    },
  } satisfies ChatAction<PromptInput>,
  cancel: {
    label: "cancel",
    needs: "A session",
    ready: (context: ChatActionContext) => (context.session ? null : "Session is not ready"),
    run: async (context: ChatActionContext) => {
      if (!context.session) throw Error("Session is not ready");
      // Cancel expires the turn's open asks (runtime abort); it never answers them.
      await context.session.abort();
    },
  } satisfies ChatAction<void>,
} as const;

/** Re-read only after abort has finished clearing the runtime's live suspension set. */
export async function cancelAndRefresh(context: ChatActionContext, refresh: () => void) {
  await CHAT_ACTIONS.cancel.run(context);
  refresh();
}
