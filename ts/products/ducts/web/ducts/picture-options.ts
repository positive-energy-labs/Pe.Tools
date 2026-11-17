import { DUCTS_LAYERS } from "@pe/agent-contracts";
const LAYER_WORDS: Record<
  (typeof DUCTS_LAYERS)[number],
  { label: string; chord?: "M" | "L"; off?: true }
> = {
  meshes: { label: "meshes", chord: "M" },
  "system-colours": { label: "system colours" },
  "stub-labels": { label: "stub labels" },
  centrelines: { label: "centrelines", chord: "L", off: true },
  "no-run": { label: "branches with no run" },
  labels: { label: "labels" },
  findings: { label: "findings" },
};

/** E's flat picture: the schematic one-line (`picture=schematic` on the URL). */
export const DUCTS_FLAT = { key: "schematic", label: "schematic" } as const;
export const DUCTS_LAYER_OPTIONS = DUCTS_LAYERS.map((key) => ({ key, ...LAYER_WORDS[key] }));
