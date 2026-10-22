/**
 * The chat route, declared once. The thread head is a Reading, so the route's default Target is
 * whatever the head says â€” `useRoute` reads it back out of `readings` and no component keeps a
 * second copy. Every action runs the provider's verb over the harness-thread wire.
 */
import { z } from "zod";
import {
  attachmentRefusal,
  threadHeadSchema,
  headRequests,
  emptyThreadHead,
  machineInventory,
  type Machine,
  type Reading,
  type DocumentRequest,
  type PromptCapabilities,
} from "@pe/agent-contracts";

import { defineRoute, type RouteManifest } from "#/route";
import { previousOf } from "#/readings";
import { targetClosure } from "#/chat/thread-navigation";
import type { PromptRequest } from "#/workbench/provider/harness-client";
import { emptyPrompt } from "#/workbench/prompt";
import type { ChatState } from "@pe/agent-contracts/chat-state";
import { CHAT_SEEDS, type ChatPage } from "#/chat/seeds";

export type ChatReading = "head" | "machine" | "receipts" | "capabilities";

/** What the route needs from the live surface to run its actions; absent on seeds. */
export interface ChatRouteDeps {
  thread: string;
  /** The thread body has loaded (or there is no thread yet). */
  ready?: boolean;
  running?: boolean;
  send?: (input: PromptRequest) => Promise<void>;
  cancel?: () => Promise<void>;
  newThread?: () => Promise<void>;
  forkThread?: () => Promise<void>;
  /** Why a send cannot go now: providers loading, none ready, or the provider this head runs on is not. */
  sendRefusal?: string;
  /** What the thread's harness reads (null until its first session) and its name, for the
   * attachment refusal; the host enforces the same rule. */
  promptCapabilities?: PromptCapabilities | null;
  providerName?: string;
  /** The target a draft holds before its first send creates a thread (a thread's lives on its head). */
  draftTarget?: DocumentRequest | null;
}

/** A closed target is a saved request the live inventory no longer holds; no turn rides on it. */
const CLOSED_SEND = "Its document is closed: choose a live document or clear the target";

const promptInput = z.object({
  text: z.string(),
  attachments: z.array(z.unknown()).optional(),
  mentions: z.array(z.unknown()).optional(),
});

export type ChatActionKey = "send" | "stop" | "new" | "fork";

export const chatManifest = (
  deps: ChatRouteDeps,
): RouteManifest<ChatState, ChatReading, ChatPage, ChatActionKey> =>
  defineRoute<ChatState, ChatReading, ChatPage, ChatActionKey>({
    key: "chat",
    name: "Pea",
    docs: "Choose a thread in the left pane; the transcript reads only that thread while its composer keeps each visited draft. The Situation names the bound target and turn state. Enter sends from the focused composer; Shift+Enter adds a line. Type / for skills or @ to mention a document, skill, route, command, op or Pod. The optional workspace stays beside the same conversation.",
    // Conversation needs no Revit target; each invoked capability resolves its own requirement.
    readings: {
      head: { kind: "thread-head", thread: deps.thread || "draft" },
      machine: { kind: "machine" },
      receipts: { kind: "receipts" },
      // The one catalog the `@` menu searches; the same rows `pe_find` and `pea find` read.
      capabilities: { kind: "capabilities" },
    },
    actions: {
      send: {
        label: "send",
        says: "sends this prompt under the thread target; while Pea answers, it stops that turn first",
        needs: "host",
        actor: "human",
        input: promptInput as unknown as z.ZodType<never>,
        dirties: ["head", "receipts"],
        ready: (ctx, input) => {
          if (!deps.send) return "Chat is not ready";
          if (!deps.ready) return "Thread state is loading";
          if (deps.sendRefusal) return deps.sendRefusal;
          const targets = deps.thread
            ? headRequests(
                threadHeadSchema.safeParse(previousOf(ctx.readings.head)).data ?? emptyThreadHead,
              )
            : deps.draftTarget
              ? [deps.draftTarget]
              : [];
          const inventory = machineInventory(previousOf(ctx.readings.machine as Reading<Machine>));
          if (targets.some((target) => targetClosure(target, inventory))) return CLOSED_SEND;
          const prompt = input as PromptRequest | undefined;
          if (!prompt) return null;
          return (
            emptyPrompt(prompt) ??
            attachmentRefusal(
              prompt.attachments ?? [],
              deps.promptCapabilities ?? null,
              deps.providerName ?? "This harness",
            )
          );
        },
        run: async (_ctx, input) => deps.send?.(input as PromptRequest),
      },
      stop: {
        label: "stop",
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
        says: "opens an empty draft; the first send creates its thread on the head's provider",
        needs: "host",
        actor: "human",
        input: z.void() as unknown as z.ZodType<never>,
        dirties: ["head"],
        ready: () => (deps.newThread ? null : "Chat is not ready"),
        run: async () => deps.newThread?.(),
      },
      fork: {
        label: "fork",
        says: "copies this thread into a new one on the same provider, model context included, and opens it",
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
