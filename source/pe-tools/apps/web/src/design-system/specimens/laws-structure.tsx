import { ArtifactFrame } from "#/components/lang/artifact-frame";
import { CELL_STATE_ORDER, StateCell, cellStateLabel } from "#/components/lang/cell";
import type { StateCellProps } from "#/components/lang/cell";
import { FactChip, Tag } from "#/components/lang/chip";
import { HelpTip } from "#/components/lang/help";
import { OutcomeLine } from "#/components/lang/outcome";
import { Press } from "#/components/lang/press";
import { Verb } from "#/components/lang/verb";
import { CounterExample, Gap, Law } from "#/design-system/exhibit";
import { PARAM_ROWS, cellProps } from "#/design-system/fixtures";

const noop = () => {};
const row = (key: string) => PARAM_ROWS.find((item) => item.key === key)!;

const ORDER_SPECIMENS: readonly StateCellProps[] = [
  { value: "26 in", fresh: "unverified" },
  { value: "84 in", cap: "readonly" },
  { value: "36 in", stage: "staged" },
  { value: "24 in" },
  { value: "1.75 in", agree: "drift", modelValue: "1.375 in" },
  { value: "2 hr", stage: "proposed" },
  { value: "5.5 in", fresh: "stale" },
];

const ORDERED_SPECIMENS = [...ORDER_SPECIMENS].sort(
  (a, b) =>
    CELL_STATE_ORDER.indexOf(cellStateLabel(a)) - CELL_STATE_ORDER.indexOf(cellStateLabel(b)),
);

export function StructureLaws({ owner }: { owner: (name: string) => string }) {
  return (
    <>
      <Law
        name="the border budget"
        owner={owner("the border budget")}
        ruling="Plain content is never enclosed. ArtifactFrame is reserved for a machine-operated object that carries state."
      >
        <div className="w-full max-w-sm">
          <ArtifactFrame head={<Tag>framed · carries state</Tag>}>
            <div className="px-3 py-3">
              <StateCell value="2 hr" stage="proposed" />
            </div>
          </ArtifactFrame>
          <div className="pt-2">
            <OutcomeLine kind="receipt" label="42 parameters written" says="plain content" />
          </div>
        </div>
        <CounterExample why="a receipt reports on an artifact; it does not become one">
          <ArtifactFrame>
            <div className="px-3 py-2">
              <OutcomeLine kind="receipt" label="42 parameters written" says="it landed" />
            </div>
          </ArtifactFrame>
        </CounterExample>
      </Law>

      <Law
        name="cell state, not columns"
        owner={owner("cell state, not columns")}
        ruling="The grid holds real dimensions. Proposal, drift, and freshness are readings of one value, so StateCell carries them without new columns."
      >
        <div className="w-[20rem] max-w-full">
          <StateCell {...cellProps(row("connectedLoad"))} />
        </div>
        <CounterExample why="three chips turn one coordinate into three pseudo-columns">
          <div className="flex flex-wrap gap-2">
            <FactChip title="Proposal state">proposed · 150 VA</FactChip>
            <FactChip title="Model state">drift · 100 VA</FactChip>
            <FactChip title="Freshness state">fresh · 2 min</FactChip>
          </div>
        </CounterExample>
        <Gap>
          staging authorship still enters StateCell as fixture data because the production state
          model does not carry it end to end.
        </Gap>
      </Law>

      <Law
        name="sort by domain order"
        owner={owner("sort by domain order")}
        ruling="State sorts by the order in which attention is owed: drift first and locked last. Alphabetical order is never the fallback."
      >
        <div className="flex flex-col gap-1">
          {ORDERED_SPECIMENS.map((props) => (
            <span key={cellStateLabel(props)} className="flex items-baseline gap-3">
              <span className="w-20 t-caption face-mono text-ink-mute">
                {cellStateLabel(props)}
              </span>
              <StateCell {...props} />
            </span>
          ))}
        </div>
        <CounterExample why="alphabetical order hides the states that need action">
          <span className="t-caption face-mono text-ink-2">
            clean · drift · locked · proposed · stale · staged · unverified
          </span>
        </CounterExample>
      </Law>

      <Law
        name="a filter's vocabulary is stable"
        owner={owner("a filter's vocabulary is stable")}
        ruling="Facet options derive from all rows, never the visible subset, so an option cannot vanish under the cursor."
      >
        <Tag>live proof · RealTable below</Tag>
        <CounterExample why="visible-only options shrink while the person is trying to widen scope">
          <Press state="selected">visible states only</Press>
        </CounterExample>
        <Gap>
          a static specimen cannot prove vocabulary stability. The RealTable below is the live
          specimen: narrow scope, then open the value facet.
        </Gap>
      </Law>

      <Law
        name="refuse per option"
        owner={owner("refuse per option")}
        ruling="Keep an unavailable option in place and give it its own reason. Verb requires the reason at every call site."
      >
        <Verb
          tone="commit"
          label="sync to .r10"
          onClick={noop}
          disabled
          reason="no .r10 target bound - bind one before syncing"
        />
        <CounterExample why="Press can be disabled without explaining why, so it cannot carry a world action">
          <Press disabled>sync to .r10</Press>
        </CounterExample>
      </Law>

      <Law
        name="orientation hides behind a mark"
        owner={owner("orientation hides behind a mark")}
        ruling="A HelpTip orients a region. A control title explains one control. Explanatory chrome belongs in one of those homes."
      >
        <div className="flex items-center gap-2">
          <Tag>the real table</Tag>
          <HelpTip>
            The product table primitive with StateCell as its renderer. Click a cell to read its
            full facts.
          </HelpTip>
        </div>
        <CounterExample why="a fact chip is for a measured fact, not a paragraph of orientation">
          <FactChip title="Region orientation">
            this table shows parameters and how to read every state
          </FactChip>
        </CounterExample>
      </Law>
    </>
  );
}
