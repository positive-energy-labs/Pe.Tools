import { FactChip } from "@pe/kit/lang/chip";
import { StateCell } from "@pe/kit/lang/cell";
import { Button } from "@pe/kit/lang/button";
import { Input } from "@pe/kit/lang/input";
import { KeyHint } from "@pe/kit/lang/key-hint";
import { ProviderMark } from "#/components/lang/provider-mark";
import { Switcher } from "@pe/kit/lang/switcher";
import { GitFork, Paperclip, Plus, SendHorizontal } from "lucide-react";
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
        ruling="Chrome text has one size (small, 12px): controls, tabs, group heads, counts, kbd and meta lines; weight and ink differentiate. Mono marks machine readings, and upper case marks section heads."
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

      <Law
        name="one control family"
        owner={owner("one control family")}
        ruling="Every freestanding control wears one frame: one height (--control-h), one hairline, one small radius, one ground. Surfaces, rows, fills, popovers and dialogs are square. A segmented control, a field, a framed press and a framed icon press measure identical side by side."
      >
        <div className="flex flex-wrap items-center gap-2">
          <Switcher
            ariaLabel="family switch"
            value="threads"
            onChange={() => {}}
            options={[
              { value: "threads", label: "threads", title: "The thread list" },
              { value: "world", label: "world", title: "The world lane" },
            ]}
          />
          <span className="w-48">
            <Input placeholder="Search threads" aria-label="family field" />
          </span>
          <Button kind="framed" label="fork">
            fork
          </Button>
          <Button icon={Plus} label="New thread" kind="framed" />
          <Button icon={Paperclip} label="Attach a file" />
          <Button icon={GitFork} label="Fork" refusal="Nothing to fork yet: the thread is empty" />
          <Button icon={SendHorizontal} label="Send" />
          <KeyHint hotkey="Mod+K" />
        </div>
      </Law>

      <Law
        name="who runs it, as a mark"
        owner={owner("who runs it, as a mark")}
        ruling="A thread's harness is a monochrome glyph in the ink of its line, one em tall, beside the words that name it. The mark deepens the name; it never replaces it."
      >
        <div className="flex flex-col gap-2 t-prose text-ink-2">
          <span className="inline-flex items-center gap-1.5">
            <ProviderMark harness="claude" /> Claude Code · opus
          </span>
          <span className="inline-flex items-center gap-1.5">
            <ProviderMark harness="codex" /> Codex · gpt-6.1-sol
          </span>
          <span className="inline-flex items-center gap-1.5">
            <ProviderMark harness="pea" /> Pea, or a harness with no mark
          </span>
          <span className="t-head inline-flex items-center gap-3 text-ink">
            <ProviderMark harness="claude" />
            <ProviderMark harness="codex" />
            <ProviderMark harness={undefined} />
          </span>
        </div>
      </Law>
    </>
  );
}

/** The same primitives, once per register: what moves is the tokens, never the call site. */
