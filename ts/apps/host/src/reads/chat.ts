import { z } from "zod";
import { readingRequestSchema } from "@pe/agent-contracts";
import { leaf, read } from "./evaluator.ts";
import { chatArgs, chatValue } from "../../../../packages/agent-contracts/src/chat-read.ts";

const resource = leaf("resource", readingRequestSchema, z.unknown());
export const reads = { context: read("chat.context", {
  input: chatArgs, output: chatValue,
  async run(ctx) { return { machine: await ctx.read(resource, { kind: "machine" }) as z.output<typeof chatValue>["machine"], capabilities: await ctx.read(resource, { kind: "capabilities" }) }; },
}) };
