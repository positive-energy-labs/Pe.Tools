import { losses } from "@pe/ducts-contract/product";
import { ductSystemsTool } from "./semantic-actions.ts";

export const product = {
  id: "duct-systems",
  tools: { ducts: ductSystemsTool },
  actions: ductSystemsTool.commands,
  sheet: { writes: { losses } },
};
