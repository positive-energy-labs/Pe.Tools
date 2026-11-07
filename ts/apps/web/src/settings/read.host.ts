import { z } from "zod";
import { readingRequestSchema } from "@pe/agent-contracts";
import { leaf, read } from "../../../host/src/reads/evaluator.ts";
import { settingsArgs, settingsValue } from "./route.ts";

const resource = leaf("resource", readingRequestSchema, z.unknown());
export const reads = { machine: read("settings.machine", {
  input: settingsArgs, output: settingsValue,
  async run(ctx) { return settingsValue.parse({ machine: await ctx.read(resource, { kind: "machine" }) }); },
}) };
