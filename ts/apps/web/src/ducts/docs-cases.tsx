import { TooltipHint } from "@pe/kit/lang/tooltip";
import { Link } from "@tanstack/react-router";
import { CASE_GROUPS, DUCT_CASES, type CaseGroup, type DuctCase } from "./cases/data";
import { CaseDrawing, CaseLegend } from "./cases/draw";

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
            <TooltipHint
              key={i}
              content="Opens on the project the case was recorded from; the ids will not resolve on another document"
            >
              <Link
                to="/ducts"
                search={{ system: e.system ?? "", selected: e.selected ?? "" }}
                className="mr-3 underline"
              >
                {e.system ?? "no system"}
                {e.selected ? ` · ${e.selected}` : ""}
              </Link>
            </TooltipHint>
          ))}
        </p>
      ) : null}
    </article>
  );
}

export function DuctCases() {
  return (
    <>
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
    </>
  );
}
