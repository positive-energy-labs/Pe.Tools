import { hostFetch } from "#/host/runtime";
import { peClient } from "./pe-client";
import { readPeError } from "@pe/host-contracts/pe-api";
import { hostDescriptorSchema } from "@pe/host-contracts/host-descriptor";
/** Update mutation only. Machine owns checks and durable receipt recovery. */
export async function acknowledgeUpdate(planId: string): Promise<string> {
  const response = await hostFetch("/host/update", {
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
  const response = await hostFetch("/host/update?recheck=1");
  const body = (await response.json()) as { planLeg?: { error: string | null } };
  if (!response.ok || body.planLeg?.error)
    throw Error(body.planLeg?.error ?? `Update check failed (${response.status}).`);
}

export type SuccessorProbe = "down" | "same" | "successor";

/**
 * One cheap read of the host while an install has it gone. This page's JS names the old runtime
 * service, so a successor host refuses it (403 `runtime.owner-mismatch`) - which is itself the proof
 * a different build is up. A host that answers 200 is the successor only if its version differs.
 */
export async function probeSuccessor(version: string | null): Promise<SuccessorProbe> {
  try {
    const response = await peClient.response(
      "features.get",
      {},
      { signal: AbortSignal.timeout(3_000) },
    );
    if (response.status === 403)
      return (await readPeError(response)).code === "runtime.owner-mismatch" ? "successor" : "down";
    if (!response.ok) return "down";
    return hostDescriptorSchema.parse(await response.json()).version !== version
      ? "successor"
      : "same";
  } catch {
    return "down";
  }
}
