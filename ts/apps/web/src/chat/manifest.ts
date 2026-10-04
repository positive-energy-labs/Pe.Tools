/**
 * The chat route, declared once. The thread head is a Reading, so the route's default Target is
 * whatever the head says — `useRoute` reads it back out of `readings` and no component keeps a
 * second copy. Every action runs the provider's verb over the harness-thread wire.
 */
import { z } from "zod";

import { defineRoute, type RouteManifest } from "#/route";
import type { WorkbenchAttachment } from "#/workbench/prompt";
import type { ChatState } from "#/workbench/chat-state";
import { CHAT_SEEDS, type ChatPage } from "#/chat/seeds";

export type ChatReading = "head" | "inventory" | "receipts";

export interface PromptInput {
  text: string;
  attachments?: WorkbenchAttachment[];
}

/** What the route needs from the live surface to run its actions; absent on seeds. */
export interface ChatRouteDeps {
  thread: string;
  /** The thread body has loaded (or there is no thread yet). */
  ready?: boolean;
  running?: boolean;
  send?: (input: PromptInput) => Promise<void>;
  cancel?: () => Promise<void>;
  newThread?: () => Promise<void>;
  forkThread?: () => Promise<void>;
  /** Why no thread can be created now (harnesses loading, none installed). */
  newRefusal?: string;
}

const promptInput = z.object({
  text: z.string(),
  attachments: z.array(z.unknown()).optional(),
});

export type ChatActionKey = "send" | "cancel" | "new" | "fork";

export const chatManifest = (
  deps: ChatRouteDeps,
): RouteManifest<ChatState, ChatReading, ChatPage, ChatActionKey> =>
  defineRoute<ChatState, ChatReading, ChatPage, ChatActionKey>({
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
        label: deps.running ? "queue" : "send",
        says: "sends this prompt, or queues it after the active turn, under the thread target",
        needs: "host",
        actor: "human",
        input: promptInput as unknown as z.ZodType<never>,
        dirties: ["head", "receipts"],
        ready: (_ctx, input) => {
          if (!deps.send) return "Chat is not ready";
          if (!deps.ready) return "Thread state is loading";
          // The first send creates the thread.
          if (!deps.thread && deps.newRefusal) return deps.newRefusal;
          const prompt = input as PromptInput | undefined;
          if (prompt?.attachments?.length) return "Attachments do not cross the harness wire yet";
          return prompt && !prompt.text.trim() ? "Enter a prompt" : null;
        },
        run: async (_ctx, input) => deps.send?.(input as PromptInput),
      },
      cancel: {
        label: "cancel",
        says: "stops the running turn; its open permission asks expire, unanswered",
        needs: "host",
        actor: "human",
        input: z.void() as unknown as z.ZodType<never>,
        dirties: ["receipts"],
        ready: () =>
          !deps.cancel ? "Chat is not ready" : deps.running ? null : "Nothing is running",
        run: async () => deps.cancel?.(),
      },
      new: {
        label: "new",
        says: "starts a new, empty thread on the first available harness and opens it",
        needs: "host",
        actor: "human",
        input: z.void() as unknown as z.ZodType<never>,
        dirties: ["head"],
        ready: () => (deps.newThread ? (deps.newRefusal ?? null) : "Chat is not ready"),
        run: async () => deps.newThread?.(),
      },
      fork: {
        label: "fork",
        says: "copies this thread into a new one on the same harness, model context included, and opens it",
        needs: "host",
        actor: "human",
        input: z.void() as unknown as z.ZodType<never>,
        dirties: ["head"],
        ready: () =>
          !deps.forkThread
            ? "Chat is not ready"
            : !deps.thread
              ? "No thread to fork yet"
              : deps.running
                ? "Fork after the running turn ends"
                : null,
        run: async () => deps.forkThread?.(),
      },
    },
    seeds: CHAT_SEEDS as never,
  });
