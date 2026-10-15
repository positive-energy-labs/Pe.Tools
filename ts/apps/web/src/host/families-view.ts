import { peClient } from "./pe-client";
import type { FamiliesView } from "@pe/agent-contracts";
export async function publishFamiliesView(body: FamiliesView): Promise<number> {
  return (await peClient.call("view.publish", { body })).revision as number;
}
export async function releaseFamiliesView(instance: string): Promise<void> {
  await peClient.call("view.remove", { params: { instance } }, { keepalive: true });
}
export async function acknowledgeFamiliesQuery(body: {
  instance: string;
  commandId: string;
  revision: number;
  query: string;
  counts: FamiliesView["counts"];
}): Promise<void> {
  await peClient.call("view.ack", { body });
}
