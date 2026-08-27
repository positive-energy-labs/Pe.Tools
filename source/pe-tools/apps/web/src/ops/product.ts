import type { HostOpResponse } from "@pe/host-contracts/operation-types";

import { product, type Feeds, type Verb } from "#/targeting/model";
import { worldTrunk } from "#/targeting/world";

export type HostOperationCatalogEntry = HostOpResponse<"host.ops.catalog">["operations"][number];

export const OPS_SLOTS = {
  world: worldTrunk.link,
  op: {
    key: "op",
    under: "world",
    joiner: "through",
    placeholder: "pick an operation",
    multi: false,
    needs: "an operation from the live catalog",
    dir: "duplex",
    liveness: "attached",
  },
} as const;

export type OpsSlot = keyof typeof OPS_SLOTS;

export const OPS_PRODUCT = (feeds: Feeds<OpsSlot>, action: Pick<Verb<OpsSlot>, "run" | "refuse">) =>
  product(
    "ops",
    "operations",
    OPS_SLOTS,
  )({
    feeds,
    stages: [
      {
        key: "explore",
        label: "explore",
        verbs: [
          {
            key: "run",
            label: "Run",
            demands: ["world", "op"],
            kind: "act",
            needs: "a bound world and operation",
            ...action,
          },
        ],
      },
    ],
    panes: [
      { key: "request", label: "request", draws: ["op"] },
      { key: "result", label: "result", draws: ["op"] },
    ],
  });

export const opsRefusal = (
  operation: HostOperationCatalogEntry | undefined,
  custody: "controlled" | "observed" | undefined,
) =>
  custody === "observed" && operation?.intent.toLowerCase() === "mutate"
    ? "mutating operations require a controlled world"
    : null;
