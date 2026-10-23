import { createContext, useContext, type ReactNode } from "react";

/** Structural projection of native element handles; kit owns no document resolution. */
export type RevitElementReference = {
  elementId: number | null;
  uniqueId?: string | null;
  documentKey?: string;
  kind?: string;
  linkInstanceIds?: readonly number[];
};

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
