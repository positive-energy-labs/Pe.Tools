import { z } from "zod";
import { readingRequestSchema } from "@pe/agent-contracts";
import { leaf, read } from "./evaluator.ts";
import { settingsArgs, settingsValue } from "../../../../packages/agent-contracts/src/settings-read.ts";

const resource = leaf("resource", readingRequestSchema, z.unknown());
export const reads = { machine: read("settings.machine", {
  input: settingsArgs, output: settingsValue,
  async run(ctx) { return settingsValue.parse({ machine: await ctx.read(resource, { kind: "machine" }) }); },
}) };
