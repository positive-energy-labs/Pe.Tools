/**
 * The ducts help page body (Alt+/): the case for Pe's pressure drop to a senior engineer, what in a
 * duct path is ready to price automatically and where its data lives, and the decisions still open.
 * The record behind every claim is `docs/features/pressure-drop/LEDGER.md`; this page restates it
 * for a reader who has not seen the ledger. Mermaid loads only when the page opens.
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

const READY = "fill:#dcefdc,stroke:#3a7a3a";
const PARTIAL = "fill:#fbefd0,stroke:#a07a10";
const MISSING = "fill:#f6dada,stroke:#a03a3a";

const PATH = `flowchart LR
  fan["Fan<br/>partial"]:::partial
  inline["Inline parts<br/>missing"]:::missing
  duct["Straight duct<br/>ready"]:::ready
  fit["Fittings<br/>mostly ready"]:::ready
  flex["Flex duct<br/>partial"]:::partial
  damper["Dampers<br/>partial"]:::partial
  grille["Grille<br/>missing"]:::missing
  flow["Design airflow<br/>partial"]:::partial
  esp["Fan's available static<br/>missing"]:::missing
  fan --> inline --> duct --> fit --> flex --> damper --> grille
  flow -. sets every velocity .-> fit
  fan -. checked against .-> esp
  classDef ready ${READY}
  classDef partial ${PARTIAL}
  classDef missing ${MISSING}`;

const CHAIN = `flowchart LR
  rooms["Rooms<br/>partial"]:::partial
  zoning["Zoning<br/>partial"]:::partial
  loads["Loads<br/>partial"]:::partial
  flows["Grille airflows<br/>partial"]:::partial
  network["Duct network<br/>partial"]:::partial
  pdrop["Pressure drop<br/>ready but for data"]:::ready
  select["Equipment selection<br/>missing"]:::missing
  bod["Basis of design<br/>missing"]:::missing
  rooms --> zoning --> loads --> flows --> network --> pdrop --> select --> bod
  classDef ready ${READY}
  classDef partial ${PARTIAL}
  classDef missing ${MISSING}`;

const ROWS: [string, string, string, string, string][] = [
  [
    "Straight duct",
    "Friction over its length, from size, airflow and roughness",
    "Ready",
    "The Revit model",
    "Free: already modeled",
  ],
  [
    "Flex duct",
    "The same, with a rougher wall",
    "Partial: Revit gives flex the rigid-duct roughness unless the type says otherwise; Pe flags it",
    "Revit duct types",
    "Easy: one value per flex type, set once as a firm standard",
  ],
  [
    "Elbows, transitions, takeoffs",
    "A coefficient C times the velocity pressure; C comes from an ASHRAE table",
    "Mostly ready: rules cover the families Chadds uses; rectangular radius elbows have no rule yet",
    "Tables ship with Revit; the rules live in Pe's code; the chosen table is written onto each fitting when you apply",
    "Medium: a firm rulebook, built once",
  ],
  [
    "Dampers",
    "A drop from ASHRAE table CD9-1",
    "Partial: priced fully open; the real balancing position is unknown",
    "Pe's rules",
    "Easy, if fully open is acceptable",
  ],
  [
    "Grille or diffuser",
    "The manufacturer's static pressure at its airflow and size; often the largest single term",
    "Missing: the firm's grille families carry no performance data",
    "Revit has the slot (a terminal connector's pressure drop, bound to a family parameter); the catalog number for each neck and airflow lives only in manufacturer PDFs",
    "Hard: per manufacturer, model and core. Price's LBP tables stop at 6 in; Chadds uses 8 to 18 in",
  ],
  [
    "Design airflow at each grille",
    "Sets the velocity, so every other term",
    "Partial: the unit's airflow from the RHVAC Load Preview, split over its grilles by neck size, overridable per grille",
    "The pasted Load Preview, kept on this computer until applied; the grilles in Revit carry no design flow",
    "Medium: every unit needs its tag in Revit and in the load file",
  ],
  [
    "Inline equipment (coil, filter, dehumidifier, ERV core)",
    "A fixed drop at design airflow, from the product's submittal",
    "Missing",
    "Submittals only",
    "Hard: per product, and it depends on what the unit's own rating already includes",
  ],
  [
    "Which unit is the fan",
    "Where every path starts",
    "Partial: inferred; when one unit on a network has a load system, the others are treated as inline",
    "Pe's inference",
    "Medium: a role per unit (open decision 5)",
  ],
  [
    "Connectivity",
    "A path must be continuous from fan to grille",
    "Partial: sub-inch gaps and near-miss taps are joined and named; real open ends need a person",
    "The Revit model",
    "Medium: modeling care",
  ],
  [
    "Fan's available static",
    "What the required static is checked against",
    "Missing: the firm's fan static parameter reads 0 on Chadds",
    "The equipment family, from the submittal",
    "Hard: the equipment selection link",
  ],
];

const DECISIONS: [string, string][] = [
  [
    "Rules are fixed; a firm adds its own rule instead of changing a table.",
    "Today a person can swap the ASHRAE table under a rule. The swap exists because a Revit family does not say which tested fitting it is: a double-vaned mitered elbow is CR3-14, 15 or 16 (C 0.38, 0.25, 0.41). Proposal: ship rules that never change, and let the firm add a rule (a family and condition filter, built on the master table's filter bar) that wins over the shipped one. The rule on screen is then the whole explanation.",
  ],
  [
    "One loss engine.",
    "The browser, the host and Pea price with one engine. Revit's own recalculation goes through Pe's loss server, which is separate code. Today they disagree: the server cannot price rectangular elbows, transitions without an In/Out pair, or takeoffs entered from the collar, so Revit's number would come out lower than Pe's. Options: Revit stores the coefficient Pe's engine computed (frozen until the next apply); the server is rebuilt on the same rules; or Pe writes the right table name into Revit's own ASHRAE method wherever Revit's matcher accepts it, and falls back to one of the others where it refuses (off-square elbows, shapes with no table). Revit's own critical path is meant to be the check, so this must close before it means anything.",
  ],
  [
    "Grille performance data.",
    "Where catalog tables live firm-wide, how they get in (Pea reads the manufacturer PDF and cites the page), and what happens past the catalog's sizes.",
  ],
  [
    "Inline equipment drops.",
    "Where a coil, filter or dehumidifier drop comes from, where it is stored, and how to avoid counting what the unit's rating already includes.",
  ],
  [
    "A role per unit: fan, inline, or its own system.",
    "Read from what the unit is, overridable by a person. Replaces today's guess, which would mistake an ERV ducted into a fan coil for a passive part.",
  ],
  [
    "Where design airflow comes from.",
    "The Load Preview split is the interim. Long term, each grille carries its own design flow from the rooms and zoning link.",
  ],
  [
    "Where staged inputs live.",
    "Pasted loads, overrides and table choices stay on one computer until apply. Should they travel with the model before then?",
  ],
  [
    "The fan's available static.",
    "Without it there is nothing to compare the required static to; it belongs to equipment selection.",
  ],
];

export function DuctsDocs() {
  return (
    <div className="flex flex-col gap-3 [&>p]:max-w-[80ch] [&>ul]:max-w-[80ch] [&>ol]:max-w-[80ch]">
      <p>
        Read every duct network in the document, price every grille's path from the fan, and see
        who must answer each gap: the route, Pea, or you. Stage what you know, preview what Revit
        would accept, and apply: Pe writes the coefficients, drops and fan static into Revit, beside
        Revit's own critical path.
      </p>

      <h3>Why not Revit's own pressure drop</h3>
      <ul className="list-disc pl-5">
        <li>
          Revit's arithmetic is right: straight duct matches a hand calculation within 0.1%.
        </li>
        <li>
          Its fitting method "Coefficient from ASHRAE Table" works: once a fitting stores a table,
          Revit reads the shipped grid exactly and keeps it live. But fittings start empty, and an
          empty fitting charges 0 with no error. On a fresh open of the Chadds model 183 of 4,571
          fittings stored a table (an earlier copy read 388; the difference is unexplained).
        </li>
        <li>
          When Revit fills a table itself, it takes the first one its matcher allows in text order,
          not the right shape: 221 round elbows on Chadds carry CD3-11, a flat-back elbow.
        </li>
        <li>
          The matcher reads an elbow's angle from the two ducts drawn into it, not from the family,
          and allows almost no tolerance. The same 90-degree family works in one place and not
          another: two identical elbows on Chadds differ only because one meets its ducts at
          90.0013 degrees. 87 of 1,235 round elbows (about 7%) have a duct a hair off its
          direction, can never hold a table, and always charge 0. That is drafting, not the family:
          no family edit fixes it. Tested 2026-10-05.
        </li>
        <li>
          On open, every fitting on Chadds reads 0 and the critical paths Revit reports are stale
          until something in that system changes. Why is unexplained.
        </li>
        <li>
          Nobody fixes it because the number has no reader, the state is invisible, it is set per
          fitting with no type default, a missing value reads as 0 without an error, and the
          largest term, the grille, is not in the model at all.
        </li>
        <li>
          Pe makes the number visible per grille, names every assumption, and writes the result
          back so it travels with the model. The bar is design-grade with named assumptions, not
          certification.
        </li>
      </ul>

      <h3>What a path is made of, and how ready each part is</h3>
      <Mermaid chart={PATH} />
      <div className="overflow-x-auto">
        <table className="w-full border-collapse t-small [&_td]:border-t [&_td]:py-1.5 [&_td]:pr-3 [&_td]:align-top [&_th]:pr-3 [&_th]:text-left">
          <thead>
            <tr>
              <th>Part</th>
              <th>What it adds</th>
              <th>Ready to run automatically?</th>
              <th>Where its data lives</th>
              <th>How hard the data is to get</th>
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

      <h3>Solving the calculation is not the same as automatic</h3>
      <p>
        The calculation itself now works: on the Chadds model, supply system SA 19 prices end to
        end. Fan coil FC-17 needs 0.081 in. w.g. and FC-35 needs 0.152 in. w.g., with every part
        priced except the grille drop. Making it automatic needs every link before it, and the
        equipment link after it, to carry data the firm does not hold in one place today.
      </p>
      <Mermaid chart={CHAIN} />
      <p>
        Zoning is room to system to unit tag. Loads come from the RHVAC Load Preview. Equipment
        selection supplies the fan curve and available static. Each link is its own route with its
        own findings; they share only Revit element ids.
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
