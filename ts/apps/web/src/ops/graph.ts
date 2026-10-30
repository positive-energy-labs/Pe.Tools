import { z } from "zod";
import { pane, split, type RouteGraph } from "@pe/agent-contracts";
import { field } from "../../../../packages/agent-contracts/src/route-field";
import { opsAddress } from "../../../../packages/agent-contracts/src/routes/ops";
import { rpcVerb } from "#/shell/verbs";
import { opRead, opReadInput, receiptControlRpc, receiptControlInput } from "./sources";
import { isMutation } from "./manifest";
import { RAW_MUTATION_GAP } from "./run";
const values = z.record(z.string(), z.unknown()).default({});
const result = z.unknown().nullable().default(null);
export const opsPageSchema = z.object({
  op: opsAddress.fields.op.schema,
  actionId: opsAddress.fields.actionId.schema,
  values,
  result,
});
export type OpsPage = z.output<typeof opsPageSchema>;
// ADR 0026 keeps Target kernel-owned; native execution waits for its optional session seam.
export const opsGraph: RouteGraph<OpsPage> = {
  key: "ops",
  address: "ops",
  name: "Ops",
  fields: {
    op: { ...opsAddress.fields.op, role: "subject", agent: false },
    actionId: { ...opsAddress.fields.actionId, role: "selection", agent: false },
    values: {
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
    catalog: { kind: "use", source: "ops.catalog", retire: "target" },
    receipt: { kind: "use", source: "ops.receipt", retire: "page", args: (page) => page.actionId },
    receipts: { kind: "use", source: "ops.receipts", retire: "never" },
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
    run: rpcVerb(
      opRead,
      {
        label: "Run",
        input: opReadInput.extend({ refusal: z.string().nullable().default(null) }),
        caller: "human",
        review: "none",
        chord: "Mod+Enter",
        effect: "query",
      },
      {
        ready: (_, input) => (isMutation(input.op) ? RAW_MUTATION_GAP : input.refusal),
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
      verbs: [],
    },
    operation: {
      label: "Operation",
      purpose: "Choose a catalog operation and inspect its request and result",
      draws: ["catalog"],
      verbs: [],
    },
    receipt: {
      label: "Receipt",
      purpose: "Inspect the original journaled action",
      draws: ["receipt"],
      verbs: [],
    },
    history: {
      label: "History",
      purpose: "Inspect operation invocations and receipts",
      draws: ["receipts"],
      verbs: [],
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
};
