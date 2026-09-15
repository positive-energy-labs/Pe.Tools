/**
 * VERB — every control that acts, rebuilt against the design language.
 *
 * CONSUMERS: soon — the family clean-room's verb lane, the takeoff panes, the chat card's
 * accept/deny. `components/ui/verb.tsx` still serves the unmigrated routes; absorbing it is the
 * per-route normalization phase's job, not this file's.
 *
 * RULINGS EMBODIED:
 * - THE ROUND-1 GAP CENSUS against canon `ui/verb`, all five builders independently:
 *     · no ICON SLOT — the three nav directions are only legible as icons. Fixed: `icon`, and
 *       `direction` supplies nav's arrow for free.
 *     · no FILLED tone — every variant that took a commit position contested the bordered blue.
 *       Fixed: `commit` is a filled blue, and it is the ONLY filled blue in the language.
 *     · no AGENT tone — the agent's identity had no interaction slot, which
 *       made pea's own verb illegal (4/5 builders hit this). Fixed: `agent`.
 *     · `reason` is REQUIRED, always. The constructor argument is the enforcement (§3): every
 *       refusal at every call site has an explanation. RULED 2026-08-16 (kaitpw, on the live
 *       takeoffs header): the reason's home is the TITLE — dense chrome never pays a second
 *       line for it, and four near-identical refusal sentences under one verb lane read as
 *       noise, not honesty. AMENDED at the fit-review sitting (2026-08-16): a DISABLED `commit`
 *       verb is the one exception — its reason renders visibly as a small quiet line beside the
 *       verb (no new slot, no new component), because the highest-stakes refusal on a page must
 *       pass §0's "why is that one disabled, without tooltips" bar and the lane-spam problem
 *       never applied to the lone page-blast verb. All other tones stay title-only.
 *     · mono type collided with "mono means the machine measured this". Verbs are sans now.
 * - BLAST RADIUS IS NOT A TONE. It groups the lane and buys no hue: all three writes wear the
 *   same single blue however far they reach. That is `ActionGroup`, below.
 * - NAV SPLITS THREE WAYS — back, forward, out — because browsers already taught the difference.
 *   `open in RHVAC` is nav:out; `sync to .r10` is a write, not a nav. `direction` is required on
 *   nav so the split cannot be skipped.
 * - THE ONE HOVER LAW: a 10% ink veil composited as a background-IMAGE over whatever fill the
 *   control already carries, with a `:focus-visible` twin. Hover buys no hue. Disabled takes
 *   neither. Round 2 found four ad-hoc hover treatments, two of which lit `--pe-select` — a token
 *   that means SELECTION. See lang.css.
 * - DISABLED IS GREYED-ITALIC AND STILL READABLE: recessed ground so the slot has a shape, firm
 *   hairline so the shape has an edge, italic secondary ink so it is plainly not for pressing.
 *   A refusal a newcomer cannot decipher is indistinguishable from a rendering bug.
 */
import { createContext, useContext } from "react";
import { ArrowLeft, ArrowRight, ExternalLink, type LucideIcon } from "lucide-react";

import { tv } from "#/lib/tv";

import "./lang.css";

export const actionRecipe = tv({
  slots: {
    base: "veil inline-flex h-(--item-h) cursor-pointer items-center gap-[5px] whitespace-nowrap border border-transparent bg-transparent px-2 t-small font-medium text-ink focus-visible:outline focus-visible:outline-line-2 disabled:cursor-not-allowed disabled:border-line-2 disabled:text-ink-2 disabled:italic [&>svg]:size-[13px] [&>svg]:shrink-0",
    reason: "max-w-[36ch] self-center t-small face-mono text-ink-2 italic",
    group: "",
    groupHead: "mb-1.5 flex items-baseline gap-1.5 border-b border-line pb-[3px]",
    groupTitle: "t-small t-upper text-ink",
    groupRadius: "t-small face-mono text-ink-2",
    row: "flex flex-wrap items-start gap-1.5",
  },
  variants: {
    tone: {
      act: { base: "ink-wash" },
      commit: { base: "" },
      nav: { base: "px-1 text-nav enabled:hover:underline enabled:hover:underline-offset-3" },
      agent: { base: "" },
    },
  },
  defaultVariants: { tone: "act" },
});

/** `nav` is separated out at the type level because it alone requires a `direction`. */
export type ActionTone = "act" | "commit" | "nav" | "agent";

/** The three directions browsers already taught. Each supplies its own arrow. */
export type NavDirection = "back" | "forward" | "out";

const NAV_ICON: Record<NavDirection, LucideIcon> = {
  back: ArrowLeft,
  forward: ArrowRight,
  out: ExternalLink,
};

interface VerbBase {
  label: string;
  onClick: () => void;
  /**
   * What the verb MEANS and what pressing it DOES — or, when `disabled`, why it will not.
   * Always required — the constructor argument is what guarantees every refusal has an
   * explanation — and carried as the control's title (ruled 2026-08-16: hover is the reason's
   * home; a visible line under every refused verb made dense chrome wrap and repeat itself).
   * EXCEPTION (fit reviews, 2026-08-16): a disabled `commit` verb ALSO renders it visibly,
   * as a small quiet line beside the verb.
   */
  reason: string;
  disabled?: boolean;
  /** In flight. Inert, but not a refusal — no reason line renders. */
  busy?: boolean;
}

export type ActionButtonProps =
  | (VerbBase & {
      tone?: "act" | "commit" | "agent";
      icon?: LucideIcon;
      direction?: never;
    })
  | (VerbBase & {
      tone: "nav";
      /** Required: the direction IS the icon, and the three-way split is a standing ruling. */
      direction: NavDirection;
      icon?: never;
    });

/**
 * CHROME (a pane header, ruled at annotation round 2, 2026-08-31): the un-gagged commit verb's
 * reason renders as a PARAGRAPH, which a 32px header has no room for — measured, the `/family`
 * parameters header's action row was 48px inside a 32px header with two 36ch paragraphs wrapping
 * to three lines under the verbs beside them. In chrome a refusal renders as `title` like every
 * other tone; the inline paragraph belongs to ceremony strips, where settled law gives it room.
 * Re-openable: if a header ever needs the visible refusal back, it needs a taller header first.
 */
const VerbChromeContext = createContext(false);

/** Marks a region as chrome — see `VerbChromeContext`. The pane header is its one consumer. */
export const ActionChrome = VerbChromeContext.Provider;

export function ActionButton(props: ActionButtonProps) {
  const { label, onClick, reason, disabled, busy } = props;
  // Narrow on `props.tone`, not on the defaulted local — the discriminant is what carries
  // `direction` into scope.
  const Icon = props.tone === "nav" ? NAV_ICON[props.direction] : props.icon;
  const tone = props.tone ?? "act";
  const inert = disabled === true || busy === true;
  const chrome = useContext(VerbChromeContext);
  const slots = actionRecipe({ tone });

  return (
    <>
      <button
        type="button"
        className={slots.base()}
        data-tone={
          !inert && tone === "commit" ? "commit" : !inert && tone === "agent" ? "pea" : undefined
        }
        data-fill={!inert && tone === "commit" ? "solid" : undefined}
        data-wash={!inert && tone === "agent" ? "" : undefined}
        data-surface={inert ? "recess" : undefined}
        disabled={inert}
        onClick={onClick}
        title={reason}
      >
        {Icon != null ? <Icon /> : null}
        {busy === true ? `${label}…` : label}
      </button>
      {/* THE UN-GAGGED COMMIT (fit reviews, ruled 2026-08-16): only a disabled commit verb says
          its reason on the surface; busy is not a refusal and every other tone keeps the title. */}
      {tone === "commit" && disabled === true && !chrome ? (
        <span className={slots.reason()}>{reason}</span>
      ) : null}
    </>
  );
}

export interface ActionGroupProps {
  /** What this group of verbs has in common, e.g. "writes beyond the page". */
  title: string;
  /** The blast radius in words, e.g. "document · model · external". Grouping's whole payload. */
  radius?: string;
  children: React.ReactNode;
}

/**
 * A labelled lane of verbs. Blast radius is an orthogonal descriptor of a verb, not a reason for
 * more hues (settled before base 2, unchallenged since) — so it lives here, as a LABEL, and the
 * verbs inside keep their tones.
 *
 * BORDER BUDGET: a lane of plain controls carries no state, so it is deliberately NOT wrapped in
 * an `ArtifactFrame`. The group head is all the grouping it is allowed to buy.
 */
export function ActionGroup({ title, radius, children }: ActionGroupProps) {
  const slots = actionRecipe();
  return (
    <div className={slots.group()}>
      <div className={slots.groupHead()}>
        <span className={slots.groupTitle()}>{title}</span>
        {radius != null ? <span className={slots.groupRadius()}>{radius}</span> : null}
      </div>
      <div className={slots.row()}>{children}</div>
    </div>
  );
}
