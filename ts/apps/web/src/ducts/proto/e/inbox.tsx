import { useMemo, useState, type ReactNode } from "react";
import {
  Ban,
  Check,
  Crosshair,
  Eye,
  EyeOff,
  Fan,
  Link,
  Pencil,
  Wrench,
  X,
  type LucideIcon,
} from "lucide-react";
import type { DuctsRouteDocument, RouteStatePatch } from "@pe/agent-contracts";
import type { DuctSnapshot } from "@pe/ducts-domain/types";
import { Button } from "@pe/kit/lang/button";
import { FactChip } from "@pe/kit/lang/chip";
import { EmptyState } from "@pe/kit/lang/empty";
import { Inbox as KitInbox, type InboxRowSpec } from "@pe/kit/lang/inbox";
import { reviewTransitions, type CellWire } from "#/components/work/band";
import type { ActionHandle } from "#/route/handle";
import { showInRevit } from "#/revit/element-menu";
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
  diagnosticsKey,
  INBOX_LABELS,
  INBOX_ORDER,
  type CellRef,
  type InboxGroup,
  type InboxItem,
  type RowVerb,
} from "../../inbox-rows";
import type { Claim } from "../../legs";
import { inboxWriteRows, type WriteVerbs } from "./inbox-write";
import { InboxClaim, claimLine } from "./inbox-claim";

type InboxWork = {
  doc: DuctsRouteDocument | null;
  revision: number | null;
  write: (patch: RouteStatePatch[]) => Promise<unknown>;
  /** The model's store: its rulings are the base a verdict or role press stages against. */
  store: DuctSnapshot["store"];
};

/** A fan verb's handles: the route's fan preview and apply, run with the verb's unit and system. */
export interface FanVerbs {
  preview: ActionHandle;
  apply: ActionHandle;
  busy: boolean;
}

/** One make-the-fan verb as a button; the Inputs pane and the no-fan row draw it the same way. */
export function FanButton({
  verb,
  fan,
}: {
  verb: Extract<RowVerb, { kind: "fan" }>;
  fan: FanVerbs;
}) {
  const handle = verb.mode === "preview" ? fan.preview : fan.apply;
  return (
    <Button
      kind={verb.mode === "apply" ? "commit" : "framed"}
      label={verb.label}
      reason={verb.says}
      refusal={verb.refusal ?? handle.refusal}
      busy={fan.busy}
      onClick={() => void handle.run({ unitId: verb.unitId, systemId: verb.systemId })}
    >
      {verb.label}
    </Button>
  );
}

/** A Heal row's verbs: the route's heal preview and heal, run with the row's group. */
interface HealVerbs {
  preview: ActionHandle;
  apply: ActionHandle;
  busy: boolean;
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
  diagnostic,
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
  /** The Diagnostics kind picked in its key (empty = none), and its press. */
  diagnostic: { kind: string; pick: (kind: string) => void };
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
          ? { kind: extra.commit ? ("commit" as const) : ("framed" as const) }
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
        // The choice lists in the open row only: one press per candidate, its coverage beside it.
        return worded
          ? verb.options.map((o) =>
              make(
                `a${i}${o.slot}`,
                Pencil,
                `${o.label} · ${o.have}/${o.of}`,
                `Read every ${verb.of ?? "terminal"}'s airflow from ${o.label}: ${o.have} of ${o.of} ${verb.of ?? "terminal"}s hold a value`,
                () => void work.write(airflowPatches(work.doc, o.slot, verb.of)),
                { pressed: o.slot === verb.current },
              ),
            )
          : null;
      case "focus":
        return make(`f${i}`, Pencil, verb.label, verb.says, () => onFocusCell(verb.cell));
      case "heal": {
        const handle = verb.mode === "preview" ? heal.preview : heal.apply;
        return make(
          `h${i}${verb.mode}`,
          verb.mode === "preview" ? Eye : Wrench,
          verb.label,
          verb.says,
          () => void handle.run({ group: verb.group }),
          {
            refusal: verb.refusal ?? handle.refusal,
            busy: heal.busy,
            commit: verb.mode === "apply",
          },
        );
      }
      case "fan":
        // Worded in the open row only: the label names the unit and the system.
        return worded ? <FanButton key={`n${i}${verb.mode}`} verb={verb} fan={fan} /> : null;
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
          Crosshair,
          "select in Revit",
          "select in Revit",
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

  const spec = (item: InboxItem): InboxRowSpec => {
    const target = observedElements(observation, item.ids);
    const claim = item.verbs.find((v) => v.kind === "claim");
    const title = claim?.kind === "claim" ? claimLine(claim.claim, nameOf) : item.title;
    return {
      key: item.key,
      "data-kind": item.kind,
      title,
      titleText: title,
      status: <span data-tone={item.tone}>{item.status}</span>,
      verbs: verbsOf(item, false),
      onMouseEnter: () => light(item.ids),
      revitIds: target.ids,
      revitRefs: target.refs,
      lit: (selected != null && item.ids.includes(selected)) || item.key === focused,
      onClick: () => onSelect(item.ids[0] ?? null),
      detail: (
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

  const { writeSpec, reviewSpecs } = inboxWriteRows(write);

  const legend = diagnosticsKey(groups.diagnostics).map(({ kind, count }) => (
    <Button
      key={kind}
      kind="framed"
      label={`${kind} ${count}`}
      reason={
        diagnostic.kind === kind
          ? "Show every Diagnostics row again, and annotate only the Fix rows on the picture"
          : `Show only the ${kind} rows, here and on the picture`
      }
      pressed={diagnostic.kind === kind}
      onClick={() => diagnostic.pick(diagnostic.kind === kind ? "" : kind)}
    >
      {kind} <span className="text-ink-mute tabular-nums">{count}</span>
    </Button>
  ));
  const specs = useMemo(
    () =>
      ({
        fix: { label: INBOX_LABELS.fix, rows: groups.fix.map(spec) },
        set: { label: INBOX_LABELS.set, rows: groups.set.map(spec) },
        check: { label: INBOX_LABELS.check, rows: groups.check.map(spec) },
        write: {
          label: INBOX_LABELS.write,
          rows: [{ ...writeSpec, lit: focused === "write" }, ...reviewSpecs],
          always: true,
        },
        diagnostics: {
          label: INBOX_LABELS.diagnostics,
          rows: groups.diagnostics
            .filter((r) => !diagnostic.kind || diagnosticKind(r) === diagnostic.kind)
            .map(spec),
          legend: legend.length ? legend : undefined,
          collapsible: true,
          defaultCollapsed: true,
        },
      }) satisfies Record<InboxGroup, unknown>,
    // eslint-disable-next-line react-hooks/exhaustive-deps -- spec closes over props that change with them
    [
      groups,
      work.doc,
      work.revision,
      work.store,
      observation,
      selecting,
      write.row,
      write.review,
      write.preview.refusal,
      write.preview.label,
      write.apply.refusal,
      write.apply.label,
      write.busy,
      heal.busy,
      fan.busy,
      onVerdict,
      selected,
      focused,
      diagnostic.kind,
      diagnostic.pick,
    ],
  );
  return (
    <>
      <KitInbox
        aria-label="inbox"
        order={INBOX_ORDER}
        groups={specs}
        onMouseLeave={() => light(null)}
        empty={
          <EmptyState story="scope" exit="stage a change or ask Pea">
            nothing to rule on
          </EmptyState>
        }
      />
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
