/**
 * Two chips: `FactChip` is a machine-measured state fact (no press), `NarrowChip` a removable
 * narrowing that scopes the view and never hides rows. `title` is required on both; tone comes from
 * the meaning tokens only, and `dashed` means seam (typed but unproven) and nothing else.
 */
import { Fragment, type ReactNode } from "react";
import { Tooltip as TooltipPrimitive } from "@base-ui/react/tooltip";
import { X } from "lucide-react";

import { Button } from "#/components/lang/button";
import { Tooltip } from "#/components/lang/tooltip";

import { tv } from "#/lib/tv";

import "./lang.css";

export const chipRecipe = tv({
  slots: {
    base: "inline-flex h-[calc(var(--item-h)-4px)] max-w-[34ch] items-center gap-1 overflow-hidden whitespace-nowrap rounded-sm border border-line px-(--control-pad-x) t-small face-mono text-ink-2",
    label: "min-w-0 overflow-hidden text-ellipsis whitespace-nowrap",
    count: "text-ink-mute tabular-nums",
    remove:
      "veil grid size-3 cursor-pointer place-items-center border-0 bg-transparent text-ink-2 focus-visible:outline focus-visible:outline-line-2 [&>svg]:size-[9px]",
    tag: "t-small t-upper tabular-nums",
  },
  variants: {
    tone: {
      meta: {},
      caution: {},
      done: {},
      alarm: {},
      pea: {},
    },
    state: {
      solid: {},
      seam: { base: "seam-border" },
    },
  },
  defaultVariants: { tone: "meta", state: "solid" },
});

/** The meaning roles a fact may wear. No chip-only hues exist, by design. */
type FactTone = "meta" | "caution" | "done" | "alarm" | "pea";

interface FactChipProps {
  children: React.ReactNode;
  /** `meta` (the default) is the neutral machine-measured fact — most chips are this. */
  tone?: FactTone;
  /** Seam: typed but unproven. Reserved border style; see the header. */
  dashed?: boolean;
  /** Required: what the fact means and what would change it. */
  title: string;
}

/** A state fact, machine-measured, so mono. Not a control — it has no press. */
export function FactChip({ children, tone = "meta", dashed, title }: FactChipProps) {
  const { base, label } = chipRecipe({ tone, state: dashed ? "seam" : "solid" });
  return (
    <span
      className={base()}
      data-tone={tone === "meta" ? undefined : tone}
      data-surface="artifact"
      data-seam={dashed === true ? "" : undefined}
      title={title}
    >
      <span className={label()}>{children}</span>
    </span>
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
  const slot = chipRecipe({ tone: caution ? "caution" : "meta" });
  const said = detail ? `${label} ${detail}` : label;
  return (
    <span
      className={slot.base()}
      data-tone={caution ? "caution" : undefined}
      data-surface="artifact"
      title={title}
    >
      {/* One width for every narrowing (the base's cap); the full text rides the title. */}
      {onEdit ? (
        <button
          type="button"
          className="flex min-w-0 cursor-pointer items-center gap-[5px]"
          aria-label={said}
          title={`${said} — click to edit`}
          onClick={onEdit}
        >
          <span className={slot.label()}>{label}</span>
          {detail && <span className={slot.label({ class: "text-ink" })}>{detail}</span>}
        </button>
      ) : (
        <span className={slot.label()} title={`${said} — ${title}`}>
          {said}
        </span>
      )}
      {count !== undefined && <span className={slot.count()}>{count}</span>}
      <button
        type="button"
        className={slot.remove()}
        onClick={onRemove}
        title={`Remove the "${said}" narrowing — widens the view back out`}
      >
        <X />
      </button>
    </span>
  );
}

/** The small mono tag that names a state or an object: quiet caption-size caps,
 *  tabular numerals. A phase may tint it inside the arming strip; nowhere else. */
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

/** An `@` mention: label and kind; hover inspects what Pea received (pointer, facts, when read). */
export function MentionChip({ label, kind, pointer, facts, takenAt, onRemove }: MentionChipProps) {
  const { base, label: name, count } = chipRecipe();
  const rows = Object.entries(facts).filter(([, value]) => value !== null && value !== "");
  return (
    <Tooltip.Root>
      <TooltipPrimitive.Trigger
        render={<span tabIndex={0} />}
        // A title plus its kind word: wider than a fact, still one line.
        className={base({ class: "max-w-[48ch]" })}
        data-surface="artifact"
        aria-label={`@${label}, ${kind}`}
      >
        <span className={name()}>@{label}</span>
        <span className={count()}>{kind}</span>
        {onRemove ? <Button icon={X} label={`Remove @${label}`} onClick={onRemove} /> : null}
      </TooltipPrimitive.Trigger>
      <Tooltip.Portal>
        <Tooltip.Positioner side="top" align="start" sideOffset={4}>
          <Tooltip.Popup>
            <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5">
              <span className="text-ink-2">what Pea received</span>
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
          </Tooltip.Popup>
        </Tooltip.Positioner>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}

/** One file as a chip: optional lead, the name (a nav-out press when it opens), its size, remove. */
export function FileChip({ name, meta, title, lead, open, onRemove }: FileChipProps) {
  const { base, label, count } = chipRecipe();
  return (
    <span
      className={base({ class: lead ? "h-auto py-[3px]" : undefined })}
      data-surface="artifact"
      title={title}
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
  );
}
