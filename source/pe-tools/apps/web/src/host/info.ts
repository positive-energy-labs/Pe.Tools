import { useQuery } from "@tanstack/react-query";
import { peInfoSchema } from "@pe/agent-contracts";

import { peUrl, resolveWorkbenchConfig, type WorkbenchEndpointConfig } from "#/workbench/config";

export async function fetchPeInfo(config: WorkbenchEndpointConfig) {
  const url = peUrl(config, "/info");
  const response = await fetch(url, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${url}`);
  return peInfoSchema.parse(await response.json());
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
