import type { HostOpResponse } from "@pe/host-contracts/operation-types";

import type { Product } from "#/targeting/model";
import { worldTrunk } from "#/targeting/trunks";

export type HostOperationCatalogEntry = HostOpResponse<"host.ops.catalog">["operations"][number];

export const OPS_PRODUCT: Product = {
  key: "ops",
  name: "operations",
  links: [
    worldTrunk.link,
    {
      key: "op",
      parent: "world",
      joiner: "through",
      placeholder: "pick an operation",
      needs: "an operation from the live catalog",
      dir: "duplex",
      liveness: "attached",
    },
  ],
  stages: [
    {
      key: "explore",
      label: "explore",
      verbs: [{ key: "run", label: "Run", demands: ["world", "op"], run: null }],
    },
  ],
  panes: [
    { key: "request", label: "request", draws: ["op"] },
    { key: "result", label: "result", draws: ["op"] },
  ],
};

export const opsRefusal = (
  operation: HostOperationCatalogEntry | undefined,
  custody: "controlled" | "observed" | undefined,
) =>
  custody === "observed" && operation?.intent.toLowerCase() === "mutate"
    ? "mutating operations require a controlled world"
    : null;

export function bindOpsVerb(run: () => Promise<string>, refuse: () => string | null): Product {
  // SHIM: kit ask, dies when TargetingHead accepts route-local verb handlers beside a static Product.
  return {
    ...OPS_PRODUCT,
    stages: OPS_PRODUCT.stages.map((stage) => ({
      ...stage,
      verbs: stage.verbs.map((verb) => (verb.key === "run" ? { ...verb, run, refuse } : verb)),
    })),
  };
}
