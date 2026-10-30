/**
 * The fan sheet view of /ducts (`?stage=sheet`, the head's "Pricing fans" stage; protoui rounds 1 to 3, 2026-10-28, variant A "Ledger"
 * promoted): on the house pane system (`SHEET_LAYOUT`, `TeachingLayoutView`, `ListView`), the
 * roster and the inputs fold share one full-height sidebar; the picture sits over the tier ledger on
 * the right, each in its own resizable pane. The ledger is ONE scroll with every tier's items
 * grouped taken / accept / preview, counts in each group header, one batch verb per group that runs
 * every live closer (`kind="commit"` when live).
 */
import { Fragment, useMemo, useState } from "react";
import { Button } from "@pe/kit/lang/button";
import { emptyListState, useList, type ListState } from "@pe/kit/lang/collection";
import { ListView, type ListRowParts } from "@pe/kit/lang/list-view";
import { Scroll } from "@pe/kit/lang/scroll";
import type { PaneSide } from "@pe/kit/lang/pane";
import { TeachingLayoutView } from "@pe/kit/lang/teaching-layout";
import { fanKey, pressure, type FanPort } from "./api";
import { BlockerRow } from "./blocker-row";
import type { Closer } from "./closer";
import { SHEET_LAYOUT } from "./layout";
import { subjectNamer } from "../subject-text";
import {
  isConsequence,
  presentIds,
  tierOf,
  TIERS,
  tierTone,
  type SheetBlocker,
  type Tier,
} from "./tiers";
import type { SheetViewProps } from "./types";
import { Worksheet } from "./worksheet-table";

const rosterState = (row: FanPort) =>
  row.complete
    ? `ESP ${pressure(row.requiredEspInWg)} in-wg`
    : row.complete === false
      ? "incomplete"
      : "not computed";
const rosterSearch = (row: FanPort) => ({
  text: [row.mark, row.kind, row.side, String(row.portIndex)],
  ids: [row.unitId],
});

function Roster({ props }: { props: SheetViewProps }) {
  const openKey = props.sheet
    ? fanKey(props.sheet.overview.fan ?? { unitId: -1, portIndex: -1 })
    : null;
  const wait = props.busy || props.loading ? "Wait for the current read" : null;
  const [listState, setListState] = useState<ListState>(emptyListState());
  const list = useList({
    items: props.roster,
    keyOf: fanKey,
    search: rosterSearch,
    select: "single",
    state: { ...listState, selected: openKey ? [openKey] : [] },
    onState: setListState,
    onPick: (row) => props.open(row),
    refusalOf: () => wait,
  });
  // A blank firm tag falls back to the unit's Mark or family; a name shared by two units (Chadds
  // has two FC-23s) carries the unit id so the person can tell the rows apart.
  const nameOf = useMemo(() => subjectNamer(props.snapshot), [props.snapshot]);
  const unitName = (fan: FanPort) => fan.mark || nameOf(fan.unitId) || `unit ${fan.unitId}`;
  const shared = useMemo(() => {
    const units = new Map<string, Set<number>>();
    for (const fan of props.roster)
      units.set(unitName(fan), (units.get(unitName(fan)) ?? new Set()).add(fan.unitId));
    return new Set([...units].filter(([, ids]) => ids.size > 1).map(([name]) => name));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.roster, nameOf]);
  const labelOf = (fan: FanPort) =>
    `${unitName(fan)}${shared.has(unitName(fan)) ? ` (${fan.unitId})` : ""} · port ${fan.portIndex}`;
  const row = (fan: FanPort): ListRowParts => ({
    label: labelOf(fan),
    aside: fan.kind,
    meta: (
      <span className="face-mono t-small">
        {rosterState(fan)}
        {fan.blockerCount == null ? "" : ` · ${fan.blockerCount} open`}
      </span>
    ),
    revit: [fan.unitId],
    title: `Open ${labelOf(fan)}`,
  });
  // The roster pane clips; the list scrolls in its own Scroll, as the /ducts systems pane does.
  return (
    <Scroll className="min-h-0 flex-1">
      <ListView
        aria-label="fans"
        list={list}
        row={row}
        projection={(fan) => ({ weight: fan.blockerCount ?? 0 })}
        empty={{ message: "No fan ports on the roster", exit: "Read a model with air movers" }}
      />
    </Scroll>
  );
}

function RosterVerbs({ props }: { props: SheetViewProps }) {
  const wait = props.busy || props.loading ? "Wait for the current read" : null;
  return (
    <span className="flex items-baseline gap-1">
      <Button kind="framed" label="Compute every fan" refusal={wait} onClick={props.computeAll}>
        compute all
      </Button>
      {props.busy && (
        <Button kind="framed" label="Cancel" onClick={props.cancel}>
          cancel
        </Button>
      )}
    </span>
  );
}

function Sides({ props }: { props: SheetViewProps }) {
  const totals = props.sheet?.overview.totals;
  const fan = props.sheet?.overview.fan;
  if (!fan || !totals) return <p className="t-small text-ink-2">No fan open.</p>;
  // One aligned overview: the required ESP line, then a side per row with fixed numeric columns,
  // so the numbers read down a column instead of wrapping as run-on sentences.
  return (
    <section aria-label="Required ESP" className="flex flex-col gap-1" data-sheet-esp="">
      <h3 className="t-head">
        {fan.mark} · port {fan.portIndex}
      </h3>
      <div className="t-small grid grid-cols-[auto_minmax(0,1fr)] gap-x-3">
        <span className="text-ink-2">required ESP</span>
        <span className="face-mono truncate">
          {totals.requiredEspInWg == null ? (
            <span className="text-ink-2">— needs two complete sides</span>
          ) : (
            `${pressure(totals.requiredEspInWg)} in-wg`
          )}
          {totals.requiredEspAssumedInWg != null &&
            ` · with assumptions ${pressure(totals.requiredEspAssumedInWg)}`}
        </span>
        {/* R3: the unit's PE_M_Fan_ExternalStaticPressure value is the required ESP written, not a rating. */}
        <span className="text-ink-2">required (written)</span>
        <span className="face-mono">{pressure(fan.ratedEspInWg)}</span>
      </div>
      <div className="t-small grid grid-cols-[4rem_5.5rem_repeat(2,minmax(0,6rem))] gap-x-3">
        <span className="contents">
          <span />
          <span />
          <span className="text-right text-ink-2">worst in-wg</span>
          <span className="text-right text-ink-2">allowance</span>
        </span>
        {(["supply", "return"] as const).map((side) => (
          <span key={side} className="contents" data-side={side}>
            <span>{side}</span>
            <span className={totals[side].complete ? "" : "text-ink-2"}>
              {totals[side].complete ? "complete" : "incomplete"}
            </span>
            <span className="face-mono text-right">{pressure(totals[side].worstPath)}</span>
            <span className="face-mono text-right">{pressure(totals[side].allowanceInWg)}</span>
          </span>
        ))}
      </div>
    </section>
  );
}

function TierGroup({
  tier,
  blockers,
  consequencesOf,
  props,
}: {
  tier: Tier;
  /** The tier's cause rows; R-B consequences arrive through `consequencesOf`, never as rows of their own. */
  blockers: readonly SheetBlocker[];
  consequencesOf: (id: string) => readonly SheetBlocker[];
  props: SheetViewProps;
}) {
  // The batch runs each row's closer with no typed value: the firm shim for drops, the pair for
  // joins and heals; rows that need a typed number stay refused and are left to their row.
  const closers: Closer[] = blockers.map((b) => props.closerOf(b, null));
  const live = closers.filter((c) => c.refusal == null);
  const batch =
    props.busy || props.loading
      ? "Wait for the current read"
      : live.length > 0
        ? null
        : (closers.find((c) => c.refusal)?.refusal ?? "Nothing to close");
  const verb = tier === "preview" ? "heal" : "accept";
  const count = tier === "taken" ? props.taken.length : blockers.length;
  return (
    <section aria-label={`${tier} tier`} data-tier-group={tier} className="flex flex-col gap-1">
      <header className="flex items-baseline gap-3">
        <h3 className="t-head" data-tone={tierTone(tier)}>
          {tier} · {count}
        </h3>
        {tier !== "taken" && blockers.length > 0 && (
          <Button
            kind={batch ? "framed" : "commit"}
            label={`${verb} all ${live.length} ${tier} blockers`}
            refusal={batch}
            onClick={() => live.forEach(props.close)}
          >
            {verb} all {live.length}
            {live.length < blockers.length ? ` of ${blockers.length}` : ""}
          </Button>
        )}
      </header>
      {tier === "taken" ? (
        <ul className="t-small text-ink-2">
          {props.taken.map((text) => (
            <li key={text}>{text}</li>
          ))}
          {props.taken.length === 0 && <li>nothing taken silently</li>}
        </ul>
      ) : (
        <div role="table">
          {blockers.map((blocker) => (
            <Fragment key={blocker.id}>
              <BlockerRow
                blocker={blocker}
                focused={props.focusedBlocker === blocker.id}
                closerOf={props.closerOf}
                onClose={props.close}
                onFocus={props.focusBlocker}
              />
              {consequencesOf(blocker.id).map((effect) => (
                <BlockerRow
                  key={effect.id}
                  blocker={effect}
                  consequence
                  focused={props.focusedBlocker === effect.id}
                  closerOf={props.closerOf}
                  onClose={props.close}
                  onFocus={props.focusBlocker}
                />
              ))}
            </Fragment>
          ))}
        </div>
      )}
    </section>
  );
}

function Ledger({ props }: { props: SheetViewProps }) {
  // R-B: consequence rows nest under their cause; only cause rows take a tier and a verb.
  const present = presentIds(props.blockers);
  const causes = props.blockers.filter((b) => !isConsequence(b, present));
  const consequencesOf = (id: string) => props.blockers.filter((b) => b.causedBy === id);
  return (
    <div className="flex flex-col gap-3 p-2" data-sheet-ledger="">
      {props.error && (
        <p role="alert" data-tone="alarm">
          {props.error}
        </p>
      )}
      {(props.busy || props.loading) && (
        <p role="status">{props.loading ? "reading roster…" : "computing…"}</p>
      )}
      <Sides props={props} />
      {/* The worksheet is the body (ducts LEDGER 2026-10-29); the tiers below are the gaps to close. */}
      {props.sheet && (
        <Worksheet
          ws={props.sheet.worksheet}
          editing={{ inputs: props.inputs, changeInputs: props.changeInputs, busy: props.busy }}
        />
      )}
      {props.sheet &&
        TIERS.map((tier) => (
          <TierGroup
            key={tier}
            tier={tier}
            blockers={causes.filter((b) => tierOf(b) === tier)}
            consequencesOf={consequencesOf}
            props={props}
          />
        ))}
    </div>
  );
}

export function SheetView(props: SheetViewProps) {
  const [sidebar, setSidebar] = useState<PaneSide | null>(null);
  const [inputs, setInputs] = useState<PaneSide | null>(null);
  const [picture, setPicture] = useState<PaneSide | null>(null);
  const open = props.tiers.accept + props.tiers.preview;
  const progress = props.progress
    ? `${props.progress.done}/${props.progress.total} ${props.progress.mark}${props.progress.stopped ? " (stopped)" : ""}`
    : `${props.roster.length} fan ports`;
  return (
    <div className="flex size-full min-h-0" data-sheet-variant-a="">
      <TeachingLayoutView<typeof SHEET_LAYOUT>
        layout={SHEET_LAYOUT}
        content={{
          "sheet-roster": (pane) =>
            pane(<Roster props={props} />, {
              meta: progress,
              actions: <RosterVerbs props={props} />,
            }),
          "sheet-inputs": (pane) => pane(props.inputsSurface),
          "sheet-picture": (pane) => props.picture(pane),
          "sheet-ledger": (pane) =>
            pane(<Ledger props={props} />, {
              meta: props.sheet ? `${open} open · ${props.tiers.taken} taken` : "no fan open",
            }),
        }}
        state={{
          folds: {
            sheet: { collapsed: sidebar, onChange: setSidebar },
            "sheet-side": { collapsed: inputs, onChange: setInputs },
            "sheet-main": { collapsed: picture, onChange: setPicture },
          },
        }}
      />
    </div>
  );
}
