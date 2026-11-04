import { z } from "zod";
import { routeAddress } from "@pe/agent-contracts";
import { ductsAddress } from "../../../../packages/agent-contracts/src/routes/ducts";
import { threadListFields } from "../../../../packages/agent-contracts/src/routes/shared";
const fields = { ...threadListFields, ...ductsAddress.fields };
export const ductsPageSchema = routeAddress("ducts").schema.extend({
  sheetPath: z.string().default(""),
});
export type DuctsPage = { [K in keyof typeof fields]: z.output<(typeof fields)[K]["schema"]> } & {
  sheetPath: string;
};
