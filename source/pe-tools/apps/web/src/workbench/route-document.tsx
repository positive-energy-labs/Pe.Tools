import { useMemo } from "react";

import { EmptyState } from "#/components/lang/empty";
import { useFleet } from "#/host/fleet";
import { documentAddress } from "#/host/target";

export function useRouteDocumentAddress() {
  const { sessions } = useFleet();
  return useMemo(() => {
    const addresses = [...new Set(sessions.map(documentAddress).filter((at) => at !== null))];
    return addresses.length === 1 ? addresses[0]! : null;
  }, [sessions]);
}

export function RouteDocumentEmpty() {
  return (
    <main className="grid min-h-screen place-items-center bg-[var(--r-page)] font-pe">
      <EmptyState story="scope" exit="open a Revit document, then return here">
        pick a document
      </EmptyState>
    </main>
  );
}
