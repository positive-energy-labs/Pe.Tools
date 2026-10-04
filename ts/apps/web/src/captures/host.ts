/** The captures route's one reach to the host: the kept receipts, newest first. */
import { captureListSchema, type CaptureReceipt } from "@pe/agent-contracts";

export async function readCaptures(): Promise<CaptureReceipt[]> {
  const response = await fetch("/captures", { headers: { accept: "application/json" } });
  const body = (await response.json().catch(() => null)) as unknown;
  if (!response.ok)
    throw Error(
      (body as { title?: string } | null)?.title ?? `GET /captures answered ${response.status}`,
    );
  return captureListSchema.parse(body).captures;
}
