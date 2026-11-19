// Fixture surface composition only: the real sheet with read-only handles, no Revit transport.
import { createRoot } from "react-dom/client";
import { RegistryContext } from "@effect/atom-react";
import { designCalc } from "@pe/duct-systems-web/design-calc";
import { makeAtomRegistry } from "../../../../apps/web/src/shell/owner.ts";
import { SheetPane } from "../../../../apps/web/src/route/slots/sheet/pane.tsx";
import type { DrawContext, Fields } from "../../../../apps/web/src/route/typed-route.ts";

const { read, work } = await (await fetch("/jv3-inputs")).json();
// Read-only fixture handles: this journey neither stages nor applies anything.
const refuse = () => { throw Error("Read-only journey"); };
const ctx: DrawContext<unknown, Fields, Record<string, unknown>, unknown> = {
  target: null, read: refuse, absent: () => null, refresh: refuse, verb: refuse,
  selection: { read: () => [], set: refuse },
  page: { read: () => ({ selected: [] }), pose: refuse, query: refuse, select: refuse },
  value: { state: "ready", value: read, publication: null },
  cells: { doc: work, basis: null, state: { state: "ready", value: work },
    owner: () => ({ route: "duct-systems", label: "Work" }), label: refuse, edit: refuse, patch: refuse,
    at: (path) => ({
    owner: { route: "duct-systems", label: "Work" },
    facts: { readOnly: true }, freshness: "current", accept: refuse, deny: refuse, delete: refuse,
    value: path.reduce((v, key) => v?.[key], work) ?? {}, refusal: null,
    transitions: () => [], clear: refuse, stage: refuse,
  }) },
};
const root = document.getElementById("root");
if (!root) throw Error("Fixture root missing");
createRoot(root).render(
  <RegistryContext value={makeAtomRegistry()}>
    <SheetPane ctx={{ draw: ctx, slot: designCalc }} />
  </RegistryContext>,
);
