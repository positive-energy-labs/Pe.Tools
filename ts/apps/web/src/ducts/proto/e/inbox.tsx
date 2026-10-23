import { useEffect, useRef, useState, type ReactNode } from "react";
import { Ban, Check, Eye, EyeOff, Fan, Link, Pencil, X, type LucideIcon } from "lucide-react";
import type { DuctsRouteDocument, RouteStatePatch } from "@pe/agent-contracts";
import type { DuctSnapshot } from "@pe/ducts-domain/types";
import { Button } from "@pe/kit/lang/button";
import { FactChip } from "@pe/kit/lang/chip";
import { useList, emptyListState, type ListState } from "@pe/kit/lang/collection";
import { ListView } from "@pe/kit/lang/list-view";
import { PreviewAction } from "@pe/kit/lang/preview-action";
import { reviewTransitions, type CellWire } from "#/components/work/band";
import type { ActionHandle } from "#/route/handle";
import { SelectInRevitIcon, showInRevit } from "#/revit/element-menu";
import {
  prepareElements,
  showElementsMessage,
  type ShowElementsResult,
} from "#/revit/element-target";
import { observedElements, useNativeObservation } from "#/revit/observation";

import { airflowPatches } from "../../airflow";
import { rulingPatches, verdictPatches } from "../../assumptions";
import { VERDICTS, type Verdict } from "../../claims";
import {
  diagnosticKind,
  INBOX_LABELS,
  INBOX_ORDER,
  type CellRef,
  type InboxGroup,
  type InboxItem,
  type RowVerb,
} from "../../inbox-rows";
import type { Claim } from "../../legs";
import { inboxWriteRows, type WriteVerbs, type RulingRow } from "./inbox-write";
import { PreviewLines } from "./preview-lines";
import { SlotPicker } from "./slot-picker";
import { InboxClaim, claimLine } from "./inbox-claim";
import { RuleAssignment } from "./rule-assignment";

type InboxWork = {
  doc: DuctsRouteDocument | null;
  revision: number | null;
  write: (patch: RouteStatePatch[]) => Promise<unknown>;
  /** The model's store: its rulings are the base a verdict or role press stages against. */
  store: DuctSnapshot["store"];
};

/** A preview verb's handles: the route's preview and apply, run with the row's target. */
interface PreviewHandles {
  preview: ActionHandle;
  apply: ActionHandle;
  busy: boolean;
}

/** A fan verb's handles: the route's fan preview and apply, run with the verb's unit and system. */
export type FanVerbs = PreviewHandles;

/** A Heal row's verbs: the route's heal preview and heal, run with the row's group. */
type HealVerbs = PreviewHandles;

/**
 * One preview-then-do verb as a kit `PreviewAction`, run with the route's own preview and apply
 * handles and the row's target. The Heal row's glyph and `FanButton` draw it.
 */
function PreviewVerb({
  verb,
  pair,
  icon,
}: {
  verb: Extract<RowVerb, { kind: "preview" }>;
  pair: PreviewHandles;
  icon?: LucideIcon;
}) {
  const input =
    verb.on.verb === "heal"
      ? { group: verb.on.group }
      : { unitId: verb.on.unitId, systemId: verb.on.systemId };
  return (
    <PreviewAction
      label={verb.label}
      says={verb.says}
      refusal={pair.preview.refusal}
      busy={pair.busy}
      icon={icon}
      held={verb.held && { ...verb.held, lines: <PreviewLines lines={verb.held.lines} /> }}
      stale={verb.stale}
      preview={() => pair.preview.run(input)}
      commit={{
        ...verb.commit,
        refusal: verb.commit.refusal ?? pair.apply.refusal,
        run: () => pair.apply.run(input),
        done: verb.on.verb === "heal" ? "healed" : "done: the fan is Revit's now",
      }}
    />
  );
}

/** One make-the-fan verb as a button; the Inputs pane and the no-fan row draw it the same way. */
export function FanButton({
  verb,
  fan,
}: {
  verb: Extract<RowVerb, { kind: "preview" }>;
  fan: FanVerbs;
}) {
  return <PreviewVerb verb={verb} pair={fan} />;
}

const VERDICT_ICON: Record<"capped" | "connect" | "ignore", LucideIcon> = {
  capped: Ban,
  connect: Link,
  ignore: EyeOff,
};

export function Inbox({
  groups,
  work,
  nameOf,
  onVerdict,
  light,
  onSelect,
  onFocusCell,
  write,
  heal,
  fan,
  selected,
  focused,
  onPick,
  address,
}: {
  groups: Record<Exclude<InboxGroup, "write">, readonly InboxItem[]>;
  work: InboxWork;
  nameOf: (id: number) => string;
  onVerdict: ((claim: Claim, verdict: Verdict) => void) | null;
  light: (ids: readonly number[] | null) => void;
  onSelect: (id: number | null) => void;
  /** Select the element and focus its cell on the tree. */
  onFocusCell: (cell: CellRef) => void;
  write: WriteVerbs;
  heal: HealVerbs;
  fan: FanVerbs;
  /** The page's selected element: every row naming it opens. */
  selected: number | null;
  /** The inbox row a review named (`focusRow`): it opens, wears selected and pulses once. */
  focused: string | null;
  /** A person's pick releases the review landing address. */
  onPick?: () => void;
  address?: {
    query: string;
    sort: "" | "name" | "status";
    onChange: (query: string, sort: "" | "name" | "status") => void;
  };
}) {
  const observation = useNativeObservation();
  const [nativeResult, setNativeResult] = useState<ShowElementsResult | null>(null);
  const [selecting, setSelecting] = useState(false);
  const cellOf = (segment: string, key: string) =>
    (work.doc as unknown as Record<string, Record<string, object> | undefined> | null)?.[segment]?.[
      key
    ] ?? {};

  /** One verb as a button: the compact icon square, or the worded one in an open row. */
  const verbButton = (verb: RowVerb, i: number, worded: boolean): ReactNode => {
    const make = (
      key: string,
      icon: LucideIcon,
      label: string,
      says: string,
      run: () => void,
      extra: { pressed?: boolean; refusal?: string | null; busy?: boolean; commit?: boolean } = {},
    ) => (
      <Button
        key={key}
        {...(worded
          ? {
              kind: extra.commit ? ("commit" as const) : ("framed" as const),
              icon: verb.kind === "select" ? icon : undefined,
            }
          : { icon })}
        label={worded ? label : says}
        reason={worded ? says : undefined}
        pressed={extra.pressed}
        refusal={extra.refusal}
        busy={extra.busy}
        onClick={run}
      >
        {worded ? label : undefined}
      </Button>
    );
    switch (verb.kind) {
      case "price-as":
        return worded ? <RuleAssignment key={`rule${i}`} family={verb.family} work={work} /> : null;
      case "verdict":
        return make(
          `v${i}`,
          VERDICT_ICON[verb.verdict],
          verb.label,
          verb.says,
          () =>
            void work.write(
              verdictPatches(work.doc, verb.key, verb.on ? "unset" : verb.verdict, work.store),
            ),
          { pressed: verb.on },
        );
      case "role":
        return make(
          `r${i}`,
          Fan,
          verb.label,
          verb.says,
          () =>
            void work.write(
              rulingPatches(work.doc, work.store, "roles", String(verb.id), verb.role),
            ),
        );
      case "airflow":
        // The choice is the shared compact picker, in the open row only.
        return worded ? (
          <SlotPicker
            key={`a${i}`}
            word={verb.of === "unit" ? "Unit airflow" : "Grille airflow"}
            current={verb.current}
            options={verb.options}
            noun={verb.of === "unit" ? "units" : "grilles"}
            where="in this scope"
            onPick={(slot) => void work.write(airflowPatches(work.doc, slot, verb.of))}
          />
        ) : null;
      case "focus":
        return make(`f${i}`, Pencil, verb.label, verb.says, () => onFocusCell(verb.cell));
      case "preview":
        // A Heal row draws its glyph in the closed row; a fan's label names the unit and the
        // system, so it draws worded in the open row only.
        if (verb.on.verb === "heal")
          return (
            <PreviewVerb key={`p${i}`} verb={verb} pair={heal} icon={worded ? undefined : Eye} />
          );
        return worded ? <FanButton key={`n${i}`} verb={verb} fan={fan} /> : null;
      case "claim":
        return VERDICTS.map((v, j) =>
          make(
            `c${i}${j}`,
            ([Check, X, Ban] as const)[j]!,
            v.word,
            `${v.word}: ${v.says}`,
            () => onVerdict?.(verb.claim, v.value),
            {
              pressed: verb.claim.verdict === v.value,
              refusal: onVerdict ? null : "no subject: the verdict has nowhere to stage",
            },
          ),
        );
      case "stage": {
        const wire: CellWire = {
          segment: verb.segment as CellWire["segment"],
          revision: work.revision,
          write: work.write as CellWire["write"],
        };
        const kind = verb.move;
        return make(
          `s${i}${kind}`,
          kind === "accept" ? Check : X,
          verb.label,
          verb.says,
          () =>
            void reviewTransitions(wire, verb.key, cellOf(verb.segment, verb.key))
              .find((t) => t.kind === kind)
              ?.run(),
        );
      }
      case "select": {
        const target = observedElements(observation, verb.ids);
        const prepared = prepareElements(target, true);
        return make(
          `x${i}`,
          SelectInRevitIcon,
          "Select in Revit",
          "Select in Revit",
          () => {
            setNativeResult(null);
            setSelecting(true);
            void showInRevit(target, true)
              .then(setNativeResult)
              .finally(() => setSelecting(false));
          },
          {
            refusal: prepared.kind === "refused" ? prepared.message : null,
            busy: selecting,
          },
        );
      }
    }
  };
  const verbsOf = (item: InboxItem, worded: boolean) =>
    item.verbs.flatMap((verb, i) => [verbButton(verb, i, worded)].flat());

  const spec = (item: InboxItem): RulingRow => {
    const target = observedElements(observation, item.ids);
    const claim = item.verbs.find((v) => v.kind === "claim");
    const title = claim?.kind === "claim" ? claimLine(claim.claim, nameOf) : item.title;
    return {
      key: item.key,
      search: { text: [title, item.status, item.kind, item.note], ids: item.ids },
      kind: diagnosticKind(item),
      group: item.group,
      statusText: item.status,
      label: title,
      title,
      stage: item.kind === "proposal" ? "proposed" : undefined,
      stagedBy: item.kind === "proposal" ? "pea" : undefined,
      meta: <span data-tone={item.tone}>{item.status}</span>,
      actions: () => verbsOf(item, false),
      onMouseEnter: () => light(item.ids),
      revitIds: target.ids,
      revitRefs: target.refs,
      lit: (selected != null && item.ids.includes(selected)) || item.key === focused,
      pick: () => onSelect(item.ids[0] ?? null),
      detail: () => (
        <>
          {claim?.kind === "claim" ? (
            <InboxClaim
              claim={claim.claim}
              nameOf={nameOf}
              light={light}
              onSelect={onSelect}
              onShown={setNativeResult}
            />
          ) : item.note ? (
            <p>{item.note}</p>
          ) : (
            <p>{item.title}</p>
          )}
          <div className="flex flex-wrap items-center gap-1" data-inbox-verbs="">
            {verbsOf(item, true)}
          </div>
        </>
      ),
    };
  };

  const { writeSpec } = inboxWriteRows(write);

  const rows: RulingRow[] = [
    ...groups.fix.map(spec),
    ...groups.set.map(spec),
    ...groups.check.map(spec),
    { ...writeSpec, lit: focused === "write" },
    ...groups.diagnostics.map(spec),
  ];
  return (
    <>
      <div onMouseLeave={() => light(null)}>
        <RulingsList rows={rows} focused={focused} address={address} onPick={onPick} />
      </div>
      {nativeResult ? (
        <div role="status" className="px-2 py-1">
          <FactChip title="what revit.context.show-elements answered">
            {showElementsMessage(nativeResult)}
          </FactChip>
        </div>
      ) : null}
    </>
  );
}

const rulingSearch = (row: RulingRow) => row.search;

/** Query state must not rebuild every ruling and its action elements. */
function RulingsList({
  rows,
  focused,
  address,
  onPick,
}: {
  rows: RulingRow[];
  focused: string | null;
  onPick?: () => void;
  address?: {
    query: string;
    sort: "" | "name" | "status";
    onChange: (query: string, sort: "" | "name" | "status") => void;
  };
}) {
  const [view, setView] = useState<ListState<"name" | "status">>(() => ({
    ...emptyListState(),
    closed: [INBOX_LABELS.diagnostics],
  }));
  const list = useList({
    items: rows,
    keyOf: (row) => row.key,
    search: rulingSearch,
    fields: {
      kind: { kind: "text", read: (row) => row.kind },
      section: { kind: "text", read: (row) => INBOX_LABELS[row.group] },
      status: { kind: "text", read: (row) => row.statusText },
    },
    sorts: { name: (row) => row.title, status: (row) => row.statusText },
    groups: {
      of: (row) => INBOX_LABELS[row.group],
      order: INBOX_ORDER.map((key) => INBOX_LABELS[key]),
      collapsible: INBOX_ORDER.map((key) => INBOX_LABELS[key]),
    },
    state: { ...view, query: address?.query ?? view.query, sort: address?.sort ?? view.sort },
    onState: (next) => {
      setView(next);
      if (address && (next.query !== address.query || next.sort !== address.sort))
        address.onChange(next.query, next.sort);
    },
    stageOf: (row) => row.stage ?? "clean",
    onPick: (row) => {
      onPick?.();
      setView((previous) => ({
        ...previous,
        selected: [row.key],
        open: previous.open.includes(row.key) ? [] : [row.key],
      }));
      row.pick?.();
    },
  });
  const desired =
    rows.find((row) => row.key === focused) ??
    rows.find((row) => row.lit && view.selected.includes(row.key)) ??
    rows.find((row) => row.lit);
  const reveal = useRef<string | null>(null);
  useEffect(() => {
    reveal.current = desired?.key ?? null;
  }, [desired?.key]);
  useEffect(() => {
    const key = reveal.current;
    if (!key) return;
    const section = list.sections.find((section) => section.rows.some((row) => row.key === key));
    if (!section) return;
    if (section.closed || !view.open.includes(key) || !view.selected.includes(key)) {
      setView((previous) => ({
        ...previous,
        closed: previous.closed.filter((name) => name !== section.key),
        open: [key],
        selected: [key],
      }));
      return;
    }
    reveal.current = null;
    list.reveal(key);
  });
  return (
    <ListView
      aria-label="rulings"
      list={list}
      row={({ key: _key, actions, detail: _detail, ...parts }) => ({
        ...parts,
        actions: actions?.(),
      })}
      detail={(row) =>
        row.detail ? (
          <div data-inbox-detail={row.key} className="px-4 py-1 flex flex-col gap-1.5">
            {list.state.open.includes(row.key) ? row.detail() : null}
          </div>
        ) : null
      }
      empty={{ message: "Nothing to rule on", exit: "Stage a change or ask Pea" }}
    />
  );
}
