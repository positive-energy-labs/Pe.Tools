import { contextFetch as fetch } from "@pe/runtime/context";
/** That capture file's exact stored text and path, by its already-validated ID. Read once. */
export async function readSavedTakeoffText(
  id: string,
  base = "",
  signal?: AbortSignal,
): Promise<{ path: string; text: string }> {
  const response = await fetch(
    `${base}/takeoffs/observations?capture=${encodeURIComponent(id)}&text=1`,
    { signal: signal ?? AbortSignal.timeout(30_000) },
  );
  if (!response.ok) throw Error(`Saved capture text read failed (${response.status})`);
  return (await response.json()) as { path: string; text: string };
}
