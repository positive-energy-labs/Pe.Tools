import { familyCaptureSchema, familyReads, type FamilyReadKey, type WorkKey, type DocumentRef } from "@pe/agent-contracts";
import { contextFetch as fetch } from "@pe/runtime/context";

export async function readFamilyCapture(
  key: FamilyReadKey,
  input: unknown,
  scope: WorkKey,
  target?: DocumentRef,
  base = "",
) {
  const response = await fetch(`${base}/family/readings`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ key, input, scope, target }),
  });
  const value = await response.json();
  if (!response.ok)
    throw Object.assign(
      Error((value as { error?: string }).error ?? `Family read failed (${response.status})`),
      { status: response.status },
    );
  if (key === "family.read") return familyReads[key].result.parse(value);
  if (key === "family.cancel-read") return familyReads[key].result.parse(value);
  return familyCaptureSchema.parse(value);
}

