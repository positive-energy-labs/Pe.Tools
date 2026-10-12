/**
 * The cell-state key: grouped by axis, ordered by the cell's precedence. Every specimen is a real
 * `StateCell`, so the key cannot teach a treatment the table does not use. Mount it inside the
 * artifact frame of the thing it describes.
 */
import { tv } from "#/lib/tv";

import { StateCell } from "./cell";

import "./lang.css";

export const cellStateKeyRecipe = tv({
  slots: {
    base: "grid grid-cols-[repeat(auto-fit,minmax(168px,1fr))] gap-x-[18px] gap-y-[9px] border-t border-line on-recess px-2.5 pt-2 pb-[9px]",
    axis: "flex min-w-0 flex-col gap-[3px]",
    head: "flex items-baseline gap-[5px] border-b border-line pb-0.5",
    name: "t-small t-upper",
    asks: "min-w-0 overflow-hidden text-ellipsis whitespace-nowrap t-small face-mono text-ink-mute italic",
    item: "cell-key-values grid grid-cols-[minmax(0,auto)_minmax(0,1fr)] items-baseline gap-[7px] t-small t-upper text-ink-2 [&_.dl-sq]:text-ink [&_.dl-cite]:text-ink",
  },
});

interface KeyAxis {
  axis: string;
  /** The question the axis answers, in the reader's words. */
  asks: string;
  items: { label: string; specimen: React.ReactNode }[];
}

/** In the order the eye needs them: who acted ▸ does the model agree ▸ how old ▸ can it be written. */
const AXES: readonly KeyAxis[] = [
  {
    axis: "event",
    asks: "who is holding an unsaved change?",
    items: [
      {
        label: "pea proposes — fold + green square",
        specimen: <StateCell value="2 hr" stage="proposed" />,
      },
      {
        label: "you staged — bold + your square",
        specimen: <StateCell value="36 in" stage="staged" />,
      },
    ],
  },
  {
    axis: "agreement",
    asks: "does the model hold the same value?",
    items: [
      {
        label: "the model disagrees",
        specimen: <StateCell value="1.75 in" agree="drift" modelValue="1.375 in" />,
      },
    ],
  },
  {
    axis: "freshness",
    asks: "how much do we know about it?",
    items: [
      { label: "stale read", specimen: <StateCell value="5.5 in" fresh="stale" /> },
      {
        label: "unverified — value never checked",
        specimen: <StateCell value="26 in" fresh="unverified" />,
      },
      { label: "never — nothing attempted yet", specimen: <StateCell value="—" fresh="never" /> },
    ],
  },
  {
    axis: "capability",
    asks: "can it be written at all?",
    items: [
      // One refusal rendering: `locked`, with `capReason` saying which refusal it is.
      {
        label: "locked — the reason says which refusal",
        specimen: <StateCell value="84 in" cap="locked" />,
      },
      {
        label: "seam — no element behind it",
        specimen: <StateCell value="412 sf" cap="nohome" />,
      },
    ],
  },
  {
    axis: "grounding",
    asks: "where did the number come from?",
    items: [
      {
        label: "citation — plain underline, on the footline",
        specimen: <StateCell value="2 hr" grounding={{ doc: "RFI-217", page: 2 }} />,
      },
    ],
  },
];

export function CellStateKey() {
  const slots = cellStateKeyRecipe();
  return (
    <div className={slots.base()}>
      {AXES.map((a) => (
        <div key={a.axis} className={slots.axis()}>
          <div className={slots.head()}>
            <span className={slots.name()}>{a.axis}</span>
            <span className={slots.asks()}>{a.asks}</span>
          </div>
          {a.items.map((it) => (
            <span key={it.label} className={slots.item()}>
              {it.specimen}
              <span>{it.label}</span>
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}
