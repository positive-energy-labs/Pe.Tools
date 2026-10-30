import { z } from "zod";
import { pane, routeAddress, type RouteGraph } from "@pe/agent-contracts";
import { capturesAddress } from "../../../../packages/agent-contracts/src/routes/captures";
import { threadListFields } from "../../../../packages/agent-contracts/src/routes/shared";
import { queryVerb } from "#/shell/verbs";
import { captureQueries } from "./host";
export type CapturesPage = z.output<ReturnType<typeof routeAddress<"captures">>["schema"]>;
export const capturesGraph: RouteGraph<CapturesPage, never> = {
  key: "captures",
  address: "captures",
  name: "Captures",
  fields: {
    threadSearch: { ...threadListFields.threadSearch, role: "query" },
    threadSort: { ...threadListFields.threadSort, role: "query" },
    sha: { ...capturesAddress.fields.sha, role: "selection" },
    open: { ...capturesAddress.fields.open, role: "pose" },
  },
  readings: { captures: { kind: "use", source: "captures.list", retire: "never" } },
  verbs: {
    refresh: queryVerb(captureQueries["captures.list"], {
      label: "refresh",
      says: "Re-read the kept captures from the host",
      input: z.object({}),
      review: "none",
    }),
  },
  panes: {
    captures: {
      label: "Captures",
      purpose: "Inspect retained pictures and their takings",
      draws: ["captures"],
      verbs: [],
    },
  },
  layout: pane("captures"),
  stages: { main: { word: "Captures", panes: ["captures"], verbs: ["refresh"] } },
};
