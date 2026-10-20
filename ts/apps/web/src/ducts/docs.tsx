/**
 * The ducts help page body (Alt+/): why Pe computes duct pressure drop instead of Revit, what each
 * part of a duct path needs and where its data is, and the open decisions. Parts and statuses come
 * from the product map (`@pe/agent-contracts/product-map`); the record behind each claim is
 * `docs/features/pressure-drop/LEDGER.md` and `WHY-NOT-REVIT.md`.
 */
import { mapLink } from "@pe/agent-contracts/product-map";
import { Legend, Mermaid, PartsTable, chainChart, pathChart } from "#/product-map/diagram";

const PRESSURE_DROP = mapLink("pressure-drop")!;

const DECISIONS: [string, string][] = [
  [
    "Rules stay fixed. A firm adds its own rule instead of changing a table.",
    "Today a person can change the ASHRAE table under a rule, because a Revit family does not say which tested fitting it is. A double-vaned mitered elbow could be CR3-14, 15 or 16 (C 0.38, 0.25, 0.41). Proposal: shipped rules never change, and a firm rule (a family and condition filter, built on the master table's filter bar) overrides a shipped one.",
  ],
  [
    "One loss engine. Decided 2026-10-16.",
    "Pe computes every loss; Revit stores the results. Apply saves each fitting's C per path (a tee's straight and branch paths separately), and Pe's loss server only hands Revit that stored C. Revit still applies its own live velocity, but C updates only on the next apply, and the route flags fittings that are out of date. A PC without Pe shows Revit's missing-server dialog and charges 0.",
  ],
  [
    "Grille performance data.",
    "Where the catalog tables live for the whole firm, how they get in (Pea reads the manufacturer PDF and cites the page), and what to do past the catalog's sizes.",
  ],
  [
    "Inline equipment drops.",
    "Where a coil, filter or dehumidifier drop comes from, where it is stored, and how to avoid counting what the unit's rating already includes.",
  ],
  [
    "A role per unit: fan, inline, or its own system.",
    "Set from the unit type and overridable by a person. Pe's current guess would treat an ERV ducted into a fan coil as a passive part.",
  ],
  [
    "Where design airflow comes from.",
    "For now, the Load Preview split. Later, each grille gets its flow from its room through the rooms and zoning work.",
  ],
  [
    "Where staged inputs live.",
    "Pasted loads, overrides and table choices stay on one computer until apply. Should they be saved with the model before that?",
  ],
  [
    "The fan's available static.",
    "Needed to check the required static. Comes from equipment selection.",
  ],
];

export function DuctsDocs() {
  return (
    <div className="flex flex-col gap-3 [&>p]:max-w-[80ch] [&>ul]:max-w-[80ch] [&>ol]:max-w-[80ch]">
      <p>
        Pe reads every duct network in the document, prices each grille's path from the fan, and
        lists each gap with who answers it: the route, Pea, or you. You stage what you know, preview
        what Revit would accept, and apply. Apply writes the coefficients, drops and fan static into
        Revit, next to Revit's own critical path.
      </p>

      <h3>Why not Revit's own pressure drop</h3>
      <ul className="list-disc pl-5">
        <li>Revit's straight-duct math matches a hand calculation within 0.1%.</li>
        <li>
          Revit's "Coefficient from ASHRAE Table" method works once a fitting stores a table. New
          fittings store none and charge 0 with no warning. On a fresh open of Chadds, 183 of 4,571
          fittings stored a table. An earlier copy showed 388; we don't know why.
        </li>
        <li>
          When Revit picks a table itself, it takes the first allowed one in text order, which is
          often the wrong shape. 221 round elbows on Chadds have CD3-11, a flat-back elbow.
        </li>
        <li>
          Revit measures an elbow's angle from the two ducts connected to it in the project, with
          almost no tolerance. So two elbows of the same 90-degree family can differ: on Chadds one
          meets its ducts at exactly 90 and gets a table, the other at 90.0013 and gets none. 87 of
          1,235 round elbows on Chadds can never get a table and always charge 0. Editing the family
          does not help; the ducts would have to be redrawn. Tested 2026-10-05.
        </li>
        <li>
          When Chadds opens, every fitting reads 0 and Revit's critical paths are out of date until
          something in that system changes. We don't know why.
        </li>
        <li>
          Fitting losses are set one fitting at a time, with no type default, no schedule, and 0
          when unset. The grille drop, often the largest term, is not in the model. So nobody sees
          the number or fixes it.
        </li>
        <li>
          Pe shows the number per grille, lists every assumption, and writes results back into the
          model. The goal is design-grade numbers with stated assumptions, not certification.
        </li>
      </ul>

      <h3>The parts of a duct path</h3>
      <Legend />
      <Mermaid chart={pathChart(PRESSURE_DROP)} />
      <PartsTable parts={PRESSURE_DROP.parts} />

      <h3>What has to work before pressure drop is automatic</h3>
      <p>
        On Chadds supply system SA 19, every part prices except the grille drop. Fan coil FC-17
        needs 0.081 in. w.g. and FC-35 needs 0.152 in. w.g. To run this without a person, every step
        below needs its data, and today most of it is spread across files or missing.
      </p>
      <Mermaid chart={chainChart()} />
      <p>
        Zoning maps each room to a system and a unit tag. Loads come from the RHVAC Load Preview.
        Equipment selection gives the fan curve and available static. Each step is its own route,
        and they share Revit element ids.
      </p>

      <h3>Open decisions</h3>
      <ol className="list-decimal pl-5">
        {DECISIONS.map(([title, body]) => (
          <li key={title} className="mb-2">
            <b>{title}</b> {body}
          </li>
        ))}
      </ol>
    </div>
  );
}

export const ductsDocs = <DuctsDocs />;
