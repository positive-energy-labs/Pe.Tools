import type { DuctSnapshot } from "./types.ts";

/**
 * The one way a person reads a Revit element: its Mark (tag), else its type, family or category,
 * else its size and kind. Never an ElementId, UniqueId or connector index (Manual D #5 defect 7);
 * twins are told apart by level, system, then snapshot order, never by a key. Total: an id the snapshot
 * does not hold still reads as words.
 */
export function elementLabeler(snapshot: Pick<DuctSnapshot, "nodes" | "segments">& Partial<Pick<DuctSnapshot, "levels">>,
  options?: { unique: boolean },
) {
  const nodes = new Map(snapshot.nodes.map((node) => [node.id, node]));
  const segments = new Map(snapshot.segments.map((segment) => [segment.id, segment]));
  const base = (id: number): string => {
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
    const type = node.type?.trim();
    const named =
      options?.unique && type && /^\d+(?:\.\d+)?(?:\s*(?:in|inch|inches|["″]))?$/i.test(type)
        ? `${type} ${kind}`
        : type;
    if (node.kind === "fitting" || node.kind === "cap")
      return (
        (options?.unique && (named || node.family || node.category)) ||
        `${size ? `${size} ` : ""}${kind}`
      );
    return `${named || node.family || node.category || (size ? `${size} ${kind}` : kind)}${node.kind === "terminal" ? " grille" : ""}`;
  };
  if (!options?.unique) return base;
  const elements = [...snapshot.nodes, ...snapshot.segments];
  const bases = new Map(elements.map((e) => [e.id, base(e.id)]));
  const groups = new Map<string, typeof elements>();
  for (const e of elements) {
    const label = bases.get(e.id)!;
    const group = groups.get(label) ?? [];
    group.push(e);
    groups.set(label, group);
  }
  const level = (e: (typeof elements)[number]) =>
    snapshot.levels?.find((l) => l.id === e.levelId)?.name;
  return (id: number): string => {
    const label = bases.get(id) ?? "an element outside this read";
    const twins = groups.get(label) ?? [];
    if (twins.length < 2) return label;
    const element = twins.find((e) => e.id === id)!;
    const place = [level, (e: typeof element) => e.systemName]
      .map((f) => {
        const value = f(element);
        return value && twins.every((e) => e.id === id || f(e) !== value) ? value : null;
      } )
      .find(Boolean);
    return place
      ? `${label} · ${place}`
      : `${label} (${twins.indexOf(element) + 1} of ${twins.length})`;
  };
}
