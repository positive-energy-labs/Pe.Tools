/**
 * The chat route, declared once. The thread head is a Reading, so the route's default Target is
 * whatever the head says — `useRoute` reads it back out of `readings` and no component keeps a
 * second copy. The two actions are the two the surface already had (`workbench/actions.ts`);
 * they close over the session the provider holds, because that session IS chat's host caller.
 */
import { z } from "zod";

import { defineRoute, type RouteManifest } from "#/route";
import { CHAT_ACTIONS, type ChatActionService, type PromptInput } from "#/workbench/actions";
import { emptyChatState, selectApprovals, type ChatState } from "#/workbench/chat-state";
import { CHAT_SEEDS, type ChatPage } from "#/chat/seeds";

export type ChatReading = "head" | "inventory" | "receipts";

/** What the route needs from the live surface to run its actions. */
export interface ChatRouteDeps {
  thread: string;
  session?: ChatActionService;
  display?: ChatState["display"];
  /**
   * The provider's send, when the surface has one: it runs the same `CHAT_ACTIONS.send` and then
   * re-reads a thread whose stream was still pending. Absent (static registration, seeds), the
   * action runs the session directly.
   */
  send?: (input: PromptInput) => Promise<void>;
}

const promptInput = z.object({
  text: z.string(),
  attachments: z.array(z.unknown()).optional(),
});

export const chatManifest = (
  deps: ChatRouteDeps,
): RouteManifest<ChatState, ChatReading, ChatPage, "send" | "cancel"> => {
  const context = { session: deps.session, display: deps.display ?? emptyChatState().display };
  return defineRoute<ChatState, ChatReading, ChatPage, "send" | "cancel">({
    key: "chat",
    name: "Chat",
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
          if (context.display.isRunning || selectApprovals(context.display).length)
            return "Pea is working";
          return input ? CHAT_ACTIONS.send.ready(context, input as PromptInput) : null;
        },
        run: async (ctx, input) => {
          const prompt = input as PromptInput;
          await ctx.external(async () => {
            if (deps.send) await deps.send(prompt);
            else await CHAT_ACTIONS.send.run(context, prompt);
          });
        },
      },
      cancel: {
        label: "cancel",
        says: "stops the running turn and rejects every approval it is still waiting on",
        needs: "host",
        actor: "human",
        input: z.void() as unknown as z.ZodType<never>,
        dirties: ["receipts"],
        ready: () => CHAT_ACTIONS.cancel.ready(context),
        run: async (ctx) => {
          await ctx.external(() => CHAT_ACTIONS.cancel.run(context));
        },
      },
    },
    seeds: CHAT_SEEDS as never,
  });
};
