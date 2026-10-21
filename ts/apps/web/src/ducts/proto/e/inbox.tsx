/**
 * THROWAWAY (protoui round 3, E2): the inbox in loop order on the kit `Inbox`: Fix, Set, Check,
 * Write, then the collapsed Diagnostics. The rows are `inbox-rows.ts`' (pure, tested); this draws
 * them. A row reads its title and status at rest and takes its verbs on hover; pressing it opens
 * the prose and the worded verbs under it. Inputs are never edited here: a Set row's verb selects
 * the element and focuses the cell on its tree row.
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
import {
  transitionPatches,
  type DuctsRouteDocument,
  type RouteStatePatch,
} from "@pe/agent-contracts";
import { Button } from "@pe/kit/lang/button";
import { EmptyState } from "@pe/kit/lang/empty";
import { Inbox as KitInbox, type InboxRowSpec } from "@pe/kit/lang/inbox";
import { reviewTransitions, type CellWire } from "#/components/work/band";
import type { ActionHandle } from "#/route/handle";

import { verdictPatches } from "../../assumptions";
import {
  ClaimElement,
  claimParts,
  ShowInRevit,
  showElements,
  VERDICTS,
  type Verdict,
} from "../../claims";
import {
  INBOX_LABELS,
  INBOX_ORDER,
  type CellRef,
  type InboxGroup,
  type InboxItem,
  type RowVerb,
  type WriteRow,
} from "../../inbox-rows";
import type { Claim } from "../../legs";

type RevitDoc = { session: string; openId: string };
export type InboxWork = {
  doc: DuctsRouteDocument | null;
  revision: number | null;
  write: (patch: RouteStatePatch[]) => Promise<unknown>;
};

/** The Write group's verbs: the route's own preview and apply, as the handle refuses or arms them. */
export interface WriteVerbs {
  preview: ActionHandle;
  apply: ActionHandle;
  busy: boolean;
  row: WriteRow;
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
            void work.write(verdictPatches(work.doc, verb.key, verb.on ? "unset" : verb.verdict)),
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
              transitionPatches(["roles"], String(verb.id), cellOf("roles", String(verb.id)), {
                kind: "stage",
                rung: { value: { role: verb.role } },
              }),
            ),
        );
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
            {item.ids.length && doc ? (
              <ShowInRevit doc={doc} elementIds={item.ids} what="it" />
            ) : null}
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
        <Button
          kind="framed"
          label="preview"
          reason="Ask Revit what the staged cells would write"
          refusal={write.preview.refusal}
          busy={write.busy}
          onClick={() => void write.preview.run()}
        >
          preview
        </Button>
        <Button
          kind="commit"
          label="write to Revit"
          reason="Write the staged cells to Revit"
          refusal={write.row.blocked ?? write.apply.refusal}
          busy={write.busy}
          onClick={() => void write.apply.run()}
        >
          write
        </Button>
      </span>
    ),
    detail:
      write.row.blocked || write.apply.refusal ? (
        <p data-inbox-write-says="">{write.row.blocked ?? write.apply.refusal}</p>
      ) : undefined,
  };

  const specs = useMemo(
    () =>
      ({
        fix: { label: INBOX_LABELS.fix, rows: groups.fix.map(spec) },
        set: { label: INBOX_LABELS.set, rows: groups.set.map(spec) },
        check: { label: INBOX_LABELS.check, rows: groups.check.map(spec) },
        write: { label: INBOX_LABELS.write, rows: [writeSpec], always: true },
        diagnostics: {
          label: INBOX_LABELS.diagnostics,
          rows: groups.diagnostics.map(spec),
          collapsible: true,
          defaultCollapsed: true,
        },
      }) satisfies Record<InboxGroup, unknown>,
    // eslint-disable-next-line react-hooks/exhaustive-deps -- spec closes over props that change with them
    [
      groups,
      work.doc,
      work.revision,
      doc,
      write.row,
      write.preview.refusal,
      write.apply.refusal,
      write.busy,
      heal.busy,
      onVerdict,
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
