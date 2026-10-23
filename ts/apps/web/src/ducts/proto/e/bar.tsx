import { TooltipHint } from "@pe/kit/lang/tooltip";
/**
 * THROWAWAY (protoui round 3, E2): the loss bar the tree draws, and its one-line legend.
 * Full width is the group's critical run (Pe's largest fan-to-grille total), so the critical row
 * fills its track and every other row reads as a share of it. Unpriced draws no track: an empty bar
 * would read as zero loss.
 */
import {
  createContext,
  Fragment,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react";
import type { DuctSnapshot } from "@pe/ducts-domain/types";
import type { Priced } from "@pe/ducts-domain/pricing";
import { tableOf } from "@pe/ducts-domain/pricing";
import { Button } from "@pe/kit/lang/button";
import { Input } from "@pe/kit/lang/input";
import { SearchControl } from "@pe/kit/lang/search-control";
import type { LossesWork } from "../../work";
import { assignFamilyRule } from "./rule-assignment";
import { barRows, ruleConditions, selectedBarRow, type BarRow } from "./bar-model";
import { fanLoad } from "@pe/ducts-domain/fan-headroom";
import type { Provisional } from "@pe/ducts-domain/losses";
import { Popover, PopoverContent, PopoverTrigger } from "@pe/kit/lang/popover";
import { revitTarget } from "@pe/kit/lang/row";
import type { ListRowParts } from "@pe/kit/lang/list-view";
import { tokenRef } from "@pe/kit/lib/token";
import { observedElements, useNativeObservation } from "#/revit/observation";

import type { Split, SplitPart, systemList } from "../b/model";

const RuleContext = createContext<{
  nodes: ReadonlyMap<number, DuctSnapshot["nodes"][number]>;
  work: LossesWork;
  priced: Priced | null;
} | null>(null);
export function BarRules({
  snapshot,
  work,
  priced,
  children,
}: {
  snapshot: DuctSnapshot;
  work: LossesWork;
  priced: Priced | null;
  children: ReactNode;
}) {
  const nodes = useMemo(() => new Map(snapshot.nodes.map((node) => [node.id, node])), [snapshot]);
  const value = useMemo(() => ({ nodes, work, priced }), [nodes, work, priced]);
  return <RuleContext value={value}>{children}</RuleContext>;
}

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

/** One thing wrong or unsure about a system: its tone, its one-word mark and its sentence. */
export interface SystemIssue {
  tone: "alarm" | "caution";
  /** The mark's word: what a glance must read without hovering. */
  word: string;
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
  /** A Fix row holds the system's ESP (`systemsNeedingFix`, the inbox's own rule). */
  needsFix?: boolean;
}): SystemIssue[] {
  const load = fanLoad(s.total, s.rating);
  return [
    s.fanless && { tone: "alarm", word: "no fan", says: "needs a fix: no fan" },
    s.blocked && { tone: "alarm", word: "blocked", says: "needs a fix: implausible loss" },
    s.needsFix &&
      !s.fanless &&
      !s.blocked && {
        tone: "alarm",
        word: "fix",
        says: "needs a fix: a Fix row holds its ESP back",
      },
    s.total == null &&
      !s.fanless &&
      !s.blocked && {
        tone: "caution",
        word: "no run",
        says: "not priced: no run from a fan to a terminal was found",
      },
    load.state === "rated" &&
      load.over && {
        tone: "alarm",
        word: "over",
        says: `${load.required.toFixed(3)} required against ${load.available.toFixed(2)} rated`,
      },
    load.state === "unrated" &&
      s.total != null && {
        tone: "caution",
        word: "unrated",
        says: "rating unknown: the unit states no rated external static",
      },
    s.provisional && {
      tone: "caution",
      word: `~${s.provisional.count} join${s.provisional.count === 1 ? "" : "s"}`,
      says: `provisional: rests on ${s.provisional.count} unruled inferred join(s), worst ${s.provisional.worst}`,
    },
  ].filter((issue): issue is SystemIssue => !!issue);
}

/**
 * A system's state mark: the worst issue's word (and "+n" for the rest), read without hovering.
 * Shape carries severity as well as tone: an alarm is a filled block, a caution an outlined one.
 * Its popover lists the issues and mounts only while open, so hundreds of rows hold no popover
 * content. Each line opens the system, where its inbox rows are. The picture's plate wears the same mark.
 */
export function SystemMark({
  issues,
  open,
}: {
  issues: readonly SystemIssue[];
  open: () => void;
}) {
  const worst = issues.find((i) => i.tone === "alarm") ?? issues[0];
  if (!worst) return null;
  return (
    <Popover>
      <PopoverTrigger
        openOnHover
        delay={150}
        aria-label={issues.map((i) => i.says).join("; ")}
        data-tone={worst.tone}
        data-e-marker={worst.tone}
        // A 16 px mark with a 24 px reach (the ::before), ringed in ink while hovered or open.
        className="face-mono t-small relative inline-flex h-4 shrink-0 items-center rounded-sm border leading-none whitespace-nowrap p-0! min-h-0! before:absolute before:-inset-1 before:content-[''] hover:outline hover:outline-offset-1 hover:outline-ink data-popup-open:outline data-popup-open:outline-offset-1 data-popup-open:outline-ink"
        // The trigger's own button ground would win over a tone attribute: the fill is stated here.
        style={{
          borderColor: tokenRef(worst.tone),
          backgroundColor: worst.tone === "alarm" ? tokenRef(worst.tone) : "transparent",
        }}
      >
        <span
          className="px-1"
          style={{ color: worst.tone === "alarm" ? tokenRef("page") : tokenRef(worst.tone) }}
        >
          {worst.word}
          {issues.length > 1 ? ` +${issues.length - 1}` : ""}
        </span>
      </PopoverTrigger>
      <PopoverContent side="bottom" align="end" className="w-72">
        <ul className="flex flex-col gap-1" data-e-issues="">
          {issues.map((issue) => (
            <li key={issue.says}>
              <button
                type="button"
                className="veil flex w-full items-baseline gap-1.5 rounded-control px-1 py-0.5 text-left"
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
 * state mark after the number carries the issues. The bar draws no tooltips of its own; hovering or clicking it opens the shared
 * breakdown popover (`BarPopover`), whose content mounts only while open.
 */
export function systemRowParts(
  s: ReturnType<typeof systemList>[number],
  open: () => void,
  needsFix = false,
  /** The popover's head (the system's fans), built only while it is open. */
  head?: () => ReactNode,
): ListRowParts {
  const issues = systemIssues({ ...s, needsFix });
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
    wrap: true,
    label: s.name,
    sub: s.sub,
    title: hint,
    meta: (
      <>
        <span className="flex w-full items-center gap-2" data-e-fact="">
          {s.total != null && scale && s.split ? (
            <BarPopover split={s.split} scale={scale} head={head} className="h-3 min-w-8 flex-1">
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
          <SystemMark issues={issues} open={open} />
        </span>
      </>
    ),
  };
}

/** The loss columns' precision: a short duct really loses ~0.0001 in-wg, and 3 places would read it as 0. */
const LOSS_PLACES = 4;

/** The table keeps tiny groups behind one expandable row, with each segment still led to it. */
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
  barW: number;
}) {
  const context = useContext(RuleContext);
  const root = useRef<HTMLDivElement>(null);
  const bar = useRef<HTMLSpanElement>(null);
  const [side, setSide] = useState("bottom");
  const [expanded, setExpanded] = useState(false);
  const [selected, setSelected] = useState<{ key: string; ids: readonly number[] } | null>(null);
  const [leaders, setLeaders] = useState<{ key: string; d: string }[]>([]);
  const entries = useMemo(
    () => barRows(split, scale, context?.nodes ?? new Map()),
    [split, scale, context?.nodes],
  );
  const current = selectedBarRow(entries, selected);
  const small = entries.filter(
    (entry) => entry.dp > 0 && entry.share < 3 && entry.key !== current?.key,
  );
  const rolled = !expanded && small.length > 1;
  const other = rolled
    ? {
        ...small[0]!,
        key: "other",
        label: `other (${small.length})`,
        dp: small.reduce((sum, row) => sum + row.dp, 0),
        share: small.reduce((sum, row) => sum + row.share, 0),
        count: new Set(small.flatMap((row) => row.ids)).size,
        unpriced: small.reduce((sum, row) => sum + row.unpriced, 0),
        ids: small.flatMap((row) => row.ids),
        at: small.flatMap((row) => row.at),
        words: "Expand loss groups",
        tables: [],
        conditions: [],
        rules: [],
      }
    : null;
  const visible = rolled ? [...entries.filter((entry) => !small.includes(entry)), other!] : entries;
  const flip = side === "top";
  const barLeft = side !== "left";
  const led = visible.filter((row) => row.at.length);
  const bare = visible.filter((row) => !row.at.length);
  const ordered = barLeft !== flip ? [...led].reverse() : led;
  const rows = flip ? [...bare, ...ordered] : [...ordered, ...bare];
  const barCol = Math.min(144, Math.max(96, barW));

  useLayoutEffect(() => {
    const popup = root.current?.closest("[data-side]");
    if (!popup) return;
    const read = () => setSide(popup.getAttribute("data-side") ?? "bottom");
    read();
    const watch = new MutationObserver(read);
    watch.observe(popup, { attributes: true, attributeFilter: ["data-side"] });
    return () => watch.disconnect();
  }, []);
  useLayoutEffect(() => {
    const box = root.current;
    if (!box) return;
    const measure = () => {
      const origin = box.getBoundingClientRect();
      const track = bar.current?.getBoundingClientRect();
      if (!track) return;
      const y0 = (flip ? track.top : track.bottom) - origin.top;
      const x0 = track.left - origin.left;
      setLeaders(
        rows.flatMap((row) => {
          const tr = box.querySelector(`[data-loss-row="${CSS.escape(row.key)}"]`);
          if (!tr || !row.at.length) return [];
          const rect = tr.getBoundingClientRect();
          const y = rect.top + rect.height / 2 - origin.top;
          return [
            {
              key: row.key,
              d: row.at
                .map(
                  (at) =>
                    `M${x0 + at * track.width} ${y0} V${y} H${barLeft ? x0 + track.width : x0}`,
                )
                .join(" "),
            },
          ];
        }),
      );
    };
    measure();
    const watch = new ResizeObserver(measure);
    watch.observe(box);
    return () => watch.disconnect();
  }, [split, scale, side, expanded, barCol, selected]);

  const track = (
    <span
      ref={bar}
      className="relative block h-3 w-full"
      style={{ backgroundColor: tokenRef("line") }}
    >
      <SplitFill split={split} scale={scale} hint={false} />
    </span>
  );
  const number = "face-mono tabular-nums text-right px-1 align-middle";
  const zone = <td aria-hidden className="p-1" />;
  return (
    <div
      className="flex flex-wrap items-start gap-3"
      data-e-breakdown=""
      data-e-side={side}
      data-e-flip={flip || undefined}
    >
      <div className="min-w-0 flex-1 basis-[760px]">
        <p className="text-ink-2 mb-1">
          full width = <span className="face-mono text-ink">{fmt(scale)}</span> in-wg · select a
          group to edit its rule
        </p>
        <div ref={root} className="relative" data-e-groups="">
          <table
            aria-label="Loss groups and pricing rules"
            className="w-full table-fixed text-left"
          >
            <colgroup>
              {barLeft ? <col style={{ width: barCol }} /> : null}
              <col className="w-[64px]" />
              <col className="w-[44px]" />
              <col className="w-[38px]" />
              <col />
              <col />
              <col />
              {!barLeft ? <col style={{ width: barCol }} /> : null}
            </colgroup>
            <thead className="hairline-b text-ink-2">
              <tr>
                {barLeft ? (
                  <th scope="col" className="p-1">
                    {!flip ? track : <span className="sr-only">Bar leaders</span>}
                  </th>
                ) : null}
                <th scope="col" className="px-1 text-right">
                  in-wg
                </th>
                <th scope="col" className="px-1 text-right">
                  %
                </th>
                <th scope="col" className="px-1 text-right">
                  count
                </th>
                <th scope="col" className="px-2">
                  loss group
                </th>
                <th scope="col" className="px-2">
                  ASHRAE / rule
                </th>
                <th scope="col" className="px-2">
                  conditions / inputs
                </th>
                {!barLeft ? (
                  <th scope="col" className="p-1">
                    {!flip ? track : <span className="sr-only">Bar leaders</span>}
                  </th>
                ) : null}
              </tr>
            </thead>
            <tbody className="hairline-rows">
              {rows.map((row) => (
                <tr
                  key={row.key}
                  data-loss-row={row.key}
                  data-e-group-key={row.label}
                  data-selected={current?.key === row.key || undefined}
                  onMouseEnter={light ? () => light(row.ids) : undefined}
                  onMouseLeave={light ? () => light(back ?? null) : undefined}
                  onClick={() =>
                    row.key === "other"
                      ? setExpanded(true)
                      : setSelected({ key: row.key, ids: row.ids })
                  }
                >
                  {barLeft ? zone : null}
                  <td className={number} data-loss-value="">
                    {row.dp > 0 || !row.unpriced ? fmt(row.dp, LOSS_PLACES) : "—"}
                    {row.dp > 0 && row.unpriced ? "+?" : ""}
                  </td>
                  <td className={number}>
                    {row.dp > 0 || !row.unpriced ? row.share.toFixed(1) : "—"}
                  </td>
                  <td className={number}>{row.count}</td>
                  <th scope="row" className="px-2 py-1 text-left font-normal break-words">
                    <Button
                      label={row.key === "other" ? row.label : `Edit rule for ${row.label}`}
                      onClick={() =>
                        row.key === "other"
                          ? setExpanded(true)
                          : setSelected({ key: row.key, ids: row.ids })
                      }
                    >
                      <span className="whitespace-normal text-left">{row.label}</span>
                    </Button>
                    {row.unpriced ? (
                      <span className="block" data-tone="caution">
                        {row.unpriced} unpriced
                      </span>
                    ) : null}
                  </th>
                  <td className="px-2 py-1 align-middle break-words">
                    <span className="face-mono">{row.tables.join(", ")}</span>
                    <span className="block">{row.words}</span>
                  </td>
                  <td className="px-2 py-1 align-middle break-words">
                    {row.conditions.length ? (
                      row.conditions.map((condition) => (
                        <span
                          key={condition}
                          className={`block ${
                            row.rules.some((rule) => {
                              const state = ruleConditions(rule, row);
                              return state.words === condition && state.inactive;
                            })
                              ? "text-ink-2"
                              : ""
                          }`}
                        >
                          {condition}
                        </span>
                      ))
                    ) : (
                      <span className="text-ink-2">not applicable</span>
                    )}
                    {row.rules.some((rule) => ruleConditions(rule, row).inactive) ? (
                      <span className="text-ink-2">geometry condition bypassed</span>
                    ) : null}
                  </td>
                  {!barLeft ? zone : null}
                </tr>
              ))}
            </tbody>
            {flip ? (
              <tfoot>
                <tr>
                  {barLeft ? <td className="p-1">{track}</td> : null}
                  <td colSpan={6} />
                  {!barLeft ? <td className="p-1">{track}</td> : null}
                </tr>
              </tfoot>
            ) : null}
          </table>
          <svg
            className="pointer-events-none absolute inset-0 size-full overflow-visible"
            aria-hidden
            data-e-leaders=""
          >
            {leaders.map((line) => (
              <path
                key={line.key}
                d={line.d}
                fill="none"
                stroke={tokenRef("ink-2")}
                strokeWidth={1}
                strokeDasharray={line.key === "other" ? "2 2" : undefined}
              />
            ))}
          </svg>
        </div>
        {expanded && small.length > 1 ? (
          <Button
            label="Collapse small loss groups"
            onClick={() => {
              setExpanded(false);
              setSelected(null);
            }}
          >
            collapse groups under 3%
          </Button>
        ) : null}
      </div>
      {current && context ? (
        <RulePick key={current.key} row={current} work={context.work} priced={context.priced} />
      ) : null}
    </div>
  );
}

function RulePick({ row, work, priced }: { row: BarRow; work: LossesWork; priced: Priced | null }) {
  const [search, setSearch] = useState("");
  const [family, setFamily] = useState(row.families[0] ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const staged = work.doc?.ruleAssignments?.[family]?.staged?.value.rule;
  const pick = async (rule: string) => {
    setPending(true);
    setError(null);
    try {
      const refusal = await assignFamilyRule(work, family, rule);
      setError(refusal?.message ?? null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setPending(false);
    }
  };
  const choices = row.candidates.filter((rule) =>
    `${priced ? tableOf(priced, rule.key) : rule.table} ${rule.family} ${rule.type} ${rule.cond}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  return (
    <aside
      aria-label="ASHRAE rule picker"
      data-e-rule-picker=""
      className="min-w-0 flex-1 basis-[280px] hairline-t pt-2"
    >
      <p>{row.label}</p>
      <p className="face-mono my-1" data-e-rule-price="">
        {fmt(row.dp, LOSS_PLACES)} in-wg{row.unpriced ? ` + ${row.unpriced} unpriced` : ""}
      </p>
      {!row.candidates.length || !family ? (
        <p className="text-ink-2">{row.words}. No applicable family rule to assign.</p>
      ) : (
        <>
          {row.families.length > 1 ? (
            <select
              className="dl-control w-full"
              aria-label="Fitting family"
              value={family}
              onChange={(event) => setFamily(event.target.value)}
            >
              {row.families.map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          ) : null}
          <p className="text-ink-2 mb-2">
            Every fitting in the family {family} uses this rule, across all systems. An assignment
            overrides automatic geometry matching.
          </p>
          {staged ? (
            <div
              className="flex flex-wrap items-center gap-2 mb-2"
              data-e-staged-assignment={family}
            >
              <strong>staged: {staged}</strong>
              <Button label="Unstage family rule" busy={pending} onClick={() => void pick("")}>
                unstage
              </Button>
            </div>
          ) : null}
          <SearchControl>
            <Input
              surface="embedded"
              aria-label="Search applicable ASHRAE rules"
              placeholder="table, rule, condition…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </SearchControl>
          <ul
            aria-label="Applicable ASHRAE rules"
            className="max-h-64 overflow-y-auto hairline-rows mt-1"
          >
            {choices.map((rule) => {
              const condition = ruleConditions(rule, row);
              const active = staged
                ? staged === rule.key
                : row.rules.some((current) => current.key === rule.key);
              return (
                <li key={rule.key} className="py-1" data-selected={active || undefined}>
                  <Button
                    label={`Use ${priced ? tableOf(priced, rule.key) : rule.table} ${rule.family} ${rule.type} ${rule.cond}`}
                    pressed={active}
                    busy={pending}
                    onClick={() => void pick(rule.key)}
                  >
                    <span className="face-mono">
                      {priced ? tableOf(priced, rule.key) : rule.table}
                    </span>{" "}
                    · {rule.family} {active ? " · current" : ""}
                  </Button>
                  <p className={condition.inactive ? "text-ink-2" : undefined}>
                    {condition.words}
                    {condition.inactive ? " · not matched" : ""}
                  </p>
                  {condition.actual ? <p className="text-ink-2">{condition.actual}</p> : null}
                  <p className="text-ink-2">{rule.basis}</p>
                </li>
              );
            })}
            {!choices.length ? (
              <li className="py-2 text-ink-2">
                No matching rules. Clear the search to see applicable rules.
              </li>
            ) : null}
          </ul>
        </>
      )}
      {error ? (
        <p role="alert" data-tone="alarm">
          {error}
        </p>
      ) : null}
    </aside>
  );
}

/**
 * The one breakdown popover: the bar is its trigger (hover or click), the per-group list its
 * content, aligned to the trigger's left edge so the large bar sits under (or over) the hovered
 * one wherever the viewport allows. Single-system strip and every all-systems row use this; the
 * content mounts only while open (Portal owns lazy mounting), so 355 rows hold 355 closed roots.
 */
export function BarPopover({
  split,
  scale,
  light,
  back,
  head,
  className,
  children,
}: {
  split: Split;
  scale: number;
  light?: Light;
  back?: readonly number[];
  /** Drawn above the breakdown, built only while the popover is open. */
  head?: () => ReactNode;
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
        delay={0}
        aria-label="loss breakdown by element group"
        data-e-bar-trigger=""
        className={`relative flex items-center p-0! min-h-0! border-0 before:absolute before:inset-x-0 before:-inset-y-1 before:content-[''] ${className ?? ""}`}
        onClick={(event) => event.stopPropagation()}
      >
        {children}
      </PopoverTrigger>
      <PopoverContent
        side="bottom"
        align="start"
        className="w-[min(74rem,var(--available-width))] p-2"
        onClick={(event) => event.stopPropagation()}
      >
        {head?.()}
        <BreakdownList split={split} scale={scale} light={light} back={back} barW={barW} />
      </PopoverContent>
    </Popover>
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
        <span className={`${COL.ft} text-right`}>Σ eq ft</span>
      </TooltipHint>
      <span className={COL.wg} aria-hidden />
      <TooltipHint content="this row's own effective length, in equivalent feet; the small number beside it is its own loss in in-wg">
        <span className={`${COL.ft} border-line border-l pl-1.5 text-right`}>+ eq ft</span>
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
