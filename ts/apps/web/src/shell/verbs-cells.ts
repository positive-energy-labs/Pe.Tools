import { z } from "zod";
import {
  CELL_VERB_KINDS,
  cellSubjectType,
  cellVerbId,
  cellPatches,
  type CellLike,
  type CellsDecl,
  type VerbDecl,
} from "@pe/agent-contracts";
import { workVerb, type VerbContext, type VerbSubject, type VerbScope } from "./verbs";

export type CellVerb = "clear" | "delete";

/**
 * Derives lifecycle verbs from `graph.cells`, the only authority; no per-route handlers.
 * `placement` maps a cell row's subject type to the verb ids that row carries (chord-free).
 * Domain commands remain route declarations.
 */
export function kernelCellVerbs<W>(graph: { readonly cells?: readonly CellsDecl<W>[] }): {
  verbs: Readonly<Record<string, VerbDecl>>;
  subjects: VerbContext["subjects"];
  placement: Readonly<Record<string, readonly string[]>>;
} {
  const placement: Record<string, string[]> = {};
  const verbs: Record<string, VerbDecl> = {};
  const subjects: Record<string, (value: unknown, subject: VerbSubject) => string | null> = {};
  for (const family of graph.cells ?? []) {
    const prefix = family.segment === null ? [] : [family.segment];
    if (family.segment === null && !family.key) throw new Error("A root cell needs a key");
    const type = cellSubjectType(family);
    if (subjects[type]) throw new Error(`Duplicate cell family ${type}`);
    placement[type] = [];
    subjects[type] = (value, subject) =>
      value !== null &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      subject.path.length === prefix.length + 1 &&
      prefix.every((key, index) => subject.path[index] === key) &&
      (family.segment !== null || subject.id === family.key) &&
      subject.path.at(-1) === subject.id
        ? subject.id
        : null;
    for (const kind of CELL_VERB_KINDS) {
      const patches = (scope: VerbScope) => {
        const cell = scope.value as CellLike;
        const key = scope.subject!.id;
        return kind === "delete"
          ? [{ path: [...prefix, key] }]
          : cellPatches(prefix, key, cell, { kind: "clear" });
      };
      const id = cellVerbId(family, kind);
      placement[type]!.push(id);
      verbs[id] = workVerb(
        {
          subject: type,
          label: kind,
          input: z.strictObject({}).default({}),
          says: `${kind} this cell`,
        },
        {
          ready: (scope) => {
            if (kind === "clear" && (scope.value as CellLike).edit == null)
              return `There is nothing to ${kind} on this cell`;
            return family.admit?.(scope.snapshot.work!.doc as W, patches(scope))?.message ?? null;
          },
          patches,
          history: {
            describe: (scope) => ({
              label: `${kind} ${family.label?.(scope.subject!.id) ?? scope.subject!.id}`,
            }),
          },
        },
      );
    }
  }
  return { verbs, subjects, placement };
}
