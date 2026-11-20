import { createPeClient } from "@pe/agent-contracts/pe-api";
import { hostFetch } from "@pe/web-kernel/host/runtime";
export type { NavigationSnapshot, NavigationWork } from "@pe/agent-contracts";
export function navigationClient(origin: string) {
  const client = createPeClient(origin, hostFetch);
  return { read: (signal?: AbortSignal) => client.call("navigation.get", {}, { signal }) };
}
