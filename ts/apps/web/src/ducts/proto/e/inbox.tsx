/**
 * THROWAWAY (protoui round 3, E2): the inbox in loop order on the kit `Inbox`: Fix, Set, Check,
 * Write, then the collapsed Diagnostics. The rows are `inbox-rows.ts`' (pure, tested); this draws
 * them. A row reads its title and status at rest and takes its verbs on hover; pressing it opens
 * the prose and the worded verbs under it. Inputs are never edited here: a Set row's verb selects
 * the element and focuses the cell on its tree row. The selected element leads to its findings:
 * every row that names it opens, wears selected and scrolls into view, Diagnostics included. The
 * Diagnostics head carries its key, one chip per row kind with its count; a picked chip narrows
 * the Diagnostics rows (and the picture's annotations, `annotatedFindings`) to that kind.
 */
import { useMemo, type ReactNode } from "react";
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
import { EmptyState } from "@pe/kit/lang/empty";
import { Inbox as KitInbox, type InboxRowSpec } from "@pe/kit/lang/inbox";
import { reviewTransitions, type CellWire } from "#/components/work/band";
import type { ActionHandle } from "#/route/handle";

import { airflowPatches } from "../../airflow";
import { rulingPatches, verdictPatches } from "../../assumptions";
import {
  ClaimElement,
  claimParts,
  showElements,
  VERDICTS,
  type Verdict,
} from "../../claims";
import {
  diagnosticKind,
  diagnosticsKey,
  INBOX_LABELS,
  INBOX_ORDER,
  type CellRef,
  type InboxGroup,
  type InboxItem,
  type RowVerb,
  type WriteRow,
} from "../../inbox-rows";
import type { Claim } from "../../legs";
import type { ReviewLine } from "../../write-review";

type RevitDoc = { session: string; openId: string };
export type InboxWork = {
  doc: DuctsRouteDocument | null;
  revision: number | null;
  write: (patch: RouteStatePatch[]) => Promise<unknown>;
  /** The model's store: its rulings are the base a verdict or role press stages against. */
  store: DuctSnapshot["store"];
};

/** The Write group's verbs: the route's own preview and apply, as the handle refuses or arms them. */
export interface WriteVerbs {
  preview: ActionHandle;
  apply: ActionHandle;
  busy: boolean;
  row: WriteRow;
  /** Every change a fresh preview plans, one line each; empty with no fresh preview. */
  review: readonly ReviewLine[];
}

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
export interface HealVerbs {
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
  doc,
  nameOf,
  onVerdict,
  light,
  onSelect,
  onFocusCell,
  write,
  heal,
  fan,
  selected,
  diagnostic,
}: {
  groups: Record<Exclude<InboxGroup, "write">, readonly InboxItem[]>;
  work: InboxWork;
  doc: RevitDoc | null;
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
  /** The Diagnostics kind picked in its key (empty = none), and its press. */
  diagnostic: { kind: string; pick: (kind: string) => void };
}) {
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
      case "select":
        return make(
          `x${i}`,
          Crosshair,
          "select in Revit",
          "select in Revit",
          () => doc && void showElements(doc, verb.ids),
          {
            refusal: !doc
              ? "no Revit document is connected"
              : !verb.ids.length
                ? "no element to select"
                : null,
          },
        );
    }
  };
  const verbsOf = (item: InboxItem, worded: boolean) =>
    item.verbs.flatMap((verb, i) => [verbButton(verb, i, worded)].flat());

  const claimProse = (claim: Claim) => (
    <p>
      {claimParts(claim.text, nameOf).map((p, j) =>
        typeof p === "string" ? (
          <span key={j}>{p}</span>
        ) : p.dot ? (
          <span key={j} className="text-ink-2" title={p.name}>
            ·
          </span>
        ) : (
          <ClaimElement
            key={j}
            part={p}
            doc={doc}
            onHover={(id) => light(id == null ? null : [id])}
            onPick={onSelect}
            onShown={() => undefined}
          />
        ),
      )}
    </p>
  );

  /** A claim as one plain line: ids resolved to names, a name the prose already holds left out. */
  const claimLine = (claim: Claim) =>
    claimParts(claim.text, nameOf)
      .map((p) => (typeof p === "string" ? p : p.dot ? "" : p.name))
      .join("")
      .replace(/\s+/g, " ")
      .replace(/ ([,.;:?])/g, "$1");

  const spec = (item: InboxItem): InboxRowSpec => {
    const claim = item.verbs.find((v) => v.kind === "claim");
    const title = claim?.kind === "claim" ? claimLine(claim.claim) : item.title;
    return {
      key: item.key,
      "data-kind": item.kind,
      title,
      titleText: title,
      status: <span data-tone={item.tone}>{item.status}</span>,
      verbs: verbsOf(item, false),
      onMouseEnter: () => light(item.ids),
      revitIds: item.ids,
      lit: selected != null && item.ids.includes(selected),
      onClick: () => onSelect(item.ids[0] ?? null),
      detail: (
        <>
          {claim?.kind === "claim" ? (
            claimProse(claim.claim)
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

  const writeSpec: InboxRowSpec = {
    key: "write",
    "data-kind": "write",
    title: write.row.title,
    status: (
      <span className="inline-flex items-center gap-1" data-inbox-write="">
        <span>{write.row.status}</span>
        {/* The handle's own words, so the button reads as the Situation's does. */}
        <Button
          kind="framed"
          label={write.preview.label}
          reason="Ask Revit what the staged cells would write"
          refusal={write.preview.refusal}
          busy={write.busy}
          onClick={() => void write.preview.run()}
        >
          {write.preview.label}
        </Button>
        <Button
          kind="commit"
          label={write.apply.label}
          reason="Write the staged cells to Revit"
          refusal={write.apply.refusal}
          busy={write.busy}
          onClick={() => void write.apply.run()}
        >
          {write.apply.label}
        </Button>
      </span>
    ),
    detail:
      write.apply.refusal || write.row.held ? (
        <>
          {write.apply.refusal ? <p data-inbox-write-says="">{write.apply.refusal}</p> : null}
          {write.row.held ? <p data-inbox-write-held="">{write.row.held}</p> : null}
        </>
      ) : undefined,
  };

  // Every change the fresh preview plans, one row each: element · what, old -> new; a refusal says why.
  const reviewSpecs: InboxRowSpec[] = write.review.map((line) => ({
    key: line.key,
    "data-kind": "write-review",
    title: `${line.element} · ${line.what}`,
    titleText: `${line.element} · ${line.what}`,
    status: (
      <span
        data-tone={line.outcome === "refused" ? "alarm" : undefined}
        data-outcome={line.outcome}
      >
        {line.outcome === "refused"
          ? `refused: ${line.reason ?? "no reason given"}`
          : `${line.from} → ${line.to}`}
      </span>
    ),
    detail: (
      <p>
        {line.outcome === "refused"
          ? `refused: ${line.reason ?? "no reason given"}`
          : `${line.from} → ${line.to}`}
      </p>
    ),
  }));

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
        write: { label: INBOX_LABELS.write, rows: [writeSpec, ...reviewSpecs], always: true },
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
      doc,
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
      diagnostic.kind,
      diagnostic.pick,
    ],
  );
  return (
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
  );
}
