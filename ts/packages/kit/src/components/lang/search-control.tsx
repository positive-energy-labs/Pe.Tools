import type { ComponentProps, KeyboardEvent, ReactNode } from "react";
import { Search } from "lucide-react";
import { cn } from "../../lib/utils";
import "./lang.css";

/**
 * One search frame: an optional leading segment (a picker), then the field — `chips` wrapping
 * ahead of the input, the glyph sitting directly beside the input so it never strands before the
 * chips — then an optional trailing press (a modifier such as `not`). `children` is the input (and anything that must stay next to it). `face` follows placement:
 * `framed` wherever the query is a control among others, `bar` where it heads a list edge to edge.
 */
export function SearchControl({
  children,
  chips,
  lead,
  trail,
  face = "framed",
  className,
  onClick,
  ...props
}: ComponentProps<"div"> & {
  /** A leading control segment, divided from the field by a hairline; clicking it never focuses the input. */
  lead?: ReactNode;
  /** A press at the field's end that modifies the query (`not`); it keeps its own frame. */
  trail?: ReactNode;
  /** Words already in the query, drawn ahead of the input. */
  chips?: ReactNode;
  /** `framed`: the control frame. `bar`: a full-bleed command line with a hairline under it. */
  face?: "framed" | "bar";
}) {
  return (
    <div
      {...props}
      data-search-control=""
      data-face={face}
      className={cn(face === "framed" && "dl-control", "dl-search t-small", className)}
      onClick={(event) => {
        onClick?.(event);
        // React bubbles portal clicks (a lead's popover rows) here: only the frame's own DOM focuses.
        const target = event.target as Element;
        if (
          !event.defaultPrevented &&
          event.currentTarget.contains(target) &&
          !target.closest("button,a,input,textarea,select,[data-search-lead]")
        )
          event.currentTarget.querySelector("input")?.focus();
      }}
    >
      {lead ? (
        <span
          data-search-lead=""
          className="flex shrink-0 items-stretch self-stretch hairline-r"
          onKeyDownCapture={ownKeys}
        >
          {lead}
        </span>
      ) : null}
      <div
        data-search-field=""
        className="flex min-w-0 flex-1 flex-wrap items-center gap-x-1 gap-y-px px-(--control-pad-x)"
      >
        {chips}
        <span className="flex min-w-[min(100%,var(--search-input-min,26ch))] flex-1 items-center gap-1">
          <Search aria-hidden data-search-glyph="" className="size-3 shrink-0" />
          {children}
        </span>
      </div>
      {trail ? (
        <span
          data-search-trail=""
          className="flex shrink-0 items-center"
          onKeyDownCapture={ownKeys}
        >
          {trail}
        </span>
      ) : null}
    </div>
  );
}

/** The typed characters inside a suggestion. Weight means unsaved (house law 6), so the match is
 *  full ink and the rest recedes to ink-2: contrast, not bold and not a hue. */
export function Matched({ text, needle }: { text: string; needle: string }) {
  const at = needle ? text.toLowerCase().indexOf(needle.toLowerCase()) : -1;
  if (at < 0) return <>{text}</>;
  return (
    <span className="text-ink-2" data-matched="">
      {text.slice(0, at)}
      <span className="text-ink">{text.slice(at, at + needle.length)}</span>
      {text.slice(at + needle.length)}
    </span>
  );
}

/** The completion Tab or → would accept, drawn after the typed text in the input's own font.
 *  `ghost` is only the untyped remainder; the caller decides when one exists. */
export function CompletionGhost({
  value,
  ghost,
  children,
}: {
  value: string;
  ghost: string;
  children: ReactNode;
}) {
  return (
    <span className="relative flex min-w-0 flex-1 items-center">
      {children}
      {ghost ? (
        // ponytail: aligned only while the typed text fits; an overflowing input hides the ghost.
        <span
          aria-hidden
          data-completion-ghost=""
          className="pointer-events-none absolute inset-0 flex items-center overflow-hidden whitespace-pre"
        >
          <span className="invisible">{value}</span>
          <span className="text-ink-mute">{ghost}</span>
        </span>
      ) : null}
    </span>
  );
}

/** An attached control activates itself; a surrounding picker must not also pick a row. */
function ownKeys(event: KeyboardEvent<HTMLSpanElement>) {
  if (
    (event.key === "Enter" || event.key === " ") &&
    event.currentTarget.contains(event.target as Node)
  )
    event.stopPropagation();
}
