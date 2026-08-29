/**
 * CELL-STATE KEY — a first-class entity, not a legend strip.
 *
 * CONSUMER: any route that mounts `StateCell`. It belongs INSIDE the artifact frame of the thing
 * it describes (the table's recess foot), not beside it — the key describes the table, so making
 * it a fifth framed object would spend the border budget on a caption.
 *
 * RULINGS EMBODIED:
 * - ROUND-2 RULING NOTE 2 promoted the key to a first-class entity: it was instrumental to the
 *   table reading at all, and its open design work — how cell states sort and group inside it —
 *   was handed to this step and answered here: **grouped BY AXIS, ordered inside a group by the
 *   cell's own precedence.** Capability outranks pea's proposal; the squiggle family runs
 *   drift ▸ stale ▸ unverified; the unsaved square composes last.
 * - EVERY SPECIMEN IS A REAL `StateCell` WITH REAL PROPS. That is the point: a key drawn with its
 *   own markup can teach a treatment the table does not use, and eventually will. This one
 *   cannot lie, because it renders through the same component.
 * - The axis names stay quiet (`--pe-ink-2`, 9.5px mono) — this is a key, not a legend poster.
 *
 * ponytail: the axes are a fixed list, not a subset derived from the rows on screen. A real key
 * would drop axes the table never exercises; nothing has ruled how to detect that, and the
 * five-axis block was what the round judged. Upgrade path: take the rendered rows and filter.
 */
import { tv } from "#/lib/tv";

import { StateCell } from "./cell";

import "./lang.css";

export const cellStateKeyRecipe = tv({
  slots: {
    base: "grid grid-cols-[repeat(auto-fit,minmax(168px,1fr))] gap-x-[18px] gap-y-[9px] border-t border-line on-recess px-2.5 pt-2 pb-[9px]",
    axis: "flex min-w-0 flex-col gap-[3px]",
    head: "flex items-baseline gap-[5px] border-b border-line pb-0.5",
    name: "face-mono t-caption t-upper text-ink-2",
    asks: "min-w-0 overflow-hidden text-ellipsis whitespace-nowrap t-caption text-ink-mute italic",
    item: "grid grid-cols-[minmax(0,auto)_minmax(0,1fr)] items-baseline gap-[7px] t-label text-ink-2 [&_.dl-cell]:face-mono [&_.dl-cell]:t-value [&_.dl-sq]:face-mono [&_.dl-sq]:t-value [&_.dl-sq]:text-ink [&_.dl-cite]:face-mono [&_.dl-cite]:t-value [&_.dl-cite]:text-ink",
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
      // GRAMMAR GAP: `readonly` and `excluded` are two different refusals — a formula
      // drives it · the model never bound it — and render as ONE greyed-italic body. The key can
      // only show what the cell draws, so it shows one specimen and names both.
      {
        label: "locked — formula-driven or excluded",
        specimen: <StateCell value="84 in" cap="readonly" />,
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
