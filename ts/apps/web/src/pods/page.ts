import { z } from "zod";
import { routeAddress } from "@pe/agent-contracts";
import { field } from "../../../../packages/agent-contracts/src/route-field";
import { podsAddress } from "../../../../packages/agent-contracts/src/routes/pods";
import { threadListFields } from "../../../../packages/agent-contracts/src/routes/shared";

export const podsPageSchema = routeAddress("pods").schema.extend({
  member: z.string().default(""),
  mode: z.enum(["form", "raw"]).default("form"),
  pluginEpoch: z.number().default(0),
  pendingDraft: z.boolean().default(false),
  live: z.unknown().optional(),
});
export type PodsPage = z.output<typeof podsPageSchema>;
export const podsFields = {
  threadSearch: { ...threadListFields.threadSearch, role: "query" as const },
  threadSort: { ...threadListFields.threadSort, role: "query" as const },
  pod: { ...podsAddress.fields.pod, role: "subject" as const },
  path: { ...podsAddress.fields.path, role: "subject" as const },
  runs: { ...podsAddress.fields.runs, role: "query" as const },
  demo: { ...podsAddress.fields.demo, role: "transient" as const },
  member: {
    ...field(podsPageSchema.shape.member, {}),
    role: "transient" as const,
    url: false as const,
  },
  mode: {
    ...field(podsPageSchema.shape.mode, {}),
    role: "device" as const,
    url: false as const,
    agent: false as const,
  },
  pluginEpoch: {
    ...field(podsPageSchema.shape.pluginEpoch, {}),
    role: "transient" as const,
    url: false as const,
  },
  pendingDraft: {
    ...field(podsPageSchema.shape.pendingDraft, {}),
    role: "transient" as const,
    url: false as const,
  },
  live: {
    ...field(
      podsPageSchema.shape.live,
      { url: "replace" },
      { encode: String, decode: (value) => value },
    ),
    role: "transient" as const,
  },
};
