// Fixture surface composition only: the real sheet with read-only handles, no Revit transport.
import { createRoot } from "react-dom/client";
import { RegistryContext } from "@effect/atom-react";
import { designCalc } from "@pe/duct-systems-web/design-calc";
import { makeAtomRegistry } from "../../../apps/web/src/shell/owner.ts";
import { SheetPane } from "../../../apps/web/src/route/slots/sheet/pane.tsx";

const { read, work } = await (await fetch("/jv3-inputs")).json();
// Read-only fixture handles: this journey neither stages nor applies anything.
const ctx = {
  page: { read: () => ({}) },
  value: { state: "ready", value: read },
  cells: { doc: work, at: (path: string[]) => ({
    owner: { route: "duct-systems", label: "Work" },
    value: path.reduce((v, key) => v?.[key], work) ?? {}, refusal: null,
    transitions: () => [], clear: async () => ({ message: "Read-only journey" }),
    stage: async () => ({ message: "Read-only journey" }),
  }) },
};
createRoot(document.getElementById("root")!).render(
  <RegistryContext value={makeAtomRegistry()}>
    <SheetPane ctx={{ draw: ctx as never, slot: designCalc }} />
  </RegistryContext>,
);
