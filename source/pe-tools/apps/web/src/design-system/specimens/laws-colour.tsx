import { FactChip } from "#/components/lang/chip";
import { StateCell } from "#/components/lang/cell";
import { Press } from "#/components/lang/press";
import { ActionButton } from "#/components/lang/action-button";
import { CounterExample, Law } from "#/design-system/exhibit";

const noop = () => {};

export function ColourLaws({ owner }: { owner: (name: string) => string }) {
  return (
    <>
      <Law
        name="one alarm"
        owner={owner("one alarm")}
        ruling="Alarm means the model disagrees. Errors, warnings, and destructive verbs must use their own meaning."
      >
        <StateCell value="1.75 in" agree="drift" modelValue="1.375 in" />
        <CounterExample why="a busy bridge is an operational error, not model disagreement">
          <FactChip tone="alarm" title="The bridge is busy.">
            bridge busy
          </FactChip>
        </CounterExample>
      </Law>

      <Law
        name="pea is never blue"
        owner={owner("pea is never blue")}
        ruling="Pea's proposals wear Pea green. Blue means a write leaves the page, so a blue proposal would read as committed."
      >
        <StateCell value="2 hr" stage="proposed" />
        <CounterExample why="asking Pea is an agent action, not a committed write">
          <ActionButton
            tone="commit"
            label="ask pea"
            onClick={noop}
            reason="Asks Pea to inspect this value"
          />
        </CounterExample>
      </Law>

      <Law
        name="one filled blue"
        owner={owner("one filled blue")}
        ruling="The only filled blue is the verb that writes beyond the page. Navigation uses the same role as text, never as a fill."
      >
        <div className="flex flex-wrap items-center gap-2">
          <ActionButton
            tone="commit"
            label="apply to Revit"
            onClick={noop}
            reason="Writes 42 parameters into the model"
          />
          <ActionButton
            tone="nav"
            direction="out"
            label="open in RHVAC"
            onClick={noop}
            reason="Leaves Pe.Tools"
          />
        </div>
        <CounterExample why="opening another surface is navigation, not a write">
          <ActionButton tone="commit" label="open in RHVAC" onClick={noop} reason="Leaves Pe.Tools" />
        </CounterExample>
      </Law>

      <Law
        name="selection is a fill"
        owner={owner("selection is a fill")}
        ruling="Selection, focus, and hover use neutral fills. They never buy a meaning hue."
      >
        <Press state="selected" aria-pressed>
          selected row
        </Press>
        <CounterExample why="Pea green would claim authorship, not selection">
          <FactChip tone="pea" title="Selected row">
            selected row
          </FactChip>
        </CounterExample>
      </Law>
    </>
  );
}
