/**
 * The ducts tutorial (Alt+/): what the route does, why Pe computes instead of Revit, how it
 * differs from Manual D and from Naviate, where every number lives, what an engineer is needed
 * for, the limits, and the catalogue of cases the engine handles. Parts and statuses come from the
 * product map (`@pe/agent-contracts/product-map`); the cases from `./cases/data`; the record behind
 * each claim is `docs/features/ducts/LEDGER.md` and `WHY-NOT-REVIT.md`.
 *
 * Register: plain, third person, for any engineer or reviewer. "The engineer" is the person using
 * the route, "Pea" the agent, "the route" the page. No second person, no project-specific ids.
 */
import { Link } from "@tanstack/react-router";
import { mapLink } from "@pe/agent-contracts/product-map";
import { Legend, Mermaid, PartsTable, chainChart, pathChart } from "#/product-map/diagram";
import { CASE_GROUPS, DUCT_CASES, type CaseGroup, type DuctCase } from "./cases/data";
import { CaseDrawing, CaseLegend } from "./cases/draw";
import { KeyLegend, type LegendKey } from "#/components/lang/kbd";

const PRESSURE_DROP = mapLink("pressure-drop")!;

/** The picture pane's keys; the pane's own legend and this page read the same list. */
export const PICTURE_KEYS: readonly LegendKey[] = [
  { pointer: "drag", does: "orbit" },
  { pointer: "right drag", does: "pan" },
  { pointer: "wheel", does: "zoom" },
  { pointer: "click", does: "select an element" },
  { pointer: "right click", does: "Select or Selection Box in Revit" },
  { keys: ["B", "X"], does: "Selection Box under the pointer" },
  { keys: ["F"], does: "frame the selection; nothing selected fits the system" },
  { keys: ["P"], does: "plan or isometric, keeping the pivot and zoom" },
  { keys: ["S"], does: "swap the model and the schematic" },
  { keys: ["G"], does: "show or hide the globe" },
  { keys: ["M"], does: "meshes on or off" },
  { keys: ["C"], does: "context around the system on or off" },
  { keys: ["L"], does: "centrelines on or off" },
  { keys: ["Esc"], does: "clear the selection" },
];

/** One step of the walk: what happens, and who does it. */
const WALK: [string, string, string][] = [
  [
    "Name the system",
    "Engineer or Pea",
    "Pick a Revit duct system by its name. The page shows every duct network that system touches, one section per fan, and marks any network shared with other systems. The search box moves within the same read: an element id, an equipment tag, or another system.",
  ],
  [
    "Heal the model",
    "Route proposes, engineer approves, Pea or engineer applies",
    "Pe builds the network from Revit's connectors, not from the system name. Gaps under about 2 in and near-miss taps are bridged for the calculation and listed as diagnostics. Dangling ends get a cap, touching ends get connected, and small same-size gaps get a union. These are written into Revit after a preview. Anything harder appears as a Fix row that names the repair and selects the element in Revit.",
  ],
  [
    "Point at the airflow",
    "Engineer",
    "Choose which parameter holds each grille's design airflow on this project (a firm parameter, the family's own Flow, or whatever the drafter used). The page lists every grille's value and its source. A grille with no value becomes a Set row. A fan's flow is the sum of its grilles. Only a side-stream unit such as a dehumidifier needs a typed flow.",
  ],
  [
    "Price",
    "Route",
    "Each duct's friction comes from its length, size, flow and roughness. Each fitting's loss is an ASHRAE coefficient times the velocity pressure at the actual flow. Each grille's path is summed from its fan, and the worst path is that fan's external static pressure (ESP). A grille's own drop is included when one is entered and never blocks the result when it is not.",
  ],
  [
    "Read the result",
    "Engineer",
    "The tree shows every run and leg in equivalent feet at that duct's own friction rate, with inches of water beside it. The header shows total effective length and ESP for the worst fan. Selecting a duct shows its length, design and actual loss per 100 ft, roughness and fittings, in the same layout as an RHVAC section.",
  ],
  [
    "Review and write",
    "Engineer",
    "Every pending change is listed as old and new before anything is written: airflow slot, rulings, roles, flows, ESP. A refused change says why. Write can run whenever something is staged. Only the ESP value waits for a calculation with no open Fix row.",
  ],
];

/** Where every kind of value lives: what survives a save, who sees it, who writes it. */
const RESIDENCY: [string, string, string, string, string][] = [
  [
    "Computed losses, critical path, ESP",
    "Nowhere. Recomputed on every read.",
    "No",
    "Anyone with Pe sees the same number from the same model",
    "The route",
  ],
  [
    "Grille airflow, unit airflow, unit ESP, terminal drop, fitting coefficient",
    "Revit parameters on the element, through named slots",
    "Yes, with the model",
    "Everyone in Revit, with or without Pe",
    "The engineer types it; Write puts it in Revit",
  ],
  [
    "Which parameter is the airflow slot",
    "The model's Project Information (a hidden text parameter, _PE_DuctLosses)",
    "Yes, with the model",
    "Everyone with Pe, after sync",
    "The engineer picks it; Write stores it",
  ],
  [
    "Rulings: ignore this open end, object to this join, this unit is passive",
    "The same Project Information parameter",
    "Yes, with the model",
    "Everyone with Pe, after sync",
    "The engineer rules; Write stores it; a take-back is a staged delete",
  ],
  [
    "Caps and connections made by the heal",
    "Real fittings and connections in the model",
    "Yes, with the model",
    "Everyone, in Revit and in every other tool",
    "The engineer approves; Pea or the engineer applies",
  ],
  [
    "Edits typed but not written, and Pea's proposals",
    "Pe Work on the local computer, keyed by document",
    "No. Cleared by Start fresh, never saved with the model",
    "Only this computer",
    "The engineer, or Pea as a proposal",
  ],
  [
    "Firm rules (which ASHRAE table a fitting family uses), slot names, catalogs",
    "Pe's code today; a firm Pod once the standards work lands",
    "Yes, with the install",
    "Everyone with the Pod",
    "The firm",
  ],
  [
    "Design friction rate",
    "Route settings (the duct settings popover)",
    "Yes, in local settings",
    "Only this computer",
    "The engineer",
  ],
];

/** Manual D (RHVAC), Revit's own calculator, and Pe, on the questions an engineer asks. */
const METHODS: [string, string, string, string][] = [
  [
    "Purpose",
    "Sizing: choose duct sizes so every run meets one design friction rate",
    "Analysis of a drawn system, once its inputs are filled in",
    "Analysis of the drawn system as it is, with the inputs it has",
  ],
  ["Lengths", "Typed by hand per section", "Measured from the model", "Measured from the model"],
  [
    "Fittings",
    "Equivalent feet from an ACCA table, accurate near the velocity the table was calibrated at",
    "ASHRAE coefficient times velocity pressure, but only after a table is stored on each fitting; a fitting with none charges 0 with no warning",
    "ASHRAE coefficient times velocity pressure at the actual flow, chosen by a family and type rule, for every fitting",
  ],
  [
    "Terminals and devices",
    "Typed drops, or 0 if none were typed",
    "A drop on the connector, typed per instance",
    "Included when a drop is entered; otherwise listed as not priced and never blocking",
  ],
  [
    "Broken geometry",
    "Not seen; the file has no geometry",
    "Stops at the first open end, one warning at a time",
    "Bridged and graded; caps and joins healed in Revit after approval; the rest listed with a repair",
  ],
  [
    "Output",
    "Total effective length, friction rate, ESP",
    "Static pressure per system, two decimals, stale until the system is touched",
    "Feet per leg at its own rate, total effective length and ESP per fan, four decimals, every assumption listed",
  ],
  [
    "Typed by the engineer",
    "Everything",
    "Every coefficient, one fitting at a time",
    "Which parameter holds the airflow, the rulings, the side-stream flows",
  ],
];

/** Compared with Naviate's duct pressure tool. Claims come from the decompiled add-in; see the ledger. */
const NAVIATE: [string, string][] = [
  [
    "Entry",
    "Naviate starts from one selected element and walks its connectors. Pe starts from a system name, chosen by the engineer or by Pea.",
  ],
  [
    "An open end or a loop",
    "Naviate stops the run and lists element ids. Pe bridges what it can, grades it, heals caps and joins in Revit, and lists the rest with a repair.",
  ],
  [
    "A grille with no catalog match",
    "Naviate prices it at 0 Pa without a notice. Pe lists it as not priced.",
  ],
  [
    "Writing",
    "Naviate writes nine shared parameters when its dialog closes, with no preview. Pe lists every change as old and new, then writes.",
  ],
  [
    "Where results live",
    "Naviate stores results on the elements and overrides in extensible storage. Pe stores inputs on the elements and rulings in Project Information; results are recomputed.",
  ],
  [
    "Manufacturer data",
    "Naviate ships a catalog of about 12,000 products and converts residual pressure into damper settings. Pe does not price terminals from catalogs yet; balancing is a later module.",
  ],
  [
    "The agent",
    "Naviate's assistant runs a fixed plan or returns script text and cannot see the model. Pea reads the findings, proposes values on rows, previews heals and applies them after approval.",
  ],
];

/** What an engineer has to decide; the route cannot settle these from the model alone. */
const ENGINEER_DECIDES: string[] = [
  "Anomalous joins: a reversed connector, a part pushed through a duct, supply meeting return. The route objects and waits for a ruling.",
  "Hard repairs: a tap off a fitting, a gap over 3 in, a size or air-type change, a system that should be split or merged. Pe selects the element in Revit; the engineer fixes it.",
  "Which parameter holds the design airflow on this project, and a flow for any grille that has none.",
  "A flow for a side-stream unit (a dehumidifier) whose air does not end at grilles.",
  "A unit's role when the rule guesses wrong (a filter chassis alone in its network reads as a fan).",
  "Whether a modelled loop was intended. It is priced as a tree and flagged.",
  "Which ASHRAE table a fitting rule uses when the family does not name its tested shape.",
  "Approval of each heal and each write. Pea proposes and previews; the engineer writes.",
];

const LIMITS: string[] = [
  "Grille drops are not included unless entered. Manufacturer tables are out of scope until terminal selections are final, so the ESP leaves the grille out until then.",
  "Rectangular radius elbows have no rule yet. A mitered elbow's orientation is inferred from Revit's Width.",
  "A duct entered from its side connector is charged friction over its whole length. The error is small per duct but there can be many.",
  "Internal equipment drops (coil, filter, ERV core) have no source and are not counted.",
  "A loop drawn in Revit is cut where the walk reaches a joint a second time. The air is not split between the two paths, so those paths read slightly high or low.",
  "Equivalent feet are converted at each duct's own friction rate, so a longer run can lose less pressure than a shorter one. How the critical run is chosen and shown against feet is not yet ruled.",
  "Revit allows one fan per system. A system name spanning two networks with their own air handlers is priced per fan here, but cannot be given one base equipment in Revit until it is split.",
  "Results are not stored. A schedule cannot read the ESP until a result parameter exists.",
  "A link on this page opens the case on the project it was recorded from. On another document the ids will not resolve. Deriving live examples from the open document is planned.",
];

const groups = Object.keys(CASE_GROUPS) as CaseGroup[];

function CaseCard({ c }: { c: DuctCase }) {
  return (
    <article
      className="flex flex-col gap-1.5 border p-2"
      id={`case-${c.number}`}
      data-status={c.status}
    >
      <div className="flex items-baseline gap-2">
        <span className="font-mono t-small">{c.number}</span>
        <b>{c.title}</b>
        <span className="t-small text-ink-mute">{c.status}</span>
        {c.code ? <code className="ml-auto t-small">{c.code}</code> : null}
      </div>
      {c.scene && c.sceneLabel ? <CaseDrawing scene={c.scene} label={c.sceneLabel} /> : null}
      <p className="m-0">{c.case}</p>
      <p className="m-0">
        <b>What Pe does.</b> {c.whatWeDo}
      </p>
      <p className="m-0">
        <b>Why.</b> {c.why}
      </p>
      {c.idea ? (
        <p className="m-0 t-small">
          <b>Possible change.</b> {c.idea}
        </p>
      ) : null}
      {c.ids ? <p className="m-0 font-mono t-small text-ink-mute">{c.ids}</p> : null}
      {c.examples.length ? (
        <p className="m-0 t-small">
          {c.examples.map((e, i) => (
            <Link
              key={i}
              to="/ducts"
              search={{ system: e.system ?? "", selected: e.selected ?? "" }}
              className="mr-3 underline"
              title="Opens on the project the case was recorded from; the ids will not resolve on another document"
            >
              {e.system ?? "no system"}
              {e.selected ? ` · ${e.selected}` : ""}
            </Link>
          ))}
        </p>
      ) : null}
    </article>
  );
}

function DuctsDocs() {
  return (
    <div className="flex flex-col gap-3 [&>p]:max-w-[80ch] [&>ul]:max-w-[80ch] [&>ol]:max-w-[80ch]">
      <p>
        The ducts route reads every duct network in the document from Revit's connectors, repairs
        what it safely can, prices each grille's path from its fan, and writes the inputs it used
        back into the model so they travel with it. The result is a design-grade number with its
        assumptions listed. It is not a certification. The engineer sees the number per grille and
        what it rests on, Pea proposes and previews, and the engineer rules on anything the model
        cannot settle.
      </p>

      <h3>What it does, in one walk</h3>
      <ol className="list-decimal pl-5">
        {WALK.map(([step, who, body]) => (
          <li key={step} className="mb-2">
            <b>{step}</b> <span className="t-small text-ink-mute">({who})</span> {body}
          </li>
        ))}
      </ol>
      <p>
        It is not one click. Three things need a person on most models: which parameter holds the
        design airflow, the joins the evidence argues against, and approval of each write. The rest
        is automatic, and Pea can do the walking. It puts the page on the named system, surveys,
        proposes on every row it can, previews heals and applies them after approval. Pea never
        stages a ruling, never writes an ESP, and never computes a number of its own.
      </p>

      <h3>The picture</h3>
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
      <KeyLegend keys={PICTURE_KEYS} lead={PICTURE_KEYS.length} defaultOpen bind={false} />

      <h3>Why not Revit's own pressure drop</h3>
      <p>
        Revit's arithmetic is correct. Its inputs cannot be filled in at scale, so its result is
        rarely complete.
      </p>
      <ul className="list-disc pl-5">
        <li>Revit's straight-duct friction matches a hand calculation within 0.1%.</li>
        <li>
          A fitting's loss coefficient is not a parameter. It cannot be scheduled, filtered or
          edited in bulk. It is set one fitting at a time in the Properties palette, with no type
          default. A fitting that was never set charges 0 and raises no warning, so Revit reports a
          static pressure that is only friction plus whichever fittings someone set.
        </li>
        <li>
          The "Coefficient from ASHRAE Table" option stores no table until someone presses OK in
          each fitting's dialog. When Revit picks a table itself, it takes the first allowed one in
          text order, which is often the wrong shape. It measures an elbow's angle from the ducts
          drawn into it with almost no tolerance, so some elbows can never hold a table at all. On
          one test model that was 221 round elbows holding a flat-back elbow's table and about 7% of
          elbows with no table possible.
        </li>
        <li>
          A takeoff holds one coefficient, but the physics needs two: the branch and the straight
          leg run at different velocity pressures. Revit's path can be right for the branch grille
          or for the downstream grilles, not both.
        </li>
        <li>
          Revit's critical path needs one connected network from the fan to every grille, and it
          reports disconnects one warning at a time. On the same test model, 336 of 465 open ends
          sat in or against another element: drafters draw the joint in because Revit refuses the
          small takeoff that would make it. Pe reads the graph, lists every open end, loop, missing
          fan and shared junction, and heals the safe ones.
        </li>
        <li>
          On open, every fitting reads 0 and Revit's critical paths are stale until the system is
          touched. Pe recomputes on every read.
        </li>
      </ul>
      <p>
        Pe still writes to Revit because the model is the deliverable. The firm hands over an .rvt,
        not a Pe page. Flows, ESP and coefficients travel with it to reviewers who do not have Pe,
        and Revit's own critical path becomes a check that the model is whole.
      </p>

      <h3>How it differs from Manual D (RHVAC) and from Revit</h3>
      <p>
        Manual D and ASHRAE are two methods. Manual D converts a fitting into equivalent feet at one
        design friction rate, which is accurate near the velocity the table was calibrated at and
        convenient for sizing by hand. ASHRAE multiplies a coefficient by the velocity pressure at
        the actual speed. Pe analyses the system as drawn with ASHRAE coefficients, then shows every
        loss in feet the way RHVAC does, converted at that duct's own rate. Straight-duct friction
        should match RHVAC closely. Fittings differ because the methods differ, not because either
        is wrong.
      </p>
      <div className="grid grid-cols-[9rem_1fr_1fr_1fr] gap-x-3 gap-y-1 t-small">
        <span />
        <b>Manual D (RHVAC)</b>
        <b>Revit</b>
        <b>Pe</b>
        {METHODS.map(([row, d, r, p]) => (
          <div key={row} className="contents">
            <b>{row}</b>
            <span>{d}</span>
            <span>{r}</span>
            <span>{p}</span>
          </div>
        ))}
      </div>

      <h3>Compared with Naviate</h3>
      <ul className="list-disc pl-5">
        {NAVIATE.map(([topic, body]) => (
          <li key={topic}>
            <b>{topic}.</b> {body}
          </li>
        ))}
      </ul>

      <h3>Where every number lives</h3>
      <p>
        Anything that affects the calculation is stored in the model, so another person or another
        tool sees the same thing. The only state Pe keeps for itself is what has been typed and not
        yet written.
      </p>
      <div className="grid grid-cols-[1fr_1fr_8rem_1fr_1fr] gap-x-3 gap-y-1 t-small">
        <b>Value</b>
        <b>Lives in</b>
        <b>Survives save</b>
        <b>Who sees it</b>
        <b>Who writes it</b>
        {RESIDENCY.map(([value, home, survives, sees, writes]) => (
          <div key={value} className="contents">
            <span>{value}</span>
            <span>{home}</span>
            <span>{survives}</span>
            <span>{sees}</span>
            <span>{writes}</span>
          </div>
        ))}
      </div>

      <h3>What the engineer decides</h3>
      <ul className="list-disc pl-5">
        {ENGINEER_DECIDES.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>

      <h3>Limits</h3>
      <ul className="list-disc pl-5">
        {LIMITS.map((line) => (
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

      <h3>Every case the engine knows</h3>
      <p>
        One card per situation: what it is, what Pe does, why, the code shared by the engine and the
        inbox, and a link to a recorded example. Status: handled, owed (known gap), open (needs a
        ruling), fixed (a defect found during verification). A link opens the case on the page and
        keeps the current read.
      </p>
      <CaseLegend />
      {groups.map((g) => (
        <section key={g} className="flex flex-col gap-2">
          <h4 className="m-0">
            {g} · {CASE_GROUPS[g]}
          </h4>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(20rem,1fr))] gap-3">
            {DUCT_CASES.filter((c) => c.group === g).map((c) => (
              <CaseCard key={c.number} c={c} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

export const ductsDocs = <DuctsDocs />;
