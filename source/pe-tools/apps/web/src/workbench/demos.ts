import { z } from "zod";
import type { ChatActionService } from "./actions";
import { emptyChatState, type ChatState } from "./chat-state";
import { withoutGate } from "./provider/use-workbench";

/** Explicit in-memory session service. No transport or production fallback. */
export function createChatDemoService(
  read: () => ChatState,
  write: (state: ChatState) => void,
): ChatActionService {
  return {
    async sendMessage(input) {
      const content = typeof input === "string" ? input : input.content;
      const state = read();
      write({
        ...state,
        messages: [
          ...state.messages,
          {
            id: `demo-user-${state.messages.length}`,
            role: "user",
            createdAt: new Date("2026-09-09T00:00:00Z"),
            content: { format: 2, parts: [{ type: "text", text: content }] },
          },
        ],
      });
    },
    async abort() {
      const state = read();
      write({ ...state, display: { ...state.display, isRunning: false } });
    },
    async approveTool(id) {
      const state = read();
      write({ ...state, display: withoutGate(state.display, id) });
    },
    async respondToToolSuspension(id) {
      const state = read();
      write({ ...state, display: withoutGate(state.display, id) });
    },
  };
}

const services = (seed: ChatState = emptyChatState()) => {
  let state = structuredClone(seed);
  const read = () => state;
  const write = (next: ChatState) => {
    state = next;
  };
  return { read, write, session: createChatDemoService(read, write) };
};
const context = (_seed: ChatState, service: ReturnType<typeof services>) => {
  return { session: service.session, display: service.read().display };
};
export const CHAT_DEMOS = {
  send: { seed: emptyChatState(), services, context, input: { text: "Demo prompt" } },
  cancel: {
    seed: { ...emptyChatState(), display: { isRunning: true } },
    services,
    context,
    input: undefined,
  },
};

/** Validate the executable Chat fields; unknown imported evidence stays in the seed. */
export const chatDemoState = (value: unknown): ChatState => {
  z.object({
    messages: z.array(
      z.looseObject({
        id: z.string(),
        role: z.enum(["user", "assistant", "system", "tool", "signal"]),
        createdAt: z.date(),
        content: z.looseObject({ format: z.literal(2), parts: z.array(z.unknown()) }),
      }),
    ),
    display: z.record(z.string(), z.unknown()),
    inspect: z.record(z.string(), z.unknown()),
    models: z.looseObject({ available: z.array(z.unknown()) }),
    access: z.enum(["ask", "auto", "trusted"]),
    modeId: z.string(),
  }).parse(value);
  return structuredClone(value) as ChatState;
};
