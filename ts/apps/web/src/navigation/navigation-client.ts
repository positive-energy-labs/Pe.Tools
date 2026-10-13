import { navigationSnapshotSchema } from "@pe/agent-contracts";
import { hostFetch } from "#/host/runtime";

export type { NavigationSnapshot, NavigationWork, NavigationThread } from "@pe/agent-contracts";

export function navigationClient(origin: string) {
  return {
    async read(signal?: AbortSignal) {
      const response = await hostFetch(`${origin}/pe/navigation`, { signal });
      if (!response.ok) throw new Error(`Navigation unavailable (${response.status})`);
      return navigationSnapshotSchema.parse(await response.json());
    },
  };
}
