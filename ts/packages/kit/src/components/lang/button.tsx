import type { Tone } from "../../lib/token";
/** Every control that acts. `label` is its name (and its tooltip when it draws only a glyph);
 *  `refusal` keeps it focusable, inert, and says why. No children draws an icon-only square. */
import { isValidElement, type ComponentProps, type ReactElement, type ReactNode } from "react";
import { ArrowLeft, ArrowRight, ExternalLink, type LucideIcon } from "lucide-react";

import { Tooltip, TooltipTrigger, TooltipContent } from "./tooltip";

import "./button.css";

const NAV_ICON = { back: ArrowLeft, forward: ArrowRight, out: ExternalLink };

export type ButtonProps = Omit<
  ComponentProps<"button">,
  "className" | "title" | "aria-label" | "aria-pressed" | "disabled"
> &
  (
    | { kind?: "quiet" | "framed" | "commit"; direction?: never }
    | { kind: "nav"; direction: keyof typeof NAV_ICON }
  ) & {
    label: string;
    refusal?: string | null;
    busy?: boolean;
    reason?: string;
    pressed?: boolean;
    icon?: LucideIcon | ReactElement;
    "data-tone"?: Tone;
  };

export function Button({
  label,
  refusal,
  busy,
  reason,
  pressed,
  icon,
  kind = "quiet",
  direction,
  children,
  type,
  onClick,
  id,
  "data-tone": toneProp,
  ...props
}: ButtonProps) {
  const inert = refusal != null || busy === true;
  const tone = toneProp ?? (kind === "commit" && !inert ? "commit" : undefined);
  const Glyph = direction ? NAV_ICON[direction] : icon;
  const iconOnly = children == null || children === false;
  const tipped = Glyph != null || iconOnly || refusal !== undefined || reason != null;
  const tip = refusal ?? reason ?? (Glyph != null || iconOnly ? label : null);
  const named = busy ? `${label}…` : label;
  const button = (
    <button
      type={type ?? "button"}
      className={
        kind === "framed" || kind === "commit"
          ? "dl-button dl-control t-small"
          : "dl-button t-small"
      }
      data-kind={kind}
      data-icon-only={iconOnly ? "" : undefined}
      data-tone={tone}
      data-fill={tone === "commit" ? "solid" : undefined}
      data-wash={toneProp ? "" : undefined}
      aria-label={named}
      aria-pressed={pressed}
      aria-disabled={inert || undefined}
      aria-busy={busy || undefined}
      onClick={inert ? undefined : onClick}
      {...(!tipped && id ? { id } : {})}
      {...props}
    >
      {Glyph == null ? null : isValidElement(Glyph) ? (
        Glyph
      ) : (
        <GlyphOf icon={Glyph as LucideIcon} />
      )}
      {typeof children === "string" ? (
        // No native title (the hint guard): the full label stays the button's accessible name.
        // ponytail: a cut label has no hover hint; measure on pointer entry like Row if missed.
        <span className="dl-button-label">{busy ? `${children}…` : children}</span>
      ) : (
        (children as ReactNode)
      )}
    </button>
  );
  if (!tipped) return button;
  return (
    <Tooltip>
      {/* A composing trigger's id (a Popover's) is the tooltip trigger's id too: Base UI finds
          its hovered trigger by id, so two ids on one button silently kill the tooltip. */}
      <TooltipTrigger render={button} id={id} />
      {tip == null ? null : <TooltipContent>{tip}</TooltipContent>}
    </Tooltip>
  );
}

function GlyphOf({ icon: Glyph }: { icon: LucideIcon }) {
  return <Glyph strokeWidth={1.75} aria-hidden />;
}

/** A labelled lane of buttons; blast radius is a label, never a hue. */
export function ActionGroup({
  title,
  radius,
  children,
}: {
  title: string;
  radius?: string;
  children: ReactNode;
}) {
  return (
    <div>
      <div className="mb-1.5 flex items-baseline gap-1.5 border-b border-line pb-[3px]">
        <span className="t-small t-upper text-ink">{title}</span>
        {radius != null ? <span className="t-small face-mono text-ink-2">{radius}</span> : null}
      </div>
      <div className="flex flex-wrap items-start gap-1.5">{children}</div>
    </div>
  );
}
