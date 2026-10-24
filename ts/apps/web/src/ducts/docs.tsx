import { Deferred } from "@pe/kit/lang/section";
import { Table } from "@pe/kit/table/table";
import type { Column, Verdict } from "@pe/kit/table/model";
import { mapLink } from "@pe/agent-contracts/product-map";
import { Legend, Mermaid, PartsTable, chainChart, pathChart } from "#/product-map/diagram";
import {
  type DuctsResidency,
  type DuctsCompareRow,
  type DuctsProduct,
  DUCTS_COMPARE,
  onPeRoadmap,
  DUCTS_ENGINEER_DECIDES,
  DUCTS_LIMITS,
  DUCTS_NOT_ONE_CLICK,
  DUCTS_PEA_DOES,
  DUCTS_PEA_NEVER,
  DUCTS_RESIDENCY,
  DUCTS_RESIDENCY_RULE,
} from "@pe/agent-contracts/ducts-guide";
import { DuctsIntroduction } from "./introduction";
import { DuctCases } from "./docs-cases";
const PRESSURE_DROP = mapLink("pressure-drop")!;
const TONE = { yes: "done", partial: "caution", owed: "nav", no: undefined } as const;
const PRODUCTS = { revit: "Revit", naviate: "Naviate HVAC&P", pe: "Pe" };
function verdict(row: DuctsCompareRow, product: DuctsProduct): Verdict {
  const cell = row[product];
  return {
    word: [
      product === "pe" && row.unproven && "unproven",
      product === "pe" && onPeRoadmap(row) && "roadmap",
      `${cell.mark}: ${cell.note}`,
    ]
      .filter(Boolean)
      .join("; "),
    note: cell.detail ?? cell.note,
    tone: TONE[cell.mark],
    dim: !row.lead?.includes(product),
  };
}
const COMPARE_COLUMNS: Column<DuctsCompareRow>[] = [
  { key: "feature", label: "Feature", cell: (row) => <b>{row.feature}</b> },
  ...(["revit", "naviate", "pe"] as const).map((key) => ({
    key,
    label: PRODUCTS[key],
    verdict: (row: DuctsCompareRow) => verdict(row, key),
  })),
];
const RESIDENCY_COLUMNS: Column<DuctsResidency>[] = [
  { key: "value", label: "Value", cell: (row) => row.value },
  { key: "livesIn", label: "Lives in", cell: (row) => row.livesIn },
  { key: "survivesSave", label: "Survives save", cell: (row) => row.survivesSave },
  { key: "whoSees", label: "Who sees it", cell: (row) => row.whoSees },
  { key: "whoWrites", label: "Who writes it", cell: (row) => row.whoWrites },
];
export const ductsDocs = (
  <div className="flex flex-col gap-3 [&_p]:max-w-[80ch] [&_ul]:max-w-[80ch] [&_ol]:max-w-[80ch]">
    <Deferred>
      <DuctsIntroduction />
      <p>{DUCTS_NOT_ONE_CLICK}</p>
      {(
        [
          ["What Pea does", DUCTS_PEA_DOES],
          ["What Pea never does", DUCTS_PEA_NEVER],
        ] as const
      ).map(([title, lines]) => (
        <section key={title}>
          <h4 className="m-0 t-small">{title}</h4>
          <ul className="list-disc pl-5 t-small">
            {lines.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </section>
      ))}
    </Deferred>
    {[
      [
        "The picture",
        "The picture key pairs each mark with a short name and a count. Hover or focus a row for its meaning. Sequential scales show breaks for this system, and the maximum links to its element. A plain segment means no reading is selected; choose a reading above the drawing's right edge. No values means no element in this system has a value for that reading. Alt+/ opens this tutorial.",
        "The model picture is the chosen system's own geometry, captured from Revit: every duct, fitting, terminal and unit of every network the system is in, with the walls and other elements around it when the context layer is on. Leg totals, place names, gaps and the numbered findings ride over it and follow the camera. The centrelines layer draws the network Pe priced inside the meshes, so a short run or a node is easy to pick. The globe in the corner turns the camera and names the direction; the other corner holds the schematic, and a click on it swaps the two. Each move is one step Back can undo; dragging the camera is not.",
      ],
      [
        "Rules and findings",
        "Each rule pairs a fitting family and type with a geometry condition. Choosing its table reprices every matching instance. Unassigned families have no pricing rule; the engineer can assign a rule to the family or enter a stated drop for an individual fitting. An override replaces the table lookup for that fitting. None staged means no rule, drop, catalog link, flow, role or unit ESP is waiting to be applied.",
        "Findings are grouped into Fix, Set, Check and Diagnostics. Opening a row exposes its actions. Evidence help holds the full finding, its subjects and the reason for its status. Hovering a named subject in that help lights the same subject on the picture. Heal preview checks repairs in Revit and rolls them back. Apply commits the passing repairs in one transaction; a failed check refuses and rolls back that repair. A ruling on an open end or an inferred join changes the route calculation without changing Revit.",
      ],
    ].map(([title, ...paragraphs]) => (
      <Deferred key={title}>
        <h3>{title}</h3>
        {paragraphs.map((text) => (
          <p key={text}>{text}</p>
        ))}
      </Deferred>
    ))}
    <Deferred>
      <h3>Against Revit and Naviate</h3>
      {DUCTS_COMPARE.map(({ group, rows }) => (
        <Deferred key={group}>
          <Table
            rows={rows}
            columns={COMPARE_COLUMNS}
            rowKey={(row) => row.feature}
            label={group}
            caption={group}
            maxHeight="none"
          />
        </Deferred>
      ))}
    </Deferred>
    <Deferred>
      <h3>Where every number lives</h3>
      <p>{DUCTS_RESIDENCY_RULE}</p>
      <Table
        rows={DUCTS_RESIDENCY}
        columns={RESIDENCY_COLUMNS}
        rowKey={(row) => row.value}
        label="Where every number lives"
        maxHeight="none"
      />
    </Deferred>
    <Deferred>
      {(
        [
          ["What the engineer decides", DUCTS_ENGINEER_DECIDES],
          ["Limits", DUCTS_LIMITS],
        ] as const
      ).map(([title, lines]) => (
        <section key={title}>
          <h3>{title}</h3>
          <ul className="list-disc pl-5">
            {lines.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </section>
      ))}
    </Deferred>
    <Deferred>
      <h3>The parts of a duct path</h3>
      <Legend />
      <Mermaid chart={pathChart(PRESSURE_DROP)} />
      <PartsTable parts={PRESSURE_DROP.parts} />
      <p>
        Pressure drop is one link in a chain that starts at rooms and ends at the basis of design.
        Each link is its own route. They share only Revit element ids.
      </p>
      <Mermaid chart={chainChart()} />
    </Deferred>
    <Deferred>
      <DuctCases />
    </Deferred>
  </div>
);
