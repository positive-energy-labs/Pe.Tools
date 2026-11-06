import { z } from "zod";
import { promptRequestSchema } from "@pe/agent-contracts";
import type { LocalCommandPort } from "../../../../packages/agent-contracts/src/route-kernel-environment.ts";
import type { ChatRouteDeps } from "./graph.ts";

const { id: _id, ...promptFields } = promptRequestSchema.shape;
export const chatLocalSchemas = {
  threadCommand: z.object({ thread: z.string() }),
  promptCommand: z.object({ thread: z.string(), prompt: z.object(promptFields) }),
  acknowledged: z.object({}),
};

/** Provider acknowledgment ends the press; the harness stream owns the running turn. */
export function chatLocalPort(deps: () => ChatRouteDeps): LocalCommandPort {
  const commands = {
    "thread.prompt": async (input: unknown) => {
      const { prompt } = chatLocalSchemas.promptCommand.parse(input);
      if (!deps().send) throw Error("Chat is not ready");
      await deps().send!(prompt);
    },
    "thread.cancel": async () => {
      if (!deps().cancel) throw Error("Chat is not ready");
      await deps().cancel!();
    },
    "thread.fork": async () => {
      if (!deps().forkThread) throw Error("Chat is not ready");
      await deps().forkThread!();
    },
  };
  return async (call, signal) => {
    signal.throwIfAborted();
    const { thread } = chatLocalSchemas.threadCommand.parse(call.input);
    if (thread !== deps().thread) throw Error("Thread changed; press again");
    if (!Object.hasOwn(commands, call.entry)) throw Error("Unknown chat command");
    await commands[call.entry as keyof typeof commands](call.input);
    return {};
  };
}
