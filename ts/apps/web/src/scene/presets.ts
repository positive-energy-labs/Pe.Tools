import type { SceneView } from "@pe/agent-contracts";
import type { Look } from "./grounds";

export const PRESETS = [
  { value: "all", label: "All context", title: "All captured context" },
  { value: "walls", label: "Walls only", title: "Walls and curtain wall context" },
  {
    value: "structural",
    label: "Structural only",
    title: "Columns, framing, foundations and floors",
  },
  {
    value: "no-lighting",
    label: "No lighting",
    title: "Context without lighting fixtures or devices",
  },
  {
    value: "nearby-structure",
    label: "Nearby structure + section",
    title: "Structural context near the open systems, sectioned to their bounds",
  },
  { value: "subject", label: "Subject only", title: "Open systems and their one-hop stubs" },
] as const;
export type ScenePreset = SceneView["preset"];

export function presetLook(look: Look, preset: ScenePreset): Look {
  const context =
    preset === "walls"
      ? "walls"
      : preset === "structural" || preset === "nearby-structure"
        ? "structural"
        : preset === "subject"
          ? "none"
          : look.layers.context;
  return {
    ...look,
    layers: {
      ...look.layers,
      context,
      lighting: preset === "no-lighting" ? false : look.layers.lighting,
    },
  };
}
