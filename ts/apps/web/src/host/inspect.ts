export interface PeInspect {
  systemPrompt?: { content?: string; source?: string; updatedAt?: string };
  toolList?: { tools?: unknown[] };
  skills?: unknown[];
  observationalMemory?: Record<string, unknown>;
  contextWindow?: number;
  agents?: unknown[];
}
