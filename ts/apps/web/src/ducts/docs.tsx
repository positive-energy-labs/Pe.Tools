/**
 * The ducts tutorial (Alt+/): what the route does, why Pe computes instead of Revit, how it
 * differs from Manual D and from Naviate, where every number lives, what an engineer is needed
 * for, the limits, and the catalogue of cases the engine handles. Parts and statuses come from the
 * product map (`@pe/agent-contracts/product-map`); everything else, cases included, is the data
 * in `@pe/agent-contracts/ducts-guide`, which Pea reads too. The record behind each claim is
 * `docs/features/ducts/LEDGER.md` and `WHY-NOT-REVIT.md`.
 *
 * Register: plain, third person, for any engineer or reviewer. "The engineer" is the person using
 * the route, "Pea" the agent, "the route" the page. No second person, no project-specific ids.
 */
import { Link } from "@tanstack/react-router";
import { mapLink } from "@pe/agent-contracts/product-map";
import { Legend, Mermaid, PartsTable, chainChart, pathChart } from "#/product-map/diagram";
import {
  CASE_GROUPS,
  DUCT_CASES,
  DUCTS_ENGINEER_DECIDES,
  DUCTS_LIMITS,
  DUCTS_METHODS,
  DUCTS_METHODS_NOTE,
  DUCTS_NAVIATE,
  DUCTS_NOT_ONE_CLICK,
  DUCTS_PEA_DOES,
  DUCTS_PEA_NEVER,
  DUCTS_RESIDENCY,
  DUCTS_RESIDENCY_RULE,
  DUCTS_SUMMARY,
  DUCTS_WALK,
  DUCTS_WHY_NOT_REVIT,
  DUCTS_WHY_WRITE_BACK,
  type CaseGroup,
  type DuctCase,
} from "@pe/agent-contracts/ducts-guide";
import { CaseDrawing, CaseLegend } from "./cases/draw";

const PRESSURE_DROP = mapLink("pressure-drop")!;

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

export function DuctsDocs() {
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

      <h3>Why not Revit's own pressure drop</h3>
      <ul className="list-disc pl-5">
        {DUCTS_WHY_NOT_REVIT.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      <p>{DUCTS_WHY_WRITE_BACK}</p>

      <h3>How it differs from Manual D (RHVAC) and from Revit</h3>
      <p>{DUCTS_METHODS_NOTE}</p>
      <div className="grid grid-cols-[9rem_1fr_1fr_1fr] gap-x-3 gap-y-1 t-small">
        <span />
        <b>Manual D (RHVAC)</b>
        <b>Revit</b>
        <b>Pe</b>
        {DUCTS_METHODS.map(({ question, manualD, revit, pe }) => (
          <div key={question} className="contents">
            <b>{question}</b>
            <span>{manualD}</span>
            <span>{revit}</span>
            <span>{pe}</span>
          </div>
        ))}
      </div>

      <h3>Compared with Naviate</h3>
      <ul className="list-disc pl-5">
        {DUCTS_NAVIATE.map(({ topic, body }) => (
          <li key={topic}>
            <b>{topic}.</b> {body}
          </li>
        ))}
      </ul>

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
