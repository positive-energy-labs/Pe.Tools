import * as contracts from "./contract.ts";
import { body } from "@pe/host-internal/read-graph";

import { captures } from "@pe/host-internal/builtin-read-handles";
export const reads = {
  browse: body(contracts.browse, (ctx) => ctx.read(captures, { kind: "captures" as const })),
};
