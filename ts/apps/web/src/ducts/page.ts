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

import type { DuctSnapshot } from "@pe/ducts-domain/types";
import { scopeOf } from "@pe/ducts-domain/system-scope";
import { elementKey } from "@pe/kit/lang/attention";

/** Only opened systems are captured; an unscoped page never captures the whole document. */
export const ductsFocus = (
  snapshot: DuctSnapshot | null,
  system: readonly string[],
  drawn: Iterable<number> = [],
  stubs: Iterable<number> = [],
) => {
  if (!snapshot) return null;
  const scope = scopeOf(snapshot, system);
  if (!scope) return null;
  return {
    walked: [...new Set([...scope.members, ...drawn])].map((id) => elementKey(id)),
    near: [...stubs].map((id) => elementKey(id)),
  };
};
