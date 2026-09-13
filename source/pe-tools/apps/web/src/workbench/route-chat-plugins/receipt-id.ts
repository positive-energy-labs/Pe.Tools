/** Pure receipt-identity extraction, kept leaf-side so a derivation can import it without the
 * plugin chrome (and the design tokens that chrome reads at module scope). */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function actionReceiptId(args: unknown, result: unknown): string | undefined {
  const raw =
    isRecord(result) && isRecord(result.structuredContent) ? result.structuredContent : result;
  const row = isRecord(raw) && isRecord(raw.result) ? raw.result : raw;
  if (isRecord(row) && isRecord(row.action) && typeof row.action.id === "string")
    return row.action.id;
  if (isRecord(row) && typeof row.id === "string") return row.id;
  const input = isRecord(args) && isRecord(args.input) ? args.input : null;
  return typeof input?.actionId === "string"
    ? input.actionId
    : typeof input?.id === "string"
      ? input.id
      : undefined;
}
