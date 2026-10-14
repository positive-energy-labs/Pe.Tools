import type { PluginHooks, ReceiptReader } from "@pe/agent-contracts";
/** Only committed terminal operation facts are observed. Queue/start and replay revisions never fire. */
export function observePluginOperations(
  source: ReceiptReader,
  emit: (name: "op.after", event: PluginHooks["op.after"]) => Promise<void>,
) {
  const seen = new Set<string>();
  return source.subscribe({}, (receipt) => {
    const body = receipt.body;
    const operation =
      body.kind === "action" && body.value.state !== "running"
        ? {
            key: body.value.key,
            outcome: body.value.state,
            ...("result" in body.value ? { result: body.value.result } : {}),
          }
        : body.kind === "usage" && body.event === "host_op"
          ? { key: body.counters.op ?? "unknown", outcome: body.counters.outcome ?? "unknown" }
          : undefined;
    if (!operation || seen.has(receipt.join.requestId)) return;
    seen.add(receipt.join.requestId);
    void emit("op.after", {
      receiptId: receipt.id,
      revision: receipt.revision,
      kind: body.kind,
      ...operation,
    });
  });
}
