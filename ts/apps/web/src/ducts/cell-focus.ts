import { scopeOf } from "@pe/ducts-domain/system-scope";
import type { DuctSnapshot } from "@pe/ducts-domain/types";
import { elementKey,type SubjectKey } from "@pe/kit/lang/attention";
import { z } from "zod";
import type { CellRef } from "./inbox-rows";

const address = z.tuple([
  z.literal("cell"),
  z.enum(["flows", "terminalDrops", "equipmentFlows", "esp", "roles", "componentDrops"]),
  z.coerce.number().int().positive(),
  z.enum(["inputs", "this", "all"]),
]);

/** A cell jump is a semantic selection, retained even when its pane is absent. */
export function cellFocusSubject(
  snapshot: DuctSnapshot,
  systems: readonly string[],
  cell: CellRef,
) {
  const pane =
    cell.segment === "componentDrops"
      ? scopeOf(snapshot, systems)?.members.has(cell.id)
        ? "this"
        : "all"
      : "inputs";
  return `cell:${cell.segment}:${cell.id}:${pane}`;
}

/** Local identities carry opaque text; decode its cell meaning at this boundary once. */
export function cellFocusOf(subject: string) {
  const decoded = address.safeParse(subject.split(":"));
  return decoded.success
    ? { segment: decoded.data[1], id: decoded.data[2], pane: decoded.data[3], key: subject }
    : null;
}

export function focusedElement(subject: string): number | null {
  return cellFocusOf(subject)?.id ?? (/^\d+$/.test(subject) ? Number(subject) : null);
}

export function attentionSubjects(subjects: readonly string[]): ReadonlySet<SubjectKey> {
  return new Set(
    subjects.map((subject): SubjectKey => {
      const element = focusedElement(subject);
      if (element != null) return elementKey(element);
      const colon = subject.indexOf(":");
      return colon < 0
        ? `issue:${subject}`
        : `${subject.slice(0, colon)}:${subject.slice(colon + 1)}`;
    }),
  );
}
