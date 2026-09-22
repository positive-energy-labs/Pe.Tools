import { peUrl, type WorkbenchEndpointConfig } from "#/workbench/config.ts";

export interface PeInspect {
  systemPrompt?: { content?: string; source?: string; updatedAt?: string };
  toolList?: { tools?: unknown[] };
  skills?: unknown[];
  observationalMemory?: Record<string, unknown>;
  contextWindow?: number;
  agents?: unknown[];
}

export async function fetchPeInspect(config: WorkbenchEndpointConfig): Promise<PeInspect> {
  const response = await fetch(peUrl(config, "/inspect"), {
    headers: { Accept: "application/json" },
  });
  if (!response.ok) return {};
  return (await response.json().catch(() => ({}))) as PeInspect;
}
