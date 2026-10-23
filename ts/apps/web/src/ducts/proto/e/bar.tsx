import { TooltipHint } from "@pe/kit/lang/tooltip";
/**
 * THROWAWAY (protoui round 3, E2): the loss bar the tree draws, and its one-line legend.
 * Full width is the group's critical run (Pe's largest fan-to-grille total), so the critical row
 * fills its track and every other row reads as a share of it. Unpriced draws no track: an empty bar
 * would read as zero loss.
 */
import { Fragment, type ComponentProps } from "react";
import { fanLoad } from "@pe/ducts-domain/fan-headroom";
import type { Provisional } from "@pe/ducts-domain/losses";
import { revitTarget } from "@pe/kit/lang/row";
import { tokenRef } from "@pe/kit/lib/token";
import { observedElements, useNativeObservation } from "#/revit/observation";

import type { Split, SplitPart } from "../b/model";

export const fmt = (n: number | null | undefined, d = 3) => (n == null ? "—" : n.toFixed(d));

/** Equivalent feet as an engineer reads them: whole feet, one place under ten. */
export const fmtFt = (ft: number | null | undefined) =>
  ft == null ? "—" : Math.abs(ft) < 10 ? ft.toFixed(1) : Math.round(ft).toLocaleString("en-US");

export function BarLegend({
  scale,
  criticalName,
}: {
  scale: number | null;
  criticalName: string | null;
}) {
  return (
    <p className="t-small text-ink-2 border-line border-b px-2 py-1" data-e-legend="">
      {scale == null ? (
        "bars: not priced yet (the ASHRAE tables are not read), so no row draws a bar"
      ) : (
        <>
          eq ft = effective length from the fan to the row's far end, each fitting as equivalent
          feet at its duct's own friction rate (small number: in-wg) · bar = in-wg, full width = the
          critical run ◆ {criticalName ?? "—"} <span className="face-mono">{fmt(scale)}</span>; a
          run's bar splits per element group, inked by part: unit end, ducts &amp; fittings, grille
        </>
      )}
    </p>
  );
}

/** The three parts of a run, in bar order (air order: the unit, the ducts, the grille), each its own ink. */
const PARTS = [
  {
    key: "unit",
    word: "unit end",
    says: "passive devices in series with the fan (coil, dehu)",
    ink: "viz-1",
  },
  {
    key: "duct",
    word: "ducts & fittings",
    says: "straight duct and every fitting between the unit and the grille",
    ink: "ink-2",
  },
  { key: "terminal", word: "grille", says: "the terminal's own drop", ink: "viz-5" },
] as const;

type Light = (ids: readonly number[] | null) => void;

/**
 * A run's loss as abutting segments against `scale`: one per element group (a duct type, a fitting
 * family type, ...), each inked by its part and set off by a hairline of the ground. A segment's
 * width is its in-wg share; hovering one lights the elements that pay it, leaving gives the row's set back.
 */
function SplitFill({
  split,
  scale,
  light,
  back,
  hint = true,
}: {
  split: Split;
  scale: number;
  light?: Light;
  back?: readonly number[];
  /** Each segment its own tooltip. The all-systems list draws none: its row's title carries the hint. */
  hint?: boolean;
}) {
  const observation = useNativeObservation();
  const tip = (content: string, child: ComponentProps<typeof TooltipHint>["children"]) =>
    hint ? <TooltipHint content={content}>{child}</TooltipHint> : child;
  let at = 0;
  return (
    <>
      {PARTS.map(({ key, word, ink }) => {
        const part: SplitPart = split[key];
        const segments = split.groups
          .filter((g) => g.part === key && g.dp > 0)
          .map((group) => {
            const target = observedElements(observation, group.ids);
            const left = at;
            at += group.dp / scale;
            return (
              <Fragment key={group.key}>
                {tip(
                  `${group.label} ${fmt(group.dp, LOSS_PLACES)} in-wg (${Math.round((group.dp / scale) * 100)}% of the fan)`,
                  <span
                    className="absolute inset-y-0"
                    data-e-split={key}
                    data-e-group={group.label}
                    {...revitTarget(target.ids, target.refs)}
                    style={{
                      left: `${left * 100}%`,
                      width: `${Math.min(1 - left, group.dp / scale) * 100}%`,
                      backgroundColor: tokenRef(ink),
                      boxShadow: `inset -1px 0 0 ${tokenRef("page")}`,
                    }}
                    onMouseEnter={light ? () => light(group.ids) : undefined}
                    onMouseLeave={light ? () => light(back ?? null) : undefined}
                  />,
                )}
              </Fragment>
            );
          });
        // Unknown is drawn, never blank: a dashed stub past any known share. Ducts skip it: an unpriced
        // fitting already says so on its own row, and its stub would sit on the grille's.
        const target = observedElements(observation, part.ids);
        const stub =
          part.unpriced > 0 && key !== "duct" ? (
            <TooltipHint
              key={`${key}?`}
              content={`${word}: ${part.unpriced} with no drop, so this part is unknown (not zero)`}
            >
              <span
                className="absolute -inset-y-px w-1.5 border border-dashed"
                data-e-split={`${key}-unpriced`}
                {...revitTarget(target.ids, target.refs)}
                style={{ left: `min(${at * 100}%, calc(100% - 6px))`, borderColor: tokenRef(ink) }}
                onMouseEnter={light ? () => light(part.ids) : undefined}
                onMouseLeave={light ? () => light(back ?? null) : undefined}
              />
            </TooltipHint>
          ) : null;
        return [...segments, stub];
      })}
    </>
  );
}

/** What a system's row says about itself beyond its number: one marker, its tone and its sentence. */
export interface SystemStatus {
  tone: "alarm" | "caution";
  says: string;
}

/**
 * The all-systems row's status, worst first: a dash is never bare. `null` is a priced system with a
 * rating, in range, that rests on no unruled join: it says nothing.
 */
export function systemStatus(s: {
  total: number | null;
  rating: number | null;
  fanless: boolean;
  blocked: boolean;
  provisional: Provisional;
}): SystemStatus | null {
  if (s.fanless)
    return {
      tone: "alarm",
      says: "needs a fix: no unit in this system moves air, so nothing is priced",
    };
  if (s.blocked)
    return {
      tone: "alarm",
      says: "needs a fix: implausible loss",
    };
  if (s.total == null)
    return { tone: "caution", says: "not priced: no run from a fan to a terminal was found" };
  const load = fanLoad(s.total, s.rating);
  if (load.state === "rated" && load.over)
    return {
      tone: "alarm",
      says: `over rating: needs ${s.total.toFixed(3)} in-wg, the unit is rated ${load.available.toFixed(2)}`,
    };
  if (load.state === "unrated")
    return {
      tone: "caution",
      says: "rating unknown: the unit states no rated external static, so the bar fills against its own total",
    };
  if (s.provisional)
    return {
      tone: "caution",
      says: `provisional: rests on ${s.provisional.count} unruled inferred join(s), worst ${s.provisional.worst}`,
    };
  return null;
}

/** The row's trailing fact: the ESP Pe computes, over the unit's rating when it states one, and the marker. */
export function SystemFact({
  value,
  rating,
  status,
}: {
  value: number | null;
  rating: number | null;
  status: SystemStatus | null;
}) {
  const load = fanLoad(value, rating);
  return (
    <span className="inline-flex items-center gap-1.5" data-e-fact="">
      <span
        className="face-mono"
        data-tone={status?.tone === "alarm" && value != null ? "alarm" : undefined}
      >
        {fmt(value)}
        {load.state === "rated" ? ` / ${fmt(load.available, 2)}` : ""}
      </span>
      {status ? (
        <span
          className="inline-block size-1.5 shrink-0 rounded-full bg-current"
          data-tone={status.tone}
          data-e-marker={status.tone}
          role="img"
          aria-label={status.says}
          title={status.says}
        />
      ) : null}
    </span>
  );
}

/**
 * The all-systems row's minibar: a thin line the full width of the row, on the system's own scale,
 * the same groups and inks as the strip, minified. With the unit's rated external static (`rating`,
 * in-wg) it is required over available, a fill against the fan's own limit, ringed in the alarm
 * tone when over; the breakdown inks stay inside the fill. Without a rating it fills its track to
 * read the make-up alone. Unpriced draws no track: an empty bar would read as zero. It draws no
 * tooltips: the row's title carries the hint (hundreds of rows would draw hundreds).
 */
export function SystemLine({
  value,
  split,
  rating,
}: {
  value: number | null;
  split: Split | null;
  rating: number | null;
}) {
  const load = fanLoad(value, rating);
  const over = load.state === "rated" && load.over;
  const scale = load.state === "rated" ? load.available : value;
  if (value == null || !scale || !split) return null;
  return (
    <span
      className="pointer-events-none absolute inset-x-0 bottom-0 block h-[3px]"
      aria-hidden
      data-e-minibar=""
      data-e-load={load.state === "rated" ? load.ratio.toFixed(3) : ""}
      style={over ? { boxShadow: `0 0 0 1px ${tokenRef("alarm")}` } : undefined}
    >
      <span className="absolute inset-0" style={{ backgroundColor: tokenRef("line") }} />
      <SplitFill split={split} scale={scale} hint={false} />
    </span>
  );
}

/**
 * The critical run's split, wide, under the path header: where the fan's static goes, unit end to
 * grille, one entry per element group with its in-wg and share. Hovering one lights its elements everywhere.
 */
export function SplitStrip({
  split,
  scale,
  light,
}: {
  split: Split | null;
  scale: number | null;
  light: Light;
}) {
  const observation = useNativeObservation();
  const declaration = (ids: readonly number[]) => {
    const target = observedElements(observation, ids);
    return revitTarget(target.ids, target.refs);
  };
  if (!split || !scale) return null;
  return (
    <div
      className="border-line flex flex-col gap-1 border-b px-2 py-1.5 t-small"
      data-e-split-strip=""
    >
      <span className="relative block h-2.5" style={{ backgroundColor: tokenRef("line") }}>
        <SplitFill split={split} scale={scale} light={light} />
      </span>
      <span className="flex flex-wrap gap-x-3 text-ink-2">
        {split.groups
          .filter((g) => g.dp > 0 || g.unpriced > 0)
          .map((group) => {
            const part = PARTS.find((p) => p.key === group.part)!;
            return (
              <TooltipHint key={group.key} content={`${part.word}: ${part.says}`}>
                <span
                  className="inline-flex items-center gap-1"
                  data-e-group-key={group.label}
                  {...declaration(group.ids)}
                  onMouseEnter={() => light(group.ids)}
                  onMouseLeave={() => light(null)}
                >
                  <span
                    className="inline-block size-2"
                    style={{ backgroundColor: tokenRef(part.ink) }}
                    aria-hidden
                  />
                  {group.label}{" "}
                  {group.dp > 0 ? (
                    <>
                      <span className="face-mono text-ink">{fmt(group.dp, 3)}</span>
                      <span className="face-mono">{Math.round((group.dp / scale) * 100)}%</span>
                    </>
                  ) : null}
                  {group.unpriced > 0 ? (
                    <span data-tone="caution">
                      {group.dp > 0 ? `+ ${group.unpriced} unpriced` : "no drop: unknown"}
                    </span>
                  ) : null}
                </span>
              </TooltipHint>
            );
          })}
      </span>
    </div>
  );
}

/** The loss columns' precision: a short duct really loses ~0.0001 in-wg, and 3 places would read it as 0. */
const LOSS_PLACES = 4;

/**
 * The loss columns' widths, one recipe for the header and every row so they align. A narrow tree
 * (the kit Tree is the container) drops the small in-wg columns, then the bar, so the names keep
 * room; the in-wg rides the feet cell's hint.
 */
const COL = {
  bar: "w-10 @max-[300px]:hidden",
  ft: "w-12",
  wg: "w-12 @max-[460px]:hidden",
  mark: "w-1.5",
} as const;

/**
 * The header over `MetaBar`'s columns: the Tree's `columns.meta`. Feet are the primary unit (ACCA
 * Manual D reads a fitting as equivalent feet of duct); the small in-wg beside each is the pressure.
 */
export function MetaHeader() {
  return (
    <span className="inline-flex items-center gap-1.5" data-e-columns="">
      <span className={COL.bar} aria-hidden />
      <TooltipHint content="effective length from the fan to this row's far end, in equivalent feet at each duct's own friction rate; the small number beside it is the loss in in-wg">
        <span className={`${COL.ft} text-right`}>to here, eq ft</span>
      </TooltipHint>
      <span className={COL.wg} aria-hidden />
      <TooltipHint content="this row's own effective length, in equivalent feet; the small number beside it is its own loss in in-wg">
        <span className={`${COL.ft} border-line border-l pl-1.5 text-right`}>own, eq ft</span>
      </TooltipHint>
      <span className={COL.wg} aria-hidden />
      <span className={COL.mark} aria-hidden />
    </span>
  );
}

/**
 * The bar for a row's trailing slot: a fixed track (rows align), then the effective length to here
 * in feet with its in-wg beside it in smaller ink, then the row's own the same way. The bar's share
 * is the in-wg total against the critical run (the ESP is the budget); the numbers are feet.
 */
export function MetaBar({
  value,
  scale,
  ft,
  provisional = null,
  self,
  selfFt,
  unpriced = null,
  split = null,
  light,
  rowIds,
}: {
  /** The loss to here, in-wg. */
  value: number | null;
  scale: number | null;
  /** The effective length to here, ft. */
  ft: number | null;
  provisional?: Provisional;
  /** This row's own loss, in-wg, drawn after the total when given; "" holds the column empty. */
  self?: number | null | "";
  /** This row's own effective length, ft. */
  selfFt?: number | null;
  /** A priced path that could not price this row: its word stands where the number would, never 0. */
  unpriced?: { word: string; why: string } | null;
  /** A whole run's three parts (run and system rows): the fill splits, and a part's hover lights it. */
  split?: Split | null;
  light?: Light;
  /** The row's own set, lit again when the pointer leaves a part. */
  rowIds?: readonly number[];
}) {
  const share = value != null && scale ? Math.min(1, value / scale) : null;
  const own = unpriced
    ? unpriced.word
    : self === ""
      ? ""
      : selfFt == null
        ? "—"
        : `+${fmtFt(selfFt)}`;
  return (
    <span className="inline-flex items-center gap-1.5" data-e-bar={share ?? ""}>
      <span className={`relative inline-block h-1.5 ${COL.bar}`} aria-hidden>
        {share != null ? (
          <>
            <span className="absolute inset-0" style={{ backgroundColor: tokenRef("line") }} />
            {split && scale ? (
              <SplitFill split={split} scale={scale} light={light} back={rowIds} />
            ) : (
              <span
                className="absolute inset-y-0 left-0"
                style={{ width: `${share * 100}%`, backgroundColor: tokenRef("ink-2") }}
              />
            )}
          </>
        ) : null}
      </span>
      <TooltipHint content={`${fmt(value, LOSS_PLACES)} in-wg to here`}>
        <span className={`${COL.ft} text-right`} data-e-ft={ft ?? ""}>
          {fmtFt(ft)}
        </span>
      </TooltipHint>
      <TooltipHint content="loss to here, in-wg">
        <span className={`${COL.wg} text-ink-2 t-small`}>{fmt(value, LOSS_PLACES)}</span>
      </TooltipHint>
      {self !== undefined ? (
        <>
          <TooltipHint
            content={
              unpriced?.why ??
              (typeof self === "number" ? `+${fmt(self, LOSS_PLACES)} in-wg own` : undefined)
            }
          >
            <span
              className={`border-line border-l pl-1.5 ${COL.ft} text-right`}
              data-e-own={unpriced ? "unpriced" : ""}
            >
              {own}
            </span>
          </TooltipHint>
          <TooltipHint content="own loss, in-wg">
            <span className={`${COL.wg} text-ink-2 t-small`}>
              {unpriced || self === "" || self == null ? "" : `+${fmt(self, LOSS_PLACES)}`}
            </span>
          </TooltipHint>
        </>
      ) : null}
      <span className={COL.mark} data-tone={provisional ? "caution" : undefined}>
        {provisional ? "~" : ""}
      </span>
    </span>
  );
}
