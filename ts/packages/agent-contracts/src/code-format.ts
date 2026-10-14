/** The one JSON pretty-printer shared by browser rendering and Host-readable Chat state. */
export function stringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return String(value);
  }
}
