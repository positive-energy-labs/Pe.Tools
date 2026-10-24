import { elementKey, useMention } from "./attention";
import { reachProps } from "./reach";
import type { Tone } from "../../lib/token";
/**
 * Two chips: `FactChip` is a machine-measured state fact (no press), `NarrowChip` a removable
 * narrowing that scopes the view and never hides rows. `title` is required on both; tone comes from
 * the meaning tokens only, and `dashed` means seam (typed but unproven) and nothing else.
 */
import { Fragment, type ReactNode } from "react";
import { X } from "lucide-react";

import { useRevitTarget } from "./revit-target";
import { Button } from "./button";
import { HoverCard, HoverCardTrigger, HoverCardContent } from "./hover-card";

import { tv } from "../../lib/tv";

import "./lang.css";
import { TooltipHint } from "./tooltip";

export const chipRecipe = tv({
  slots: {
    base: "inline-flex h-[calc(var(--item-h)-4px)] max-w-[34ch] items-center gap-1 overflow-hidden whitespace-nowrap rounded-sm border border-line px-(--control-pad-x) t-small face-mono text-ink-2",
    label: "min-w-0 overflow-hidden text-ellipsis whitespace-nowrap",
    count: "text-ink-mute tabular-nums",
    remove:
      "veil grid size-3 cursor-pointer place-items-center border-0 bg-transparent text-ink-2 [&>svg]:size-[9px]",
    tag: "t-small tabular-nums",
  },
  variants: {
    state: {
      solid: {},
      seam: { base: "seam-border" },
    },
  },
  defaultVariants: { state: "solid" },
});

interface FactChipProps {
  revit?: readonly number[];
  children: React.ReactNode;
  /** Omitted is a neutral machine-measured fact — most chips are this. */
  tone?: Tone;
  /** Seam: typed but unproven. Reserved border style; see the header. */
  dashed?: boolean;
  /** Required: what the fact means and what would change it. */
  title: string;
}

/** A state fact, machine-measured, so mono. Not a control — it has no press. */
export function FactChip({ children, tone, dashed, title, revit }: FactChipProps) {
  const target = useRevitTarget(revit);
  const mark = useMention();
  const { base, label } = chipRecipe({ state: dashed ? "seam" : "solid" });
  return (
    <TooltipHint content={title}>
      <span
        {...reachProps()}
        {...mark(revit?.[0] == null ? null : elementKey(revit[0]))}
        {...target}
        className={base()}
        data-tone={tone}
        data-surface="artifact"
        data-seam={dashed === true ? "" : undefined}
      >
        <span className={label()}>{children}</span>
      </span>
    </TooltipHint>
  );
}

interface NarrowChipProps {
  /** The narrowing itself, e.g. "needs a person" or "type: FDCL-611". */
  label: string;
  /** How many rows this narrowing still admits. Narrowings never hide; they scope. Omitted where
   * the frame already says it (a condition chip beside "n of m rows"). */
  count?: number;
  /** Removing widens the view back out. */
  onRemove: () => void;
  /** Required: what this narrowing does to the view. */
  title: string;
  /** A narrowing the grammar could not read: it admits nothing and says so. */
  caution?: boolean;
  /** Present, the label is a press that reopens the narrowing for editing. */
  onEdit?: () => void;
  /** What the narrowing says of `label` (a condition's "> 1"): it truncates only after the label. */
  detail?: string;
}

/** A removable narrowing control. Same shell as a fact, one affordance more. */
export function NarrowChip({
  label,
  count,
  onRemove,
  title,
  caution,
  onEdit,
  detail,
}: NarrowChipProps) {
  const slot = chipRecipe();
  const said = detail ? `${label} ${detail}` : label;
  return (
    <TooltipHint content={title}>
      <span
        className={slot.base()}
        data-tone={caution ? "caution" : undefined}
        data-surface="artifact"
      >
        {/* One width for every narrowing (the base's cap); the full text rides the title. */}
        {onEdit ? (
          <TooltipHint content={`${said} — click to edit`}>
            <button
              type="button"
              className="flex min-w-0 cursor-pointer items-center gap-[5px]"
              aria-label={said}
              onClick={onEdit}
            >
              <span className={slot.label()}>{label}</span>
              {detail && <span className={slot.label({ class: "text-ink" })}>{detail}</span>}
            </button>
          </TooltipHint>
        ) : (
          <TooltipHint content={`${said} — ${title}`}>
            <span className={slot.label()}>{said}</span>
          </TooltipHint>
        )}
        {count !== undefined && <span className={slot.count()}>{count}</span>}
        <TooltipHint content={`Remove the "${said}" narrowing — widens the view back out`}>
          <button
            type="button"
            className={slot.remove()}
            onClick={onRemove}
            aria-label={`Remove the "${said}" narrowing`}
          >
            <X />
          </button>
        </TooltipHint>
      </span>
    </TooltipHint>
  );
}

/** The small tag that names a state or an object: caption size in the body face, as authored
 *  (caps belong to section heads), tabular numerals. A phase may tint it inside the arming strip;
 *  nowhere else. */
export function Tag({ children }: { children: React.ReactNode }) {
  const { tag } = chipRecipe();
  return <span className={tag()}>{children}</span>;
}

interface FileChipProps {
  name: string;
  /** A measured fact after the name, e.g. the formatted size. */
  meta?: string;
  /** What the chip is, for the hover. */
  title: string;
  /** Drawn before the name, e.g. an image thumbnail. */
  lead?: ReactNode;
  /** Present, the name opens the file outside the page (a nav-out press). */
  open?: () => void;
  /** Present, the chip carries a remove press. */
  onRemove?: () => void;
}

interface MentionChipProps {
  /** What the `@` token says. */
  label: string;
  /** The kind word after the label: document, skill, route, op. */
  kind: string;
  /** The pointer Pea reads again when the snapshot is stale (`doc:<session>/<openId>`). */
  pointer: string;
  /** The snapshot Pea received, shown on hover. */
  facts: Record<string, string | number | boolean | null>;
  /** When `facts` were read (ISO). */
  takenAt: string;
  onRemove?: () => void;
}

/** An `@` mention: label and kind; hover inspects what the agent received (pointer, facts, when read). */
export function MentionChip({ label, kind, pointer, facts, takenAt, onRemove }: MentionChipProps) {
  const { base, label: name, count } = chipRecipe();
  const rows = Object.entries(facts).filter(([, value]) => value !== null && value !== "");
  return (
    <HoverCard>
      <HoverCardTrigger
        render={<span tabIndex={0} />}
        nativeButton={false}
        // A title plus its kind word: wider than a fact, still one line.
        className={base({ class: "max-w-[48ch]" })}
        data-surface="artifact"
        aria-label={`@${label}, ${kind}`}
      >
        <span className={name()}>@{label}</span>
        <span className={count()}>{kind}</span>
        {onRemove ? <Button icon={X} label={`Remove @${label}`} onClick={onRemove} /> : null}
      </HoverCardTrigger>
      <HoverCardContent side="top" aria-label={`Snapshot of ${label}`}>
        <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5">
          <span className="text-ink-2">what the agent received</span>
          <span className="face-mono break-all">{pointer}</span>
          {rows.map(([fact, value]) => (
            <Fragment key={fact}>
              <span className="text-ink-2">{fact}</span>
              <span className="face-mono break-words">{String(value)}</span>
            </Fragment>
          ))}
          <span className="text-ink-2">read</span>
          <time className="face-mono" dateTime={takenAt}>
            {new Date(takenAt).toLocaleString()}
          </time>
        </div>
      </HoverCardContent>
    </HoverCard>
  );
}

/** One file as a chip: optional lead, the name (a nav-out press when it opens), its size, remove. */
export function FileChip({ name, meta, title, lead, open, onRemove }: FileChipProps) {
  const { base, label, count } = chipRecipe();
  return (
    <TooltipHint content={title}>
      <span
        className={base({ class: lead ? "h-auto py-[3px]" : undefined })}
        data-surface="artifact"
      >
        {lead}
        {open ? (
          <Button kind="nav" direction="out" label={`Open ${name}`} onClick={open}>
            <span className={label()}>{name}</span>
          </Button>
        ) : (
          <span className={label()}>{name}</span>
        )}
        {meta ? <span className={count()}>{meta}</span> : null}
        {onRemove ? <Button icon={X} label={`Remove ${name}`} onClick={onRemove} /> : null}
      </span>
    </TooltipHint>
  );
}
