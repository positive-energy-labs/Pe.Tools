import { defineRouteGraph } from "@pe/agent-contracts";
// TODO: docs/features/routes/LEDGER.md#s6-declaration-ops Declaration 79 > 60 after kernel defaults. Operation dispatch, receipt control and request/result fields remain distinct.
import { z } from "zod";
import { pane, split, type RouteGraph } from "@pe/agent-contracts";
import { field } from "../../../../packages/agent-contracts/src/route-field";
import { opsAddress } from "../../../../packages/agent-contracts/src/routes/ops";
import { rpcVerb, operationVerb } from "#/shell/verbs";
import { opRead, opReadInput, receiptControlRpc, receiptControlInput } from "./sources";
import { isMutation } from "./manifest";
const values = z.record(z.string(), z.unknown()).default({});
const result = z.unknown().nullable().default(null);
export const opsPageSchema = z.object({
  op: opsAddress.fields.op.schema,
  actionId: opsAddress.fields.actionId.schema,
  values,
  result,
});
export type OpsPage = z.output<typeof opsPageSchema>;
export const opsGraph: RouteGraph<OpsPage> = defineRouteGraph({
  seeds: {
    inspect: {
      title: "inspect",
      load: () => import("#/shell/fixture-examples").then((m) => m.routeExamples["ops"]),
    },
  },
  directory: {
    path: "/ops",
    title: "Ops Playground",
    label: "Host API",
    exposure: "Preview",
    runtimeNeed: "Host operation; Revit depends on the operation",
    icon: "Terminal",
    category: "Explore / maintain",
    blurb: "Inspect operation requests and action receipts, and run host reads.",
    aliases: ["host", "api", "operations", "playground"],
    listed: true,
    satellites: [],
    surfaces: {
      web: "full",
      pwa: "full",
      tray: false,
    },
  },
  key: "ops",
  address: "ops",
  name: "Ops",
  optionalTarget: "session",
  subjectField: { field: "op", noun: "operation", keyKind: "name", roster: "catalog", detail: "operation", pane: "operation", },
  fields: {
    op: { ...opsAddress.fields.op, agent: false },
    actionId: { ...opsAddress.fields.actionId, role: "selection", agent: false },
    values: {
      editor: "pane",
      ...field(values, {}, { encode: JSON.stringify, decode: JSON.parse }),
      role: "draft",
      url: false,
      agent: false,
    },
    result: {
      ...field(result, {}, { encode: JSON.stringify, decode: JSON.parse }),
      role: "transient",
      url: false,
    },
  },
  transition: (current, patch) => ({
    patch: {
      ...(patch.op !== undefined && patch.op !== current.op
        ? { values: {}, result: null, actionId: "" }
        : {}),
      ...patch,
    },
  }),
  readings: {
    operation: { kind: "derive", deps: ["catalog"], args: (page) => page.op },
    receipt: {    args: (page) => page.actionId },
    receipts: {   retire: "never" },
  },
  verbs: {
    control: rpcVerb(
      receiptControlRpc,
      { label: "Receipt control", input: receiptControlInput, caller: "human", review: "none" },
      {
        intent: (_, input) => input,
        lands: (value) => ({ actionId: (value as { id: string }).id }),
      },
    ),
    run: operationVerb(
      opRead,
      {
        label: "Run",
        input: opReadInput.extend({ refusal: z.string().nullable().default(null) }),
        chord: "Mod+Enter",
      },
      {
        ready: (_, input) => input.refusal,
        raw: (_, input) =>
          isMutation(input.op)
            ? { key: input.op.key, input: z.record(z.string(), z.unknown()).parse(input.request) }
            : null,
        receiptPage: (receipt) => ({ actionId: receipt.id }),
        intent: (_, input) => ({ op: input.op, request: input.request }),
        lands: (value) => ({ result: value }),
      },
    ),
  },
  panes: {
    receipts: {
      label: "Receipts",
      purpose: "Choose a journaled operation receipt",
      draws: ["receipts"],
    },
    operation: {
      label: "Operation",
      purpose: "Choose a catalog operation and inspect its request and result",
      draws: ["catalog"],
    },
    receipt: {
      label: "Receipt",
      purpose: "Inspect the original journaled action",
      draws: ["receipt"],
    },
    history: {
      label: "History",
      purpose: "Inspect operation invocations and receipts",
      draws: ["receipts"],
      history: { receipts: "receipts" },
    },
  },
  layout: split(
    "ops-body",
    { axis: "v", sized: "end", size: 180 },
    split(
      "ops-detail",
      { axis: "h", sized: "end", size: 400 },
      pane("operation"),
      split(
        "ops-receipts",
        { axis: "v", sized: "start", size: 200 },
        pane("receipts"),
        pane("receipt"),
      ),
    ),
    pane("history"),
  ),
  stages: {
    inspect: {
      word: "Inspecting",
      panes: ["operation", "receipts", "receipt", "history"],
      verbs: ["run"],
    },
  },
});
