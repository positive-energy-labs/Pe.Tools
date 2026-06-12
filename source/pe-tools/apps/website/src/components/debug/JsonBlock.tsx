export function JsonBlock({ value }: { value: unknown }) {
  return <pre className="json-block">{formatJson(value)}</pre>;
}

export function formatJson(value: unknown): string {
  if (typeof value === "string") return value;
  return JSON.stringify(value, null, 2) ?? "null";
}
