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
  if (!response.ok || body.accepted !== true || !body.requestId || body.error)
    throw new Error(
      `${body.error ?? `update admission failed (${response.status})`}${body.requestId ? ` (request ${body.requestId})` : ""}`,
    );
  return body.requestId;
}

export async function recheckUpdate(): Promise<void> {
  const response = await fetch("/host/update?recheck=1");
  const body = (await response.json()) as { planLeg?: { error: string | null } };
  if (!response.ok || body.planLeg?.error)
    throw Error(body.planLeg?.error ?? `Update check failed (${response.status}).`);
}
