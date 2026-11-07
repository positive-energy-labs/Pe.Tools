import { useAdmittedSubject } from "#/shell/subject";
/**
 * The fan sheet view of /ducts (`?stage=sheet`, the head's "Pricing fans" stage; protoui rounds 1 to 3, 2026-10-28, variant A "Ledger"
 * promoted): pane bodies for the kernel's graph layout, using the house `ListView`. The
 * roster and the inputs fold share one full-height sidebar; the picture sits over the tier ledger on
 * the right, each in its own resizable pane. The ledger is ONE scroll with every tier's items
 * grouped taken / accept / preview, counts in each group header, one batch verb per group that runs
 * every live closer (`kind="commit"` when live).
 */
import { Button } from "@pe/kit/lang/button";
import { emptyListState, useList, type ListState } from "@pe/kit/lang/collection";
import { ListView, PlainList, type ListRowParts } from "@pe/kit/lang/list-view";
import { Scroll } from "@pe/kit/lang/scroll";
import { Fragment, useMemo, useState } from "react";
import { BlockerRow } from "./blocker-row";
import type { Closer } from "./closer";
import { fanKey, fanLabel, pressure, stableFanKey, type FanPort } from "./model";
import {
  isConsequence,
  presentIds,
  tierOf,
  TIERS,
  tierTone,
  type SheetBlocker,
  type Tier,
} from "./tiers";
import type { LedgerProps, RosterProps } from "./types";
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

export function Roster({ props }: { props: RosterProps }) {
  const subject = useAdmittedSubject();
  const wait = props.busy || props.loading ? "Wait for the current read" : null;
  const [listState, setListState] = useState<ListState<"name">>(emptyListState<"name">());
  const list = useList({
    persist: props.address,
    sorts: { name: (fan: FanPort) => fan.mark },
    ...(props.value ? { value: props.value, rowsOf: () => props.roster } : { items: props.roster }),
    keyOf: fanKey,
    search: rosterSearch,
    select: "multi",
    state: {
      ...listState,
      selected: props.roster.filter((row) => props.picked?.includes(stableFanKey(row))).map(fanKey),
    },
    onState: (next) => setListState({ ...next, selected: [] }),
    onPick: (row) => props.open(row),
    refusalOf: () => wait,
  });
  // A blank firm tag falls back to the unit's Mark or family; a name shared by two units (Chadds
  // has two FC-23s) is told apart by level, system or order (fanLabel), never by an id.
  const nameOf = props.nameOf;
  const unitName = (fan: FanPort) => fan.mark || nameOf(fan.unitId);
  const named = useMemo(
    () => props.roster.map((fan) => ({ ...fan, mark: unitName(fan) })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [props.roster, nameOf],
  );
  const labelOf = (fan: FanPort) => fanLabel({ ...fan, mark: unitName(fan) }, named);
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
        search="always"
        header={
          <div className="flex flex-wrap items-center justify-between gap-2 p-1">
            <span className="t-small">
              {props.roster.length} fan ports / {props.picked?.length ?? 0} open
            </span>
            <span className="flex gap-1">
              <Button label="All fans" onPress={() => subject?.all()}>
                All
              </Button>
              <Button label="Clear fans" onPress={() => subject?.clear()}>
                Clear
              </Button>
            </span>
          </div>
        }
        list={list}
        row={row}
        projection={(fan) => ({ weight: fan.blockerCount ?? 0 })}
        empty={{ message: "No fan ports on the roster", exit: "Read a model with air movers" }}
      />
    </Scroll>
  );
}

function Sides({ props }: { props: LedgerProps }) {
  const totals = props.sheet?.overview.totals;
  const fan = props.sheet?.overview.fan;
  if (!fan || !totals)
    return props.busy || props.loading ? null : <p className="t-small text-ink-2">No fan open.</p>;
  const currentEsp = props.inputs?.units[String(fan.unitId)]?.esp;
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
        {/* The resolver includes staged Work; a Read plan cannot claim a native write. */}
        <span className="text-ink-2">required ({currentEsp?.source ?? "source unknown"})</span>
        <span className="face-mono">
          {pressure(currentEsp ? currentEsp.value : fan.ratedEspInWg)}
        </span>
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
  props: LedgerProps;
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
  const taken = useList({
    items: props.taken,
    keyOf: (text) => text,
    search: (text) => ({ text: [text] }),
    select: "none",
  });
  const count = tier === "taken" ? props.taken.length : blockers.length;
  return (
    <section
      aria-label={`${tier} tier`}
      data-tier-group={tier}
      className={tier === "taken" ? "col-span-full flex flex-col gap-1" : "flex flex-col gap-1"}
    >
      <header className="flex items-baseline gap-3">
        <h3 className="t-head" data-tone={tierTone(tier)}>
          {tier} · {count}
        </h3>
        {tier !== "taken" && blockers.length > 0 && (
          <Button
            kind={batch ? "framed" : "commit"}
            label={`${verb} all ${live.length} ${tier} blockers`}
            refusal={batch}
            onClick={() => props.closeMany(live)}
          >
            {verb} all {live.length}
            {live.length < blockers.length ? ` of ${blockers.length}` : ""}
          </Button>
        )}
      </header>
      {tier === "taken" ? (
        <PlainList
          list={taken}
          aria-label="Taken assumptions"
          row={(text) => ({ label: text })}
          empty={{ message: "nothing taken silently", exit: "Review the remaining blockers" }}
        />
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

export function Ledger({ props }: { props: LedgerProps }) {
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
      {props.sheet && (
        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,24rem),1fr))] items-start gap-3">
          {TIERS.map((tier) => (
            <TierGroup
              key={tier}
              tier={tier}
              blockers={causes.filter((b) => tierOf(b) === tier)}
              consequencesOf={consequencesOf}
              props={props}
            />
          ))}
        </div>
      )}
    </div>
  );
}
