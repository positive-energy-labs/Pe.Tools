import { jsonCodec } from "../../../../packages/agent-contracts/src/route-kernel-codecs";
import { z } from "zod";
import { DEMO_FAMILIES } from "./seeds";
import { familiesObservationSchema, familiesRouteState } from "@pe/agent-contracts";
import { familiesScopeId } from "./neutral";
import { actionReceiptListDecoder, workKeySchema } from "@pe/agent-contracts";
import { subscriptionSource } from "../shell/readings-use";
import type { ReadingSource } from "../shell/readings";
import { FamiliesKernelMatrix } from "./kernel-matrix";
import { familiesMatrixSource } from "./matrix-source";
import { createElement } from "react";
import { identityCodecs } from "../shell/page-port";
import { familiesData, familiesSchemas, familiesEntries, familiesNeutralBodies } from "./neutral";
import type { BodyBindings } from "../../../../packages/agent-contracts/src/route-kernel-bodies";
export { familiesData, familiesSchemas, familiesEntries, familiesScopeId } from "./neutral";

export const familiesBodies = {
  ...familiesNeutralBodies,
  seed: {
    slot: "seeds.audit.load",
    kind: "seed",
    source: { module: "families/kernel.ts", export: "familiesBodies" },
    run: () => {
      const filter = {
        categoryNames: ["Mechanical Equipment"],
        familyNames: [],
        placementScope: "AllLoaded" as const,
      };
      const takenAt = "2026-11-03T00:00:00Z";
      const matrix = familiesObservationSchema.parse({
        id: "fixture:families",
        work: { binding: "host", route: "families", target: null },
        document: { session: "fixture", openId: "families" },
        filter,
        capturedAt: takenAt,
        completedAt: takenAt,
        result: { families: [...DEMO_FAMILIES], issues: [], page: null },
      });
      return {
        work: familiesRouteState.schema.parse({ scope: { edit: { value: filter } }, takenAt }),
        readings: {
          receipts: [],
          matrix,
          scopes: [{ id: familiesScopeId, label: "Family draft scope" }],
          catalog: { families: [...DEMO_FAMILIES] },
        },
        queries: { read: matrix },
      };
    },
  },

  main: {
    slot: "panes.main.body",
    kind: "pane",
    source: { module: "families/kernel.ts", export: "familiesModule" },
    run: (ctx) => createElement(FamiliesKernelMatrix, { ctx }),
  },
} satisfies BodyBindings<typeof familiesData, typeof familiesSchemas, typeof familiesEntries>;
export const familiesModule = {
  sources: {
    "families.read": familiesMatrixSource(),
    "families.receipts": {
      kind: "use",
      open(ctx, deliver) {
        const work = workKeySchema.nullable().parse(ctx.args);
        if (!work) return deliver({ kind: "complete", revision: 0, value: [] });
        return subscriptionSource({
          request: () => ({ kind: "receipts", work }),
          decode: (v) => actionReceiptListDecoder().parse(v),
        }).open(ctx, deliver);
      },
    },
  } satisfies Record<string, ReadingSource>,
  data: familiesData,
  schemas: familiesSchemas,
  entries: familiesEntries,
  bodies: familiesBodies,
  identities: { local: identityCodecs.local },
  codecs: {
    json: jsonCodec(z.union([familiesSchemas.subject, familiesSchemas.text])),

  },
};

export { familiesModule as module };
