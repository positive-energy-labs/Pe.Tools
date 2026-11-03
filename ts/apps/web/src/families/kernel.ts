import { createElement } from "react";
import { identityCodecs } from "../shell/page-port";
import { familiesData, familiesSchemas, familiesEntries, familiesNeutralBodies } from "./neutral";
import type { BodyBindings } from "../../../../packages/agent-contracts/src/route-kernel-bodies";
export { familiesData, familiesSchemas, familiesEntries, familiesScopeId } from "./neutral";

export const familiesBodies = {
  ...familiesNeutralBodies,
  main: {
    slot: "panes.main.body",
    kind: "pane",
    source: { module: "families/kernel.ts", export: "familiesModule" },
    run: (ctx) =>
      createElement(
        "output",
        { "aria-label": "Family Work" },
        !ctx.readings.matrix.current
          ? ctx.readings.matrix.reason
          : JSON.stringify(ctx.work?.cells ?? {}),
      ),
  },
} satisfies BodyBindings<typeof familiesData, typeof familiesSchemas, typeof familiesEntries>;
export const familiesModule = {
  data: familiesData,
  schemas: familiesSchemas,
  entries: familiesEntries,
  bodies: familiesBodies,
  identities: { local: identityCodecs.local },
  codecs: {
    json: {
      encode: JSON.stringify,
      decode: (text: string) => {
        try {
          return { ok: true as const, value: JSON.parse(text) };
        } catch {
          return { ok: false as const, reason: "Invalid family scope" };
        }
      },
    },
  },
};
