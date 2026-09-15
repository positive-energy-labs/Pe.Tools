import { selectApprovals, type ChatState } from "./chat-state";
import type { SessionClient } from "./provider/thread-summary";
import { rejectApproval, toFiles } from "./provider/use-workbench";
import type { WorkbenchAttachment } from "./store";

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
      const session = context.session;
      if (!session) throw Error("Session is not ready");
      await Promise.all([
        ...selectApprovals(context.display).map((approval) => rejectApproval(session, approval)),
        session.abort(),
      ]);
    },
  } satisfies ChatAction<void>,
} as const;
