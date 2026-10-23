import type { DuctSnapshot } from "@pe/ducts-domain/types";
import { elementNamer } from "./claims";
import type { NoRunBranch } from "@pe/ducts-domain/no-runs";

export type SubjectPart = string | { id: number; connector?: number };
export type SubjectReference = { id: number; name: string; number: number };
export type SubjectDocument = {
  parts: (string | (SubjectReference & { connector?: number }))[];
  references: SubjectReference[];
};

/** No-run reasons already identify their subject; only compound/free explanations need parsing. */
export function noRunParts(branch: NoRunBranch, snapshot: DuctSnapshot): SubjectPart[] {
  const parts: SubjectPart[] = [];
  for (const reason of branch.reasons) {
    if (parts.length) parts.push("; ");
    const element = [...snapshot.nodes, ...snapshot.segments].find((e) => e.id === reason.at);
    if (reason.kind === "open") {
      const ports = element?.connectors.filter((c) => !c.connectedTo && c.kind !== "curve") ?? [];
      // The reason's connector suffix disambiguates multiple open ends on the same element.
      const port = ports.find((c) => reason.text.endsWith(`:${c.index}`));
      parts.push("Ends open at ", { id: reason.at, connector: port?.index });
    } else if (reason.kind === "capped") parts.push("Ends capped at ", { id: reason.at });
    else if (reason.kind === "flowless-terminal")
      parts.push("Ends at ", { id: reason.at }, " with no design flow");
    else if (reason.kind === "foreign-terminal")
      parts.push("Ends at ", { id: reason.at }, ` on ${element?.systemName || "no system"}`);
    else parts.push(reason.text);
  }
  return parts;
}

/** Short element names; numbering, rather than an id or a long family path, distinguishes twins. */
export function subjectNamer(snapshot: DuctSnapshot) {
  const fallback = elementNamer(snapshot, null);
  const nodes = new Map(snapshot.nodes.map((node) => [node.id, node]));
  return (id: number): string | null => {
    const node = nodes.get(id);
    if (!node) return fallback(id);
    const mark = node.label || node.facts.find((f) => f.key === "mark")?.text;
    const kind = node.kind === "terminal" ? "grille" : node.partType?.toLowerCase() || node.kind;
    // A unit's tag already says what it is (FC-15); a tagged part still says its kind (RV-6 grille).
    if (mark) return node.kind === "equipment" ? mark : `${mark} ${kind}`;
    const port = node.connectors[0];
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

/** Structured references first; numbers in free prose resolve only when the snapshot knows them. */
export function subjectDocument(
  source: readonly SubjectPart[],
  nameOf: (id: number) => string | null,
  ids: readonly number[] = [],
  numbering: readonly SubjectReference[] = [],
): SubjectDocument {
  const references: SubjectReference[] = [...numbering];
  const parts: SubjectDocument["parts"] = [];
  const seen = new Set<number>();
  const reference = (id: number, connector?: number): boolean => {
    const name = nameOf(id);
    if (!name) return false;
    let ref = references.find((r) => r.id === id);
    if (!ref) {
      ref = { id, name, number: references.length + 1 };
      references.push(ref);
    }
    seen.add(id);
    parts.push({ ...ref, connector });
    return true;
  };
  for (const part of source) {
    if (typeof part !== "string") {
      if (!reference(part.id, part.connector)) parts.push(`element ${part.id} (not in snapshot)`);
      continue;
    }
    let at = 0;
    for (const match of part.matchAll(/(?<![\w.])\d+(?::\d+)?(?!\w|\.\d)/g)) {
      const [id, connector] = match[0].split(":").map(Number);
      if (!nameOf(id!)) continue;
      parts.push(part.slice(at, match.index));
      reference(id!, connector);
      at = match.index + match[0].length;
    }
    parts.push(part.slice(at));
  }
  // Rows know their subjects even when the description contains no id (e.g. "No flow").
  for (const id of new Set(ids)) {
    if (seen.has(id) || !nameOf(id)) continue;
    parts.push(seen.size ? ", " : " · ");
    reference(id);
  }
  return { parts, references };
}
