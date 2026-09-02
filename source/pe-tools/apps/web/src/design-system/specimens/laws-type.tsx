import { FactChip } from "#/components/lang/chip";
import { StateCell } from "#/components/lang/cell";
import { CounterExample, Law } from "#/design-system/exhibit";

export function TypeLaws({ owner }: { owner: (name: string) => string }) {
  return (
    <>
      <Law
        name="bold = unsaved"
        owner={owner("bold = unsaved")}
        ruling="Weight is reserved for a person's unsaved edit. A proposal already has Pea's wash and does not spend the axis twice."
      >
        <div className="flex flex-wrap items-baseline gap-4">
          <StateCell value="36 in" stage="staged" stagedBy="you" />
          <StateCell value="2 hr" stage="proposed" />
        </div>
        <CounterExample why="freshness is a fact, so weight must remain available for unsaved work">
          <strong className="t-small">fresh reading</strong>
        </CounterExample>
      </Law>

      <Law
        name="the squiggle family"
        owner={owner("the squiggle family")}
        ruling="One decoration family carries value state in priority order: drift, stale, unverified. A citation lives on another element."
      >
        <div className="flex flex-wrap items-baseline gap-4">
          <StateCell value="1.75 in" agree="drift" modelValue="1.375 in" />
          <StateCell value="5.5 in" fresh="stale" />
          <StateCell value="26 in" fresh="unverified" />
          <StateCell value="2 hr" grounding={{ doc: "RFI-217", page: 2 }} />
        </div>
        <CounterExample why="the word says stale but the value carries no machine-readable stale state">
          <span className="flex items-baseline gap-2">
            <StateCell value="5.5 in" />
            <span className="t-small face-mono text-ink-2">stale</span>
          </span>
        </CounterExample>
      </Law>

      <Law
        name="mono means measured"
        owner={owner("mono means measured")}
        ruling="Mono marks what a machine measured: counts, hashes, timestamps, states, and footlines. It is not generic chrome."
      >
        <FactChip title="The plan this write was made against.">plan a91f#c04</FactChip>
        <CounterExample why="a human action is not a machine reading">
          <span className="t-small t-upper text-ink">save changes</span>
        </CounterExample>
      </Law>

      <Law
        name="small type takes opt-in marks"
        owner={owner("small type takes opt-in marks")}
        ruling="Sub-prose text has one size. Mono marks machine readings, and upper case marks section heads."
      >
        <div className="flex flex-col gap-2">
          <span className="t-display face-display text-ink">display · human thesis</span>
          <span className="t-head text-ink">head · section claim</span>
          <span className="t-small text-ink-2">small · plain reading</span>
          <span className="t-small face-mono text-ink-2">small + mono · plan a91f#c04</span>
          <span className="t-small t-upper text-ink-2">small + upper · category</span>
        </div>
        <CounterExample why="a plan hash is measured, so the display face lies about its source">
          <span className="t-small face-mono face-display text-ink">plan a91f#c04</span>
        </CounterExample>
      </Law>
    </>
  );
}
