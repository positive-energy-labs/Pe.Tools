/** Update mutation only. Machine owns checks and durable receipt recovery. */
export async function acknowledgeUpdate(planId: string): Promise<string> {
  const response = await fetch("/host/update", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ planId }),
  });
  const body = (await response.json()) as {
    accepted?: boolean;
    requestId?: string;
    error?: string;
  };
  if (!response.ok || body.accepted !== true || !body.requestId)
    throw new Error(body.error ?? `update admission failed (${response.status})`);
  return body.requestId;
}
