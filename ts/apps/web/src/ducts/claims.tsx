/** Element names. SubjectText owns prose references and attention. A claim is a finding now (ADR 0035 rule 9). */
import { snapshotById } from "@pe/ducts-domain/readiness";
import type { DuctSnapshot } from "@pe/ducts-domain/types";
import type { Place } from "./legs";
import type { SubjectDrawn } from "./scene";

const KIND_WORD: Record<DuctSnapshot["nodes"][number]["kind"], string> = {
  equipment: "equipment",
  terminal: "terminal",
  fitting: "fitting",
  accessory: "accessory",
  cap: "end cap",
};
/** A unit or grille with no label or mark reads by what it is: its family and type ('Price LBP15A Supply 16 X 8'). */
export const typeName = (node: { family?: string | null; type?: string | null }) => {
  // A Revit-internal family name (`Damper_Volume_Round`) is not a person's word; its type is.
  const family = node.family?.includes("_") && node.type?.trim() ? null : node.family;
  return [...new Set([family, node.type].map((v) => v?.trim()).filter(Boolean))].join(" ");
};
const ELEMENT_PLACES = new Set<Place["kind"]>(["equipment", "accessory", "terminal", "cap"]);

/**
 * A person's name for any snapshot element, null when the id is not in the snapshot: the node's
 * label, else its place name in the cut (never a `kind id` fallback), else a short kind (`end cap`,
 * `10″ duct`).
 */
export function elementNamer(snapshot: DuctSnapshot, subject: SubjectDrawn | null) {
  const { nodes, segments } = snapshotById(snapshot);
  return (id: number): string | null => {
    const node = nodes.get(id);
    if (node?.label) return node.label;
    // A unit is named by its Mark (FC-17), never by its kind.
    const mark = node?.facts.find((f) => f.key === "mark")?.text;
    if (mark) return mark;
    const place = subject?.placeOf.get(id);
    if (place && ELEMENT_PLACES.has(place.kind) && !place.name.endsWith(String(id)))
      return place.name;
    if (
      node &&
      (node.kind === "equipment" || node.kind === "terminal" || node.kind === "accessory")
    ) {
      const typed = typeName(node);
      if (typed) return typed;
    }
    if (node) return KIND_WORD[node.kind];
    const segment = segments.get(id);
    if (!segment) return null;
    const size = segment.size.replaceAll('"', "″").replaceAll("ø", "").trim();
    return `${size ? `${size} ` : ""}${segment.kind}`;
  };
}
