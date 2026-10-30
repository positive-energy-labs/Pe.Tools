import { isTsOnlyOperationKey } from "@pe/host-contracts/operation-types";
import type { ReadingState } from "#/shell/readings";
import { useList } from "@pe/kit/lang/collection";
import { ListView } from "@pe/kit/lang/list-view";
import { Button } from "@pe/kit/lang/button";
import { Code, stringify } from "@pe/kit/lang/code";
import { EmptyState } from "@pe/kit/lang/empty";
import type { ActionReceipt, ActionStatus } from "@pe/agent-contracts";
import { routeFromGraph, type MountBody, type RouteAdapters } from "#/shell/mount";
import { opsGraph, type OpsPage } from "./graph";
import { requestOf } from "./form";
import { OpsBody } from "./workspace";
import { opsSources, type OpsCatalog } from "./sources";
import { outputRenderers } from "./renderers";
function ReceiptsBody({ owner, page }: MountBody<OpsPage, unknown>) {
  const reading = owner.readings.get("receipts") as ReadingState<ActionStatus[]>;
  const list = useList({
    items: reading.value ?? reading.previous ?? [],
    keyOf: (row) => row.id,
    search: (row) => ({ text: [row.key, row.state, row.id] }),
    select: "single",
    followSelection: { key: page.actionId || null },
    onPick: (row) => owner.view.setPage({ actionId: row.id }),
  });
  return (
    <ListView
      list={list}
      aria-label="Operation receipts"
      empty={{
        message: reading.error ?? "No receipts",
        exit: "Run a semantic command to create a receipt",
      }}
      row={(row) => ({
        label: row.key,
        meta: row.state,
        sub: row.startedAt,
        title: row.id,
        lines: 2,
      })}
    />
  );
}
function ReceiptBody({ owner, page }: MountBody<OpsPage, unknown>) {
  const reading = owner.readings.get("receipt") as ReadingState<ActionReceipt[]>;
  const receipts = reading.value ?? reading.previous ?? [];
  const receipt = receipts.find((row) => row.id === page.actionId);
  if (!receipt)
    return (
      <EmptyState story="scope" exit="open an actionId link to inspect its original receipt">
        no receipt selected
      </EmptyState>
    );
  const Output = outputRenderers[receipt.key];
  return (
    <div>
      <p>
        {receipt.key} / {receipt.state}
      </p>
      {Output && "result" in receipt ? (
        <Output data={receipt.result} opKey={receipt.key} request={receipt.input} />
      ) : null}
      <Code code={stringify(receipt)} lang="json" />
      {(["action.read", "action.recover", "action.resume", "action.cancel"] as const).map((key) => {
        const allowed =
          key === "action.read" ||
          (key === "action.recover" && receipt.state === "unknown") ||
          (key === "action.resume" && ["unknown", "incomplete"].includes(receipt.state)) ||
          (key === "action.cancel" && ["waiting", "running"].includes(receipt.state));
        const control = owner.control("control", { key, id: receipt.id });
        const label = {
          "action.read": "read status",
          "action.recover": "recover native receipt",
          "action.resume": "resume original action",
          "action.cancel": "stop this action",
        }[key];
        return (
          <Button
            key={key}
            label={label}
            refusal={
              !allowed ? "This control does not apply to the action's state" : control.refusal
            }
            onClick={() => void control.run()}
          >
            {label}
          </Button>
        );
      })}
    </div>
  );
}
export const opsAdapters: RouteAdapters<OpsPage, unknown> = {
  sources: opsSources(),
  binding: (id, row, scope) => {
    if (id === "control") return { subject: null, args: row };
    const catalog = scope.readings.catalog;
    const selected = (catalog?.value as OpsCatalog | undefined)?.operations?.find(
      (op) => op.key === scope.page.op,
    );
    let request: unknown = {};
    let refusal = !catalog?.current
      ? "Refresh the operation catalog"
      : !selected
        ? "Pick an operation"
        : !selected.intent
          ? "Operation readiness metadata is unavailable"
          : null;
    if (selected && !isTsOnlyOperationKey(selected.key) && scope.target.kind === "host")
      refusal = "Choose a session or document for this native operation";
    try {
      request = requestOf(scope.page.values);
    } catch (error) {
      refusal = String(error);
    }
    return { subject: null, args: { op: selected, request, refusal } };
  },
  verbDepends: { run: ["catalog"] },
  bodies: {
    receipts: (body) => <ReceiptsBody {...body} />,
    operation: (body) => <OpsBody {...body} />,
    receipt: (body) => <ReceiptBody {...body} />,
  },
};
export const opsRoute = routeFromGraph(opsGraph, opsAdapters, "/ops");
