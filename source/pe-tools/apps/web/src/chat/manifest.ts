/**
 * The chat route, declared once. The thread head is a Reading, so the route's default Target is
 * whatever the head says — `useRoute` reads it back out of `readings` and no component keeps a
 * second copy. The two actions are the two the surface already had (`workbench/actions.ts`);
 * they close over the session the provider holds, because that session IS chat's host caller.
 */
import { z } from "zod";

import { defineRoute, type RouteManifest } from "#/route";
import { CHAT_ACTIONS, type ChatActionService, type PromptInput } from "#/workbench/actions";
import { emptyChatState, type ChatState } from "#/workbench/chat-state";
import { CHAT_SEEDS, type ChatPage } from "#/chat/seeds";

export type ChatReading = "head" | "inventory" | "receipts";

/** What the route needs from the live surface to run its actions. */
export interface ChatRouteDeps {
  thread: string;
  session?: ChatActionService;
  display?: ChatState["display"];
}

const promptInput = z.object({
  text: z.string(),
  attachments: z.array(z.unknown()).optional(),
});

const chatPage = z.object({ text: z.string(), attachments: z.array(z.unknown()) });

export const chatManifest = (
  deps: ChatRouteDeps,
): RouteManifest<ChatState, ChatReading, ChatPage, "send" | "cancel"> => {
  const context = { session: deps.session, display: deps.display ?? emptyChatState().display };
  return defineRoute<ChatState, ChatReading, ChatPage, "send" | "cancel">({
    key: "chat",
    name: "Chat",
    // Chat runs against one open document: the head names it, the to-line changes it.
    needs: "document",
    readings: {
      head: { kind: "thread-head", thread: deps.thread || "draft" },
      inventory: { kind: "inventory" },
      receipts: { kind: "receipts" },
    },
    page: chatPage,
    actions: {
      send: {
        label: "send",
        says: "sends the composer's prompt to pea under the thread's admitted target",
        needs: "session",
        actor: "human",
        input: promptInput as unknown as z.ZodType<never>,
        dirties: ["head", "receipts"],
        ready: (ctx, input) =>
          CHAT_ACTIONS.send.ready(
            context,
            (input as PromptInput | undefined) ?? { text: ctx.page?.text ?? "" },
          ),
        run: async (ctx, input) => {
          await CHAT_ACTIONS.send.run(
            context,
            (input as PromptInput | undefined) ?? {
              text: ctx.page?.text ?? "",
              attachments: undefined,
            },
          );
        },
      },
      cancel: {
        label: "cancel",
        says: "stops the running turn and rejects every approval it is still waiting on",
        needs: "session",
        actor: "human",
        input: z.void() as unknown as z.ZodType<never>,
        dirties: ["receipts"],
        ready: () => CHAT_ACTIONS.cancel.ready(context),
        run: async () => {
          await CHAT_ACTIONS.cancel.run(context);
        },
      },
    },
    seeds: CHAT_SEEDS as never,
  });
};
