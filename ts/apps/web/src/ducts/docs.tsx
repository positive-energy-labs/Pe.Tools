/**
 * The ducts tutorial (Alt+/): what the tool does, how it compares with native Revit and
 * Naviate, where every number lives, what an engineer is needed
 * for, the limits, and the catalogue of cases the engine handles. Parts and statuses come from the
 * product map (`@pe/agent-contracts/product-map`); everything else, cases included, is the data
 * in `@pe/agent-contracts/ducts-guide`, which Pea reads too. The record behind each claim is
 * `docs/features/ducts/LEDGER.md` and `WHY-NOT-REVIT.md`.
 *
 * Register: plain, third person, for any engineer or reviewer. "The engineer" is the person using
 * the tool, "Pea" the agent, "the tool" the Ducts page. No second person, no project-specific ids.
 */
import { mapLink } from "@pe/agent-contracts/product-map";
import { Legend, Mermaid, PartsTable, chainChart, pathChart } from "#/product-map/diagram";
import {
  DUCTS_ENGINEER_DECIDES,
  DUCTS_LIMITS,
  DUCTS_NOT_ONE_CLICK,
  DUCTS_PEA_DOES,
  DUCTS_PEA_NEVER,
  DUCTS_RESIDENCY,
  DUCTS_RESIDENCY_RULE,
  DUCTS_SUMMARY,
  DUCTS_WALK,
} from "@pe/agent-contracts/ducts-guide";
import { CompareTable } from "./compare-table";
import { DuctCases } from "./docs-cases";
import { KeyLegend, type LegendKey } from "@pe/kit/lang/key-hint";
import { STAGE_KEYS } from "#/scene/stage-keys";

const PRESSURE_DROP = mapLink("pressure-drop")!;

/** Includes projection O through STAGE_KEYS, shared with the picture's own legend. */
const PICTURE_KEYS: readonly LegendKey[] = [
  ...STAGE_KEYS,
  { keys: ["/"], does: "go to a subject: a name, family, size, system or element id" },
  { keys: ["S"], does: "swap the model and the schematic" },
  { keys: ["M"], does: "meshes on or off" },
  { keys: ["C"], does: "context around the system on or off" },
  { keys: ["L"], does: "centrelines on or off" },
];

function DuctsDocs() {
  return (
    <div className="flex flex-col gap-3 [&>p]:max-w-[80ch] [&>ul]:max-w-[80ch] [&>ol]:max-w-[80ch]">
      <p>{DUCTS_SUMMARY}</p>

      <h3>What it does, in one walk</h3>
      <ol className="list-decimal pl-5">
        {DUCTS_WALK.map(({ step, who, body }) => (
          <li key={step} className="mb-2">
            <b>{step}</b> <span className="t-small text-ink-mute">({who})</span> {body}
          </li>
        ))}
      </ol>
      <p>{DUCTS_NOT_ONE_CLICK}</p>
      <p className="m-0 t-small">
        <b>What Pea does</b>
      </p>
      <ul className="list-disc pl-5 t-small">
        {DUCTS_PEA_DOES.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      <p className="m-0 t-small">
        <b>What Pea never does</b>
      </p>
      <ul className="list-disc pl-5 t-small">
        {DUCTS_PEA_NEVER.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>

      <h3>The picture</h3>
      <p>
        The picture key pairs each mark with a short name and a count. Hover or focus a row for its
        meaning. Sequential scales show breaks for this system, and the maximum links to its
        element. A plain segment means no reading is selected; choose a reading above the drawing's
        right edge. No values means no element in this system has a value for that reading. Alt+/
        opens this tutorial.
      </p>
      <p>
        The model picture is the chosen system's own geometry, captured from Revit: every duct,
        fitting, terminal and unit of every network the system is in, with the walls and other
        elements around it when the context layer is on. Leg totals, place names, gaps and the
        numbered findings ride over it and follow the camera. The centrelines layer draws the
        network Pe priced inside the meshes, so a short run or a node is easy to pick. The globe in
        the corner turns the camera and names the direction; the other corner holds the schematic,
        and a click on it swaps the two. Each move is one step Back can undo; dragging the camera is
        not.
      </p>
      <KeyLegend keys={PICTURE_KEYS} lead={PICTURE_KEYS.length} defaultOpen />

      <h3>Rules and findings</h3>
      <p>
        Each rule pairs a fitting family and type with a geometry condition. Choosing its table
        reprices every matching instance. Unassigned families have no pricing rule; the engineer can
        assign a rule to the family or enter a stated drop for an individual fitting. An override
        replaces the table lookup for that fitting. None staged means no rule, drop, catalog link,
        flow, role or unit ESP is waiting to be applied.
      </p>
      <p>
        Findings are grouped into Fix, Set, Check and Diagnostics. Opening a row exposes its
        actions. Evidence help holds the full finding, its subjects and the reason for its status.
        Hovering a named subject in that help lights the same subject on the picture. Heal preview
        checks repairs in Revit and rolls them back. Apply commits the passing repairs in one
        transaction; a failed check refuses and rolls back that repair. A ruling on an open end or
        an inferred join changes the route calculation without changing Revit.
      </p>

      <h3>Against Revit and Naviate</h3>
      <CompareTable />

      <h3>Where every number lives</h3>
      <p>{DUCTS_RESIDENCY_RULE}</p>
      <div className="grid grid-cols-[1fr_1fr_8rem_1fr_1fr] gap-x-3 gap-y-1 t-small">
        <b>Value</b>
        <b>Lives in</b>
        <b>Survives save</b>
        <b>Who sees it</b>
        <b>Who writes it</b>
        {DUCTS_RESIDENCY.map(({ value, livesIn, survivesSave, whoSees, whoWrites }) => (
          <div key={value} className="contents">
            <span>{value}</span>
            <span>{livesIn}</span>
            <span>{survivesSave}</span>
            <span>{whoSees}</span>
            <span>{whoWrites}</span>
          </div>
        ))}
      </div>

      <h3>What the engineer decides</h3>
      <ul className="list-disc pl-5">
        {DUCTS_ENGINEER_DECIDES.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>

      <h3>Limits</h3>
      <ul className="list-disc pl-5">
        {DUCTS_LIMITS.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>

      <h3>The parts of a duct path</h3>
      <Legend />
      <Mermaid chart={pathChart(PRESSURE_DROP)} />
      <PartsTable parts={PRESSURE_DROP.parts} />
      <p>
        Pressure drop is one link in a chain that starts at rooms and ends at the basis of design.
        Each link is its own route. They share only Revit element ids.
      </p>
      <Mermaid chart={chainChart()} />

      <DuctCases />
    </div>
  );
}

export const ductsDocs = <DuctsDocs />;
