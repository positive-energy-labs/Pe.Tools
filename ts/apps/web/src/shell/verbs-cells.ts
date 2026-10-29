import { z } from "zod";
import {
  availableTransitions,
  transitionPatches,
  type CellLike,
  type VerbDecl,
} from "@pe/agent-contracts";
import type { Cells } from "../route/cells";
import { workVerb, type VerbContext, type VerbSubject, type VerbScope } from "./verbs";

const transitions = { take: "take", reject: "unsuggest", reopen: "clear" } as const;
export type CellVerb = keyof typeof transitions | "delete";

/** Adds lifecycle verbs without per-route handlers. Domain commands remain route declarations. */
export function kernelCellVerbs<W>(cells: readonly Cells<W>[]): {
  verbs: Readonly<Record<string, VerbDecl>>;
  subjects: VerbContext["subjects"];
} {
  const verbs: Record<string, VerbDecl> = {};
  const subjects: Record<string, (value: unknown, subject: VerbSubject) => string | null> = {};
  for (const family of cells) {
    const prefix = family.segment === null ? [] : [family.segment];
    if (family.segment === null && !family.key) throw new Error("A root cell needs a key");
    const type = `cell:${family.segment ?? family.key}`;
    if (subjects[type]) throw new Error(`Duplicate cell family ${type}`);
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
    for (const kind of ["take", "reject", "reopen", "delete"] as const) {
      const patches = (scope: VerbScope) => {
        const cell = scope.value as CellLike;
        const key = scope.subject!.id;
        return kind === "delete"
          ? [{ path: [...prefix, key] }]
          : transitionPatches(prefix, key, cell, { kind: transitions[kind] });
      };
      verbs[`${type}.${kind}`] = workVerb(
        {
          subject: type,
          label: kind,
          input: z.strictObject({}).default({}),
          says: `${kind} this cell`,
        },
        {
          ready: (scope) => {
            if (
              kind !== "delete" &&
              !availableTransitions(scope.value as CellLike, { lock: null }).includes(
                transitions[kind],
              )
            )
              return `There is nothing to ${kind} on this cell`;
            return family.admit?.(scope.snapshot.work!.doc as W, patches(scope))?.message ?? null;
          },
          patches,
        },
      );
    }
  }
  return { verbs, subjects };
}
