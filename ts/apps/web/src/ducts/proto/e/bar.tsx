import { TooltipHint } from "@pe/kit/lang/tooltip";
/**
 * THROWAWAY (protoui round 3, E2): the loss bar the tree draws, and its one-line legend.
 * Full width is the group's critical run (Pe's largest fan-to-grille total), so the critical row
 * fills its track and every other row reads as a share of it. Unpriced draws no track: an empty bar
 * would read as zero loss.
 */
import { Fragment, useEffect, useRef, useState, type ComponentProps, type ReactNode } from "react";
import { fanLoad } from "@pe/ducts-domain/fan-headroom";
import type { Provisional } from "@pe/ducts-domain/losses";
import { Popover, PopoverContent, PopoverTrigger } from "@pe/kit/lang/popover";
import { revitTarget } from "@pe/kit/lang/row";
import type { ListRowParts } from "@pe/kit/lang/list-view";
import { tokenRef } from "@pe/kit/lib/token";
import { observedElements, useNativeObservation } from "#/revit/observation";

import type { Split, SplitPart, systemList } from "../b/model";

export const fmt = (n: number | null | undefined, d = 3) => (n == null ? "—" : n.toFixed(d));

/** Equivalent feet as an engineer reads them: whole feet, one place under ten. */
export const fmtFt = (ft: number | null | undefined) =>
  ft == null ? "—" : Math.abs(ft) < 10 ? ft.toFixed(1) : Math.round(ft).toLocaleString("en-US");

/** The three parts of a run, in bar order (air order: the unit, the ducts, the grille). The bar is one ink: colour here would claim a meaning the parts do not have. */
const PARTS = [
  {
    key: "unit",
    word: "unit end",
    says: "passive devices in series with the fan (coil, dehu)",
  },
  {
    key: "duct",
    word: "ducts & fittings",
    says: "straight duct and every fitting between the unit and the grille",
  },
  { key: "terminal", word: "grille", says: "the terminal's own drop" },
] as const;

/** The bar's one ink; groups are told apart by hairline dividers and, in the popover, leader lines. */
const INK = "ink-2";

type Light = (ids: readonly number[] | null) => void;

/**
 * A run's loss as abutting segments against `scale`: one per element group (a duct type, a fitting
 * family type, ...), each set off by a hairline of the ground, all in one ink. A segment's
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
      {PARTS.map(({ key, word }) => {
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
                      backgroundColor: tokenRef(INK),
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
                style={{ left: `min(${at * 100}%, calc(100% - 6px))`, borderColor: tokenRef(INK) }}
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

/** One thing wrong or unsure about a system: its tone and its sentence. */
export interface SystemIssue {
  tone: "alarm" | "caution";
  says: string;
}

/**
 * Everything a system's row has to say beyond its number, worst first, so a dash is never bare.
 * Empty is a priced system in range, with a stated rating, resting on no unruled join.
 */
export function systemIssues(s: {
  total: number | null;
  rating: number | null;
  fanless: boolean;
  blocked: boolean;
  provisional: Provisional;
}): SystemIssue[] {
  const load = fanLoad(s.total, s.rating);
  return [
    s.fanless && { tone: "alarm", says: "needs a fix: no fan" },
    s.blocked && { tone: "alarm", says: "needs a fix: implausible loss" },
    s.total == null &&
      !s.fanless &&
      !s.blocked && {
        tone: "caution",
        says: "not priced: no run from a fan to a terminal was found",
      },
    load.state === "rated" &&
      load.over && {
        tone: "alarm",
        says: `${load.required.toFixed(3)} required against ${load.available.toFixed(2)} rated`,
      },
    load.state === "unrated" &&
      s.total != null && {
        tone: "caution",
        says: "rating unknown: the unit states no rated external static",
      },
    s.provisional && {
      tone: "caution",
      says: `provisional: rests on ${s.provisional.count} unruled inferred join(s), worst ${s.provisional.worst}`,
    },
  ].filter((issue): issue is SystemIssue => !!issue);
}

/**
 * The row's corner marker: a badge in the worst issue's tone, with a count when there are several.
 * Its popover lists the issues and mounts only while open (closed children do not render), so
 * hundreds of rows hold no popover content. Each line opens the system, where its inbox rows are.
 */
function SystemMarker({ issues, open }: { issues: SystemIssue[]; open: () => void }) {
  const tone = issues.some((i) => i.tone === "alarm") ? "alarm" : "caution";
  return (
    <Popover>
      <PopoverTrigger
        openOnHover
        delay={150}
        aria-label={issues.map((i) => i.says).join("; ")}
        data-tone={tone}
        data-e-marker={tone}
        className="absolute top-0.5 right-1 z-[1] flex size-4 items-center justify-center rounded-full p-0! min-h-0!"
        style={{ backgroundColor: tokenRef(tone), color: tokenRef(tone) }}
      >
        <span className="t-small leading-none" style={{ color: tokenRef("page") }}>
          {issues.length > 1 ? issues.length : "!"}
        </span>
      </PopoverTrigger>
      <PopoverContent side="bottom" align="end" className="w-72">
        <ul className="flex flex-col gap-1" data-e-issues="">
          {issues.map((issue) => (
            <li key={issue.says}>
              <button
                type="button"
                className="flex w-full items-baseline gap-1.5 text-left"
                data-tone={issue.tone}
                onClick={open}
              >
                <span className="mt-1 inline-block size-1.5 shrink-0 rounded-full bg-current" />
                <span className="text-ink">{issue.says}</span>
              </button>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

/**
 * The all-systems row: the system name, then a minibar filling the rest of the first line, then the
 * ESP Pe computes (over the unit's rating when it states one). The bar is on the system's own scale
 * with the same groups and inks as the strip; with a rating it is required over available, ringed
 * in the alarm tone when over. Unpriced draws no track: an empty bar would read as zero. The
 * corner marker carries the issues. The bar draws no tooltips of its own; hovering or clicking it opens the shared
 * breakdown popover (`BarPopover`), whose content mounts only while open.
 */
export function systemRowParts(
  s: ReturnType<typeof systemList>[number],
  open: () => void,
): ListRowParts {
  const issues = systemIssues(s);
  const load = fanLoad(s.total, s.rating);
  const over = load.state === "rated" && load.over;
  const scale = load.state === "rated" ? load.available : s.total;
  const hint = [
    `${s.name} · ${s.sub}`,
    s.total == null
      ? null
      : `fan static Pe computes ${s.total.toFixed(3)} in-wg${s.rating != null ? ` of the unit's rated ${s.rating.toFixed(2)}` : ""}`,
  ]
    .filter(Boolean)
    .join("\n");
  return {
    metaFill: true,
    lines: 2,
    label: s.name,
    sub: s.sub,
    title: hint,
    meta: (
      <>
        <span
          className={`flex w-full items-center gap-2 ${issues.length ? "pr-5" : ""}`}
          data-e-fact=""
        >
          {s.total != null && scale && s.split ? (
            <BarPopover split={s.split} scale={scale} className="h-3 min-w-8 flex-1">
              <span
                className="relative block h-1.5 w-full"
                data-e-minibar=""
                data-e-load={load.state === "rated" ? load.ratio.toFixed(3) : ""}
                style={over ? { boxShadow: `0 0 0 1px ${tokenRef("alarm")}` } : undefined}
              >
                <span className="absolute inset-0" style={{ backgroundColor: tokenRef("line") }} />
                <SplitFill split={s.split} scale={scale} hint={false} />
              </span>
            </BarPopover>
          ) : (
            <span className="relative block h-1.5 min-w-8 flex-1" aria-hidden data-e-minibar="" />
          )}
          <span className="face-mono shrink-0" data-tone={over ? "alarm" : undefined}>
            {fmt(s.total)}
            {load.state === "rated" ? ` / ${fmt(load.available, 2)}` : ""}
          </span>
        </span>
        {issues.length ? <SystemMarker issues={issues} open={open} /> : null}
      </>
    ),
  };
}

/** The loss columns' precision: a short duct really loses ~0.0001 in-wg, and 3 places would read it as 0. */
const LOSS_PLACES = 4;

/** Row and bar heights of the leader diagram, px: the leaders are drawn against them. */
const ROW_H = 20;
const BAR_H = 12;
/** Segments under this share of the scale roll up into one "other (N)" entry. */
const SMALL = 0.03;

type Entry = {
  key: string;
  label: string;
  dp: number;
  unpriced: number;
  ids: readonly number[];
  /** Bar-space centres (0..1) of the segment or segments this entry leads to; none = no segment. */
  at: number[];
  title?: string;
};

/** The groups in bar order, each with the centre of its segment, small ones rolled into one entry. */
function entriesOf(split: Split, scale: number): Entry[] {
  let pos = 0;
  const drawn: Entry[] = PARTS.flatMap((p) =>
    split.groups
      .filter((g) => g.part === p.key && g.dp > 0)
      .map((g) => {
        const w = Math.min(1 - pos, g.dp / scale);
        const at = pos + w / 2;
        pos += g.dp / scale;
        return { key: g.key, label: g.label, dp: g.dp, unpriced: g.unpriced, ids: g.ids, at: [at] };
      }),
  );
  const small = drawn.filter((e) => e.dp / scale < SMALL);
  const big = small.length > 1 ? drawn.filter((e) => !small.includes(e)) : drawn;
  const other: Entry[] =
    small.length > 1
      ? [
          {
            key: "other",
            label: `other (${small.length})`,
            dp: small.reduce((a, e) => a + e.dp, 0),
            unpriced: small.reduce((a, e) => a + e.unpriced, 0),
            ids: small.flatMap((e) => e.ids),
            at: small.flatMap((e) => e.at),
            title: small
              .map((e) => `${e.label}  ${fmt(e.dp, LOSS_PLACES)}`)
              .join(String.fromCharCode(10)),
          },
        ]
      : [];
  const unknown: Entry[] = split.groups
    .filter((g) => g.dp <= 0 && g.unpriced > 0)
    .map((g) => ({ key: g.key, label: g.label, dp: 0, unpriced: g.unpriced, ids: g.ids, at: [] }));
  return [...big, ...other, ...unknown];
}

/**
 * The breakdown of one bar: the bar drawn large, every segment on a thin leader to its label
 * (group name, in-wg, share). Labels sit in a column left of the bar in bar order, and each leader
 * drops from its segment then runs left at its label's height, so no two leaders cross. Segments
 * under 3% roll up into one "other (N)" entry whose leaders gather on its row. Tabular numerals
 * align the numbers. Hovering an entry lights its elements.
 */
function BreakdownList({
  split,
  scale,
  light,
  back,
  barW,
}: {
  split: Split;
  scale: number;
  light?: Light;
  back?: readonly number[];
  /** The hovered bar's width, px: the large bar takes it (within limits) and sits under its right edge. */
  barW: number;
}) {
  const entries = entriesOf(split, scale);
  const rows = entries.length;
  const leader = tokenRef("ink-2");
  // The popover's resolved side decides where the bar sits: nearest the hovered bar, so below it the
  // bar is on top and, flipped above it, at the bottom (the labels fan away from it either way).
  const root = useRef<HTMLDivElement>(null);
  const [flip, setFlip] = useState(false);
  useEffect(() => {
    const popup = root.current?.closest("[data-side]");
    if (!popup) return;
    const read = () => setFlip(popup.getAttribute("data-side") === "top");
    read();
    const watch = new MutationObserver(read);
    watch.observe(popup, { attributes: true, attributeFilter: ["data-side"] });
    return () => watch.disconnect();
  }, []);
  const rowOf = (i: number) => (flip ? rows - 1 - i : i);
  const edge = flip ? rows * ROW_H + 4 : -4;
  const ordered = flip ? [...entries].reverse() : entries;
  const caption = (
    <p className="t-small text-ink-2">
      full width = <span className="face-mono text-ink">{fmt(scale)}</span> in-wg
    </p>
  );
  const barCol = Math.min(224, Math.max(128, barW));
  return (
    <div
      className="flex flex-col gap-1"
      data-e-breakdown=""
      data-e-flip={flip || undefined}
      ref={root}
    >
      {flip ? null : caption}
      <div
        className="grid items-center gap-x-2"
        style={{
          gridTemplateColumns: `minmax(0,1fr) auto auto ${barCol}px`,
          gridTemplateRows: flip
            ? `repeat(${rows}, ${ROW_H}px) ${BAR_H + 4}px`
            : `${BAR_H + 4}px repeat(${rows}, ${ROW_H}px)`,
        }}
        data-e-groups=""
      >
        <span
          className="relative block"
          style={{
            gridColumn: 4,
            gridRow: flip ? rows + 1 : 1,
            height: BAR_H,
            backgroundColor: tokenRef("line"),
            alignSelf: flip ? "end" : "start",
          }}
        >
          <SplitFill split={split} scale={scale} light={light} back={back} hint={false} />
        </span>
        {ordered.map((e) => (
          <div
            key={e.key}
            className="contents"
            data-e-group-key={e.label}
            title={e.title}
            onMouseEnter={light ? () => light(e.ids) : undefined}
            onMouseLeave={light ? () => light(back ?? null) : undefined}
          >
            <span className="flex min-w-0 items-baseline gap-1.5" title={e.title ?? e.label}>
              <span className="truncate">{e.label}</span>
              {e.unpriced > 0 ? (
                <span className="shrink-0" data-tone="caution">
                  {e.dp > 0 ? `+ ${e.unpriced} unpriced` : "no drop: unknown"}
                </span>
              ) : null}
            </span>
            <span className="face-mono text-ink text-right tabular-nums">
              {e.dp > 0 ? fmt(e.dp, LOSS_PLACES) : ""}
            </span>
            <span className="face-mono text-ink-2 w-[4ch] text-right tabular-nums">
              {e.dp > 0 ? `${Math.round((e.dp / scale) * 100)}%` : ""}
            </span>
          </div>
        ))}
        <svg
          className="h-full w-full overflow-visible"
          style={{ gridColumn: 4, gridRow: `${flip ? 1 : 2} / span ${Math.max(1, rows)}` }}
          viewBox={`0 0 100 ${Math.max(1, rows) * ROW_H}`}
          preserveAspectRatio="none"
          aria-hidden
          data-e-leaders=""
        >
          {entries.map((e, i) => {
            const y = rowOf(i) * ROW_H + ROW_H / 2;
            return e.at.length ? (
              <path
                key={e.key}
                d={[
                  ...e.at.map((x) => `M${x * 100} ${edge} V${y}`),
                  `M${Math.max(...e.at) * 100} ${y} H0`,
                ].join(" ")}
                fill="none"
                stroke={leader}
                strokeWidth={1}
                vectorEffect="non-scaling-stroke"
                strokeDasharray={e.at.length > 1 ? "2 2" : undefined}
              />
            ) : null;
          })}
        </svg>
      </div>
      {flip ? caption : null}
    </div>
  );
}

/**
 * The one breakdown popover: the bar is its trigger (hover or click), the per-group list its
 * content, aligned to the trigger's right edge so the large bar sits under (or over) the hovered
 * one wherever the viewport allows. Single-system strip and every all-systems row use this; the
 * content mounts only while open (Portal owns lazy mounting), so 355 rows hold 355 closed roots.
 */
export function BarPopover({
  split,
  scale,
  light,
  back,
  className,
  children,
}: {
  split: Split;
  scale: number;
  light?: Light;
  back?: readonly number[];
  className?: string;
  children: ReactNode;
}) {
  const trigger = useRef<HTMLButtonElement>(null);
  const [barW, setBarW] = useState(0);
  return (
    <Popover
      onOpenChange={(open) => {
        if (open) setBarW(trigger.current?.getBoundingClientRect().width ?? 0);
      }}
    >
      <PopoverTrigger
        ref={trigger}
        openOnHover
        delay={150}
        aria-label="loss breakdown by element group"
        data-e-bar-trigger=""
        className={`flex items-center p-0! min-h-0! border-0 ${className ?? ""}`}
        onClick={(event) => event.stopPropagation()}
      >
        {children}
      </PopoverTrigger>
      <PopoverContent
        side="bottom"
        align="end"
        className="w-[min(36rem,var(--available-width))] p-2"
      >
        <BreakdownList split={split} scale={scale} light={light} back={back} barW={barW} />
      </PopoverContent>
    </Popover>
  );
}

/** The critical run's split, wide, under the path header: just the bar; its breakdown is the popover. */
export function SplitStrip({
  split,
  scale,
  light,
}: {
  split: Split | null;
  scale: number | null;
  light: Light;
}) {
  if (!split || !scale) return null;
  return (
    <div className="border-line border-b px-2 py-1.5 t-small" data-e-split-strip="">
      <BarPopover split={split} scale={scale} light={light} className="h-4 w-full">
        <span className="relative block h-2.5 w-full" style={{ backgroundColor: tokenRef("line") }}>
          <SplitFill split={split} scale={scale} light={light} hint={false} />
        </span>
      </BarPopover>
    </div>
  );
}

/**
 * The loss columns' widths, one recipe for the header and every row so they align. A narrow tree
 * (the kit ListView is the container) drops the small in-wg columns, then the bar, so the names keep
 * room; the in-wg rides the feet cell's hint.
 */
const COL = {
  bar: "w-10 @max-[300px]:hidden",
  ft: "w-12",
  wg: "w-12 @max-[460px]:hidden",
  mark: "w-1.5",
} as const;

/**
 * The header over `MetaBar`'s columns: ListView's `columns.meta`. Feet are the primary unit (ACCA
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
