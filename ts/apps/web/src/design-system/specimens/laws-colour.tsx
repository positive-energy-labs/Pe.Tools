import { FactChip } from "#/components/lang/chip";
import { StateCell } from "#/components/lang/cell";
import { Button } from "#/components/lang/button";
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
          <Button
            kind="commit"
            label="ask pea"
            onClick={noop}
            reason="Asks Pea to inspect this value"
          >
            ask pea
          </Button>
        </CounterExample>
      </Law>

      <Law
        name="one filled blue"
        owner={owner("one filled blue")}
        ruling="The only filled blue is the verb that writes beyond the page. Navigation uses the same role as text, never as a fill."
      >
        <div className="flex flex-wrap items-center gap-2">
          <Button
            kind="commit"
            label="apply to Revit"
            onClick={noop}
            reason="Writes 42 parameters into the model"
          >
            apply to Revit
          </Button>
          <Button
            kind="nav"
            direction="out"
            label="open in RHVAC"
            onClick={noop}
            reason="Leaves Pe.Tools"
          >
            open in RHVAC
          </Button>
        </div>
        <CounterExample why="opening another surface is navigation, not a write">
          <Button kind="commit" label="open in RHVAC" onClick={noop} reason="Leaves Pe.Tools">
            open in RHVAC
          </Button>
        </CounterExample>
      </Law>

      <Law
        name="selection is a fill"
        owner={owner("selection is a fill")}
        ruling="Selection, focus, and hover use neutral fills. They never buy a meaning hue."
      >
        <Button label="selected row" pressed>
          selected row
        </Button>
        {/* The pick mark: the feedback picker's target, veil plus ink outline over any content. */}
        <span className="relative w-fit">
          <Button
            kind="framed"
            label="picked for a note"
            onClick={noop}
            reason="Pick mark specimen"
          >
            picked for a note
          </Button>
          <span className="pick-mark absolute inset-0" />
        </span>
        <CounterExample why="Pea green would claim authorship, not selection">
          <FactChip tone="pea" title="Selected row">
            selected row
          </FactChip>
        </CounterExample>
      </Law>
    </>
  );
}
