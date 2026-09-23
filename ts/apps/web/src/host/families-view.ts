import type { FamiliesView } from "@pe/agent-contracts";
import { peUrl, resolveWorkbenchConfig } from "#/workbench/config";

const url = (path = "") => peUrl(resolveWorkbenchConfig(), `/route-view/families${path}`);

export async function publishFamiliesView(view: FamiliesView): Promise<number> {
  const response = await fetch(url(), {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(view),
  });
  if (!response.ok) throw Error("Families view lease failed");
  return ((await response.json()) as { revision: number }).revision;
}

export async function releaseFamiliesView(instance: string): Promise<void> {
  await fetch(url(`/${instance}`), { method: "DELETE", keepalive: true });
}

export async function acknowledgeFamiliesRules(input: {
  instance: string;
  commandId: string;
  revision: number;
  rules: string;
  counts: FamiliesView["counts"];
}): Promise<void> {
  const response = await fetch(url("/ack"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) throw Error("Families rule acknowledgement refused");
}
