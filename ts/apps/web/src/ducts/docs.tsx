/**
 * The ducts help page body (Alt+/): why Pe computes duct pressure drop instead of Revit, what each
 * part of a duct path needs and where its data is, and the open decisions. The record behind each
 * claim is `docs/features/pressure-drop/LEDGER.md` and `WHY-NOT-REVIT.md`. Mermaid loads only when
 * the page opens.
 */
import { useEffect, useRef } from "react";

let renders = 0;

function Mermaid({ chart }: { chart: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // A fresh id per render: mermaid reuses an existing element by id, and dev mode runs effects twice.
    const id = `ducts-mermaid-${++renders}`;
    let live = true;
    void import("mermaid").then(async ({ default: mermaid }) => {
      mermaid.initialize({
        startOnLoad: false,
        theme: "neutral",
        look: "classic",
        securityLevel: "strict",
        flowchart: { nodeSpacing: 16, rankSpacing: 22, padding: 6 },
        themeVariables: { fontSize: "13px" },
      });
      const { svg } = await mermaid.render(id, chart);
      if (live && ref.current) ref.current.innerHTML = svg;
    });
    return () => {
      live = false;
    };
  }, [chart]);
  return <div ref={ref} className="my-3 overflow-x-auto" />;
}

const READY = { fill: "#dcefdc", stroke: "#3a7a3a" };
const PARTIAL = { fill: "#fbefd0", stroke: "#a07a10" };
const MISSING = { fill: "#f6dada", stroke: "#a03a3a" };
const classDef = (name: string, c: { fill: string; stroke: string }) =>
  `classDef ${name} fill:${c.fill},stroke:${c.stroke}`;
const CLASSES = [
  classDef("ready", READY),
  classDef("partial", PARTIAL),
  classDef("missing", MISSING),
].join("\n");

const PATH = `flowchart LR
  fan["Fan"]:::partial
  inline["Inline parts"]:::missing
  duct["Straight duct"]:::ready
  fit["Fittings"]:::ready
  flex["Flex duct"]:::partial
  damper["Dampers"]:::partial
  grille["Grille"]:::missing
  room["Room"]:::partial
  flow["Design airflow"]:::partial
  esp["Fan's available static"]:::missing
  fan --> inline --> duct --> fit --> flex --> damper --> grille --> room
  room -. load sets .-> flow
  flow -. sets velocity in .-> fit
  fan -. checked against .-> esp
${CLASSES}`;

const CHAIN = `flowchart LR
  rooms["Rooms"]:::partial
  zoning["Zoning"]:::partial
  loads["Loads"]:::partial
  flows["Grille airflows"]:::partial
  network["Duct network"]:::partial
  pdrop["Pressure drop"]:::ready
  select["Equipment selection"]:::missing
  bod["Basis of design"]:::missing
  rooms --> zoning --> loads --> flows --> network --> pdrop --> select --> bod
${CLASSES}`;

function Legend() {
  const swatch = (c: { fill: string; stroke: string }, label: string) => (
    <span className="inline-flex items-center gap-1.5">
      <span
        className="inline-block size-3 rounded-sm border"
        style={{ background: c.fill, borderColor: c.stroke }}
      />
      {label}
    </span>
  );
  return (
    <div className="flex gap-4 t-small">
      {swatch(READY, "works today")}
      {swatch(PARTIAL, "works with gaps")}
      {swatch(MISSING, "no data yet")}
    </div>
  );
}

const ROWS: [string, string, string, string, string][] = [
  [
    "Straight duct",
    "Friction from length, size, airflow and roughness",
    "Yes",
    "Revit model",
    "Already modeled",
  ],
  [
    "Flex duct",
    "Same, with a rougher wall",
    "Partly. Revit uses the rigid-duct roughness unless the flex type sets its own. Pe flags it.",
    "Revit duct types",
    "Easy. One value per flex type.",
  ],
  [
    "Elbows, transitions, takeoffs",
    "C times velocity pressure. C comes from an ASHRAE table.",
    "Mostly. Pe has rules for the families on Chadds except rectangular radius elbows.",
    "Tables ship with Revit. Rules are in Pe's code. Apply writes the table onto each fitting.",
    "Medium. A firm rulebook, set up once.",
  ],
  [
    "Dampers",
    "Drop from ASHRAE table CD9-1",
    "Partly. Priced fully open. The balancing position is unknown.",
    "Pe's rules",
    "Easy if fully open is acceptable",
  ],
  [
    "Grille or diffuser",
    "Manufacturer static pressure at its airflow and size. Often the largest single term.",
    "No. The firm's grille families have no performance data.",
    "Revit has a slot for it: the terminal connector's pressure drop, bound to a family parameter. The numbers are only in manufacturer PDFs.",
    "Hard. Per manufacturer, model and core. Price's LBP tables stop at 6 in; Chadds uses 8 to 18 in.",
  ],
  [
    "Room",
    "Its load sets the airflow of the grilles that serve it",
    "Partly. Units list the rooms they serve in PE_M___ServesRoom. Grilles are not linked to rooms or loads.",
    "Revit rooms and spaces; RHVAC",
    "Medium. Depends on the rooms and zoning work.",
  ],
  [
    "Design airflow at each grille",
    "Sets the velocity, so every other term",
    "Partly. Each unit's airflow comes from the RHVAC Load Preview and is split over its grilles by neck size. Any grille can be overridden.",
    "The pasted Load Preview, on this computer until apply. Grilles in Revit carry no design flow.",
    "Medium. Every unit needs its tag in Revit and in the load file.",
  ],
  [
    "Inline equipment (coil, filter, dehumidifier, ERV core)",
    "A fixed drop at design airflow, from the product's submittal",
    "No",
    "Submittals",
    "Hard. Per product, and depends on what the unit's own rating already includes.",
  ],
  [
    "Which unit is the fan",
    "Where every path starts",
    "Partly. When one unit on a network has a load system, Pe treats the others as inline.",
    "Pe's inference",
    "Medium. Needs a role per unit (decision 5).",
  ],
  [
    "Connectivity",
    "The path must connect from fan to grille",
    "Partly. Pe joins gaps under an inch and near-miss taps and lists them. Real open ends need a person.",
    "Revit model",
    "Medium. Modeling care.",
  ],
  [
    "Fan's available static",
    "What the required static is checked against",
    "No. The firm's fan static parameter reads 0 on Chadds.",
    "Equipment family, from the submittal",
    "Hard. Comes with equipment selection.",
  ],
];

const DECISIONS: [string, string][] = [
  [
    "Rules stay fixed. A firm adds its own rule instead of changing a table.",
    "Today a person can change the ASHRAE table under a rule, because a Revit family does not say which tested fitting it is. A double-vaned mitered elbow could be CR3-14, 15 or 16 (C 0.38, 0.25, 0.41). Proposal: shipped rules never change, and a firm rule (a family and condition filter, built on the master table's filter bar) overrides a shipped one.",
  ],
  [
    "One loss engine.",
    "The browser, host and Pea use one engine. Revit's recalculation uses Pe's loss server, which is separate code. The server cannot price rectangular elbows, transitions without an In/Out pair, or takeoffs entered from the collar, so Revit's number would come out lower than Pe's. Options: (a) Revit stores the coefficient Pe computed, fixed until the next apply; (b) rebuild the server on the same rules; (c) Pe writes the right table name into Revit's own ASHRAE method where Revit accepts it, and uses (a) or (b) where it refuses.",
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
        lists each gap with who answers it: the route, Pea, or you. You stage what you know,
        preview what Revit would accept, and apply. Apply writes the coefficients, drops and fan
        static into Revit, next to Revit's own critical path.
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
          1,235 round elbows on Chadds can never get a table and always charge 0. Editing the
          family does not help; the ducts would have to be redrawn. Tested 2026-10-05.
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
      <Mermaid chart={PATH} />
      <div className="overflow-x-auto">
        <table className="w-full border-collapse t-small [&_td]:border-t [&_td]:py-1.5 [&_td]:pr-3 [&_td]:align-top [&_th]:pr-3 [&_th]:text-left">
          <thead>
            <tr>
              <th>Part</th>
              <th>What it adds</th>
              <th>Automatic today?</th>
              <th>Where the data is</th>
              <th>How hard to get</th>
            </tr>
          </thead>
          <tbody>
            {ROWS.map((row) => (
              <tr key={row[0]}>
                {row.map((cell, i) => (
                  <td key={i}>{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h3>What has to work before pressure drop is automatic</h3>
      <p>
        On Chadds supply system SA 19, every part prices except the grille drop. Fan coil FC-17
        needs 0.081 in. w.g. and FC-35 needs 0.152 in. w.g. To run this without a person, every
        step below needs its data, and today most of it is spread across files or missing.
      </p>
      <Mermaid chart={CHAIN} />
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
