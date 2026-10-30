import { z } from "zod";
import { pane, routeAddress, pageChoiceSchema, type RouteGraph } from "@pe/agent-contracts";
import { bindAddress } from "../../../../packages/agent-contracts/src/routes/bind";
import { field } from "../../../../packages/agent-contracts/src/route-field";
import { pageBindRpc } from "../../../../packages/mcps/src/shared/rpc-client";
import { threadListFields } from "../../../../packages/agent-contracts/src/routes/shared";
import { rpcVerb } from "#/shell/verbs";

export const bindPageSchema = routeAddress("bind").schema.extend({ epoch: z.number().default(0) });
export type BindPage = z.output<typeof bindPageSchema>;
export const bindGraph: RouteGraph<BindPage, never> = {
  key: "bind",
  address: "bind",
  name: "Bind",
  fields: {
    threadSearch: { ...threadListFields.threadSearch, role: "query", agent: false },
    threadSort: { ...threadListFields.threadSort, role: "query", agent: false },
    page: { ...bindAddress.fields.page, role: "subject", agent: false },
    view: { ...bindAddress.fields.view, role: "pose", agent: false },
    query: { ...bindAddress.fields.query, role: "query", agent: false },
    fragment: { ...bindAddress.fields.fragment, role: "selection", agent: false },
    epoch: { ...field(bindPageSchema.shape.epoch, {}), role: "transient", url: false },
  },
  readings: {
    target: {
      kind: "use",
      source: "bind.target",
      retire: "page",
      args: (p) => [p.page, p.view, p.epoch],
    },
    threads: { kind: "use", source: "bind.threads", retire: "page", args: (p) => p.view },
    inventory: { kind: "use", source: "bind.inventory", retire: "page", args: (p) => p.view },
  },
  verbs: {
    bind: rpcVerb(
      pageBindRpc,
      { label: "Bind", input: pageChoiceSchema, caller: "human", review: "none" },
      {
        ready: (scope) =>
          !scope.page.page ? "Choose a Page" : scope.page.view ? "Open the binding picker" : null,
        intent: (scope, binding) => ({ slug: String(scope.page.page), binding }),
        lands: () => ({ epoch: Date.now() }),
      },
    ),
  },
  panes: {
    page: {
      label: "Page",
      purpose: "View the Page or choose its binding",
      draws: ["target", "threads", "inventory"],
      verbs: Object.assign(() => ["bind"], { ids: ["bind"] }),
    },
  },
  layout: pane("page"),
  stages: { main: { word: "Page", panes: ["page"], verbs: [] } },
};
