import { useQuery } from "@tanstack/react-query";
import { peInfoSchema } from "@pe/agent-contracts";

import {
  resolveWorkbenchConfig,
  workbenchUrl,
  type WorkbenchEndpointConfig,
} from "#/workbench/config";

export async function fetchPeInfo(config: WorkbenchEndpointConfig) {
  const url = workbenchUrl(config, "/host/status");
  const response = await fetch(url, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${url}`);
  const status = (await response.json()) as Record<string, unknown>;
  return peInfoSchema.parse({
    controllerId: status.controllerId,
    resourceId: status.resourceId,
    capabilities: status.capabilities,
    world: status.world,
  });
}

export function usePeInfo(config: WorkbenchEndpointConfig = resolveWorkbenchConfig()) {
  return useQuery({
    queryKey: ["pe-info", config.origin],
    queryFn: () => fetchPeInfo(config),
    enabled: typeof window !== "undefined",
    retry: false,
    staleTime: Infinity,
  });
}
