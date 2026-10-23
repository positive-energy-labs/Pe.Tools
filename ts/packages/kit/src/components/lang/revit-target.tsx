import { createContext, useContext, type ReactNode } from "react";

/** Structural projection of native element handles; kit owns no document resolution. */
export type RevitElementReference = {
  elementId: number | null;
  uniqueId?: string | null;
  documentKey?: string;
  kind?: string;
  linkInstanceIds?: readonly number[];
};

/** Native identity wins over a presentation key; never parse ids out of composite keys. */
export function rowRevit(row: unknown, key?: string): readonly number[] | undefined {
  if (row && typeof row === "object") {
    const fields = row as Record<string, unknown>;
    for (const name of ["revit", "ids"])
      if (Array.isArray(fields[name]) && fields[name].every(Number.isSafeInteger))
        return fields[name];
    for (const name of ["elementId", "targetElementId"])
      if (name in fields)
        return Number.isSafeInteger(fields[name]) && (fields[name] as number) > 0
          ? [fields[name] as number]
          : [];
    // Wrappers may carry one native identity (e.g. a record plus its observed subject).
    const subjects = Object.values(fields).filter(
      (value): value is RevitElementReference =>
        !!value && typeof value === "object" && "elementId" in value,
    );
    if (subjects.length === 1) return rowRevit(subjects[0]);
    if (subjects.length > 1) return [];
  }
  const id = key && /^\d+$/.test(key) ? Number(key) : NaN;
  return Number.isSafeInteger(id) && id > 0 ? [id] : undefined;
}

/** The attribute the app's element menu reads: put it on any element that stands for Revit elements. */
export const revitTarget = (
  ids: readonly number[] | null | undefined,
  refs?: readonly RevitElementReference[],
) => ({
  "data-revit-ids": ids?.length ? ids.join(",") : undefined,
  "data-revit-refs": refs?.length ? JSON.stringify(refs) : undefined,
});

/** A displayed observation's scope, including explicit null boundaries. */
const RevitScopeContext = createContext<object | null>(null);

/** Layout-transparent target boundary; ids can never be declared without their scope. */
export function RevitTarget({
  ids,
  refs,
  scope,
  children,
}: {
  ids?: readonly number[];
  refs?: readonly RevitElementReference[];
  scope: object | null;
  children: ReactNode;
}) {
  return (
    <RevitScopeContext value={scope}>
      <div
        data-revit-target=""
        data-revit-scope={JSON.stringify(scope)}
        {...revitTarget(ids, refs)}
      >
        {children}
      </div>
    </RevitScopeContext>
  );
}

/** Copy the captured scope onto targets, including targets rendered through portals. */
export function useRevitTarget(ids?: readonly number[], refs?: readonly RevitElementReference[]) {
  const scope = useContext(RevitScopeContext);
  return { ...revitTarget(ids, refs), "data-revit-scope": JSON.stringify(scope) };
}
