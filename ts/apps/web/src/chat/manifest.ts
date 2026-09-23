import { askLifetime } from "@pe/agent-contracts";
/**
 * The chat route, declared once. The thread head is a Reading, so the route's default Target is
 * whatever the head says — `useRoute` reads it back out of `readings` and no component keeps a
 * second copy. `send` and `cancel` run `workbench/actions.ts` over the session the provider holds,
 * because that session IS chat's host caller; `new` and `fork` run the provider's thread verbs.
 */
import { z } from "zod";

import { defineRoute, type RouteManifest } from "#/route";
import { CHAT_ACTIONS, type ChatActionService, type PromptInput } from "#/workbench/actions";
import {
  emptyChatState,
  isParkedAsk,
  selectApprovals,
  type ChatState,
} from "#/workbench/chat-state";
import { CHAT_SEEDS, type ChatPage } from "#/chat/seeds";

export type ChatReading = "head" | "inventory" | "receipts";

/** What the route needs from the live surface to run its actions. */
export interface ChatRouteDeps {
  thread: string;
  session?: ChatActionService;
  display?: ChatState["display"];
  /** A body or stream frame must establish the gate before an empty display can mean idle. */
  displayKnown?: boolean;
  /**
   * The provider's send, when the surface has one: it runs the same `CHAT_ACTIONS.send` and then
   * re-reads a thread whose stream was still pending. Absent (static registration, seeds), the
   * action runs the session directly.
   */
  send?: (input: PromptInput) => Promise<void>;
  /** The provider's cancel, which re-reads the thread after runtime abort settles. */
  cancel?: () => void | Promise<void>;
  /** Whether the thread holds any message; an empty thread has nothing to fork. */
  hasMessages?: boolean;
  /** The provider's thread verbs; absent on the static registration. */
  newThread?: () => void;
  forkThread?: () => Promise<void>;
}

const promptInput = z.object({
  text: z.string(),
  attachments: z.array(z.unknown()).optional(),
});

export type ChatActionKey = "send" | "cancel" | "new" | "fork";

export const chatManifest = (
  deps: ChatRouteDeps,
): RouteManifest<ChatState, ChatReading, ChatPage, ChatActionKey> => {
  const context = { session: deps.session, display: deps.display ?? emptyChatState().display };
  return defineRoute<ChatState, ChatReading, ChatPage, ChatActionKey>({
    key: "chat",
    name: "Chat",
    docs: "Choose a thread in the left pane; the transcript reads only that thread while its composer keeps each visited draft. The Situation names the bound target and turn state. Enter sends from the focused composer; Shift+Enter adds a line. The optional workspace stays beside the same conversation.",
    // Conversation needs no Revit target; each invoked capability resolves its own requirement.
    readings: {
      head: { kind: "thread-head", thread: deps.thread || "draft" },
      inventory: { kind: "inventory" },
      receipts: { kind: "receipts" },
    },
    actions: {
      send: {
        label: "send",
        says: "sends the composer's prompt to pea under the thread's admitted target",
        needs: "host",
        actor: "human",
        input: promptInput as unknown as z.ZodType<never>,
        dirties: ["head", "receipts"],
        // At rest the verb asks for a session and an idle Pea. The store-owned composer draft is
        // parsed on the press, so the route holds no second draft.
        ready: (_ctx, input) => {
          if (!context.session) return "Session is not ready";
          if (!deps.displayKnown) return "Thread state is loading";
          const approvals = selectApprovals(context.display);
          // A parked ask does not hold the composer: the new turn is how the runtime expires it.
          if (approvals.some((approval) => !isParkedAsk(approval)))
            return "A tool approval is waiting";
          if (context.display.isRunning && approvals.length === 0) return "Pea is working";
          return input ? CHAT_ACTIONS.send.ready(context, input as PromptInput) : null;
        },
        run: async (_ctx, input) => {
          const prompt = input as PromptInput;
          if (deps.send) await deps.send(prompt);
          else await CHAT_ACTIONS.send.run(context, prompt);
        },
      },
      cancel: {
        label: "cancel",
        says: `stops the running turn; its open asks expire, unanswered (an ask ${askLifetime})`,
        needs: "host",
        actor: "human",
        input: z.void() as unknown as z.ZodType<never>,
        dirties: ["receipts"],
        ready: () => CHAT_ACTIONS.cancel.ready(context),
        run: async () => {
          if (deps.cancel) await deps.cancel();
          else await CHAT_ACTIONS.cancel.run(context);
        },
      },
      new: {
        label: "new",
        says: "starts a new, empty thread and opens it",
        needs: "host",
        actor: "human",
        input: z.void() as unknown as z.ZodType<never>,
        dirties: ["head"],
        ready: () => (deps.newThread ? null : "Chat is not ready"),
        run: async () => {
          deps.newThread?.();
        },
      },
      fork: {
        label: "fork",
        says: "clones this thread, messages and all, and opens the clone",
        needs: "host",
        actor: "human",
        input: z.void() as unknown as z.ZodType<never>,
        dirties: ["head"],
        ready: () => {
          if (!deps.thread) return "No thread to fork";
          if (!context.session) return "Session is not ready";
          if (!deps.hasMessages) return "This thread has no messages to fork";
          if (context.display.isRunning) return "Pea is working";
          return deps.forkThread ? null : "Chat is not ready";
        },
        run: async () => {
          await deps.forkThread?.();
        },
      },
    },
    seeds: CHAT_SEEDS as never,
  });
};
