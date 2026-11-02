import type { DuctSnapshot } from "./types.ts";

/**
 * The one way a person reads a Revit element: its Mark (tag), else its type, family or category,
 * else its size and kind. Never an ElementId, UniqueId or connector index (Manual D #5 defect 7);
 * twins are told apart by where they are (`fanLabel`), not by a key. Total: an id the snapshot
 * does not hold still reads as words.
 */
export function elementLabeler(snapshot: Pick<DuctSnapshot, "nodes" | "segments">) {
  const nodes = new Map(snapshot.nodes.map((node) => [node.id, node]));
  const segments = new Map(snapshot.segments.map((segment) => [segment.id, segment]));
  return (id: number): string => {
    const node = nodes.get(id);
    if (!node) {
      const segment = segments.get(id);
      if (!segment) return "an element outside this read";
      const size = (segment.size ?? "").replaceAll('"', "″").replaceAll("ø", "").trim();
      return `${size ? `${size} ` : ""}${segment.kind ?? "duct"}`;
    }
    // The collector's mark fact already prefers PE_G___TagInstance over built-in Mark.
    const mark = node.label || node.facts?.find((f) => f.key === "mark")?.text?.trim();
    const kind = node.kind === "terminal" ? "grille" : node.partType?.toLowerCase() || node.kind;
    // A unit's tag already says what it is (FC-15); a tagged part still says its kind (RV-6 grille).
    if (mark) return node.kind === "equipment" ? mark : `${mark} ${kind}`;
    const port = node.connectors?.[0];
    const inches = (n: number) => Math.round(n * 100) / 100;
    const size =
      port?.widthIn && port.heightIn
        ? `${inches(port.widthIn)}×${inches(port.heightIn)}`
        : port?.diameterIn
          ? `${inches(port.diameterIn)}″`
          : port?.size?.replaceAll('"', "″").replace(/\s*[xX]\s*/g, "×");
    if (node.kind === "fitting" || node.kind === "cap") return `${size ? `${size} ` : ""}${kind}`;
    return `${node.type || node.family || node.category || kind}${node.kind === "terminal" ? " grille" : ""}`;
  };
}
