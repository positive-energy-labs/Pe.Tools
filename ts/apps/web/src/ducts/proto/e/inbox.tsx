/**
 * THROWAWAY (protoui round 3, E2): the inbox, drawn like the Pea thread sidebar on kit `Row`s:
 * one row per ruling, grouped by kind under a head with its count. The trailing slot holds the
 * row's state; on hover the compact verbs take it (yes / no / not this, confirm, override, ignore,
 * select in Revit). Pressing a row opens it: the full prose and the worded verbs under it.
 *
 * A row exists only when a person has a verb on it: answer a claim, confirm an inferred join, enter
 * an override (no fan static, no terminal flow), or dismiss (the kinds canon gives a verdict).
 * Select in Revit rides every row but never makes one; issues with no verb stay pins on the
 * drawing. Issues are scoped by the group's `issueIds`, never by element membership.
 */
import { Fragment, useState, type CSSProperties } from "react";
import { Ban, Check, Crosshair, EyeOff, Link, Pencil, X, type LucideIcon } from "lucide-react";
import {
  ductOverrideKey,
  transitionPatches,
  type DuctFinding,
  type DuctsRouteDocument,
  type RouteStatePatch,
} from "@pe/agent-contracts";
import type { IssueKind } from "@pe/ducts-domain/issues";
import { INFERRED_KINDS } from "@pe/ducts-domain/proximity";
import type { DuctSnapshot } from "@pe/ducts-domain/types";
import { Button } from "@pe/kit/lang/button";
import { cellFromTrichotomy, StateCell } from "@pe/kit/lang/cell";
import { Row, RowGroupHead } from "@pe/kit/lang/row";
import { reviewTransitions, type CellWire } from "#/components/work/band";
import { callHostRpc } from "#/host/client";

import { AssumptionCell, verdictPatches as issueVerdictPatches } from "../../assumptions";
import { claimParts, ShowInRevit, VERDICTS, type Verdict } from "../../claims";
import { ISSUE_KINDS } from "../../issues";
import type { Claim } from "../../legs";

type Issue = DuctSnapshot["issues"][number];
export type InboxWork = {
  doc: DuctsRouteDocument | null;
  revision: number | null;
  write: (patch: RouteStatePatch[]) => Promise<unknown>;
};
type RevitDoc = { session: string; openId: string };

/** The issue kinds with a verb: an override to enter, or a canon verdict to dismiss with. */
const OVERRIDE: Partial<Record<IssueKind, "fan-static" | "flow">> = {
  "no-fan-static": "fan-static",
  "no-terminal-flow": "flow",
};
/** Mirrors the keys of CHOICES in assumptions.tsx (unexported there): the kinds a verdict answers. */
const DISMISS = new Set<IssueKind>(["open-end", "no-terminal-flow", "default-flex-roughness"]);
export const hasVerb = (issue: Issue) => issue.kind in OVERRIDE || DISMISS.has(issue.kind);

export type InboxRow =
  | { kind: "claim"; key: string; ids: readonly number[]; claim: Claim }
  | { kind: "join"; key: string; ids: readonly number[]; finding: DuctFinding }
  | { kind: "issue"; key: string; ids: readonly number[]; issue: Issue };

export function inboxRows({
  snapshot,
  group,
  scope,
  findings,
  claims,
}: {
  snapshot: DuctSnapshot;
  group: string;
  scope: ReadonlySet<number> | null;
  findings: readonly DuctFinding[];
  claims: readonly Claim[];
}): InboxRow[] {
  const inScope = (ids: readonly number[]) => !scope || ids.some((id) => scope.has(id));
  const owned = group
    ? new Set(snapshot.groups.find((g) => g.id === group)?.issueIds ?? [])
    : null;
  return [
    ...claims
      .filter((c) => inScope(c.at))
      .map((claim): InboxRow => ({ kind: "claim", key: claim.id, ids: claim.at, claim })),
    ...findings
      .filter((f) => INFERRED_KINDS.has(f.kind) && f.grade && inScope(f.elementIds))
      .map(
        (finding): InboxRow => ({ kind: "join", key: finding.id, ids: finding.elementIds, finding }),
      ),
    ...snapshot.issues
      .filter((i) => (!owned || owned.has(i.id)) && hasVerb(i))
      .map(
        (issue): InboxRow => ({
          kind: "issue",
          key: issue.id,
          ids: issue.elementId == null ? [] : [issue.elementId],
          issue,
        }),
      ),
  ];
}

/** The group a row sits under: claims, joins, then one group per issue kind. */
const groupOf = (row: InboxRow) =>
  row.kind === "claim"
    ? "Pea claims"
    : row.kind === "join"
      ? "inferred joins"
      : ISSUE_KINDS[row.issue.kind].label;

/** proto: copied from claims.tsx (`showElements`, unexported there). */
const showElements = (doc: RevitDoc, elementIds: readonly number[]) =>
  callHostRpc(
    "revit.context.show-elements",
    { elementIds: [...elementIds] },
    { bridgeSessionId: doc.session, openDocumentId: doc.openId },
  ).then(
    () => undefined,
    () => undefined,
  );

/** One compact verb: an icon square whose label is its tooltip. */
const Verb = ({
  icon,
  label,
  pressed,
  refusal,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  pressed?: boolean;
  refusal?: string | null;
  onClick?: () => void;
}) => (
  <Button icon={icon} label={label} pressed={pressed} refusal={refusal} onClick={onClick} />
);

/** The override for a no-fan-static or no-terminal-flow issue: empty until a person types one. */
function OverrideCell({ issue, work }: { issue: Issue; work: InboxWork }) {
  const what = OVERRIDE[issue.kind]!;
  const id = issue.elementId;
  if (id == null) return <span className="text-ink-mute">no element to hold an override</span>;
  const { segment, key, cell, shown } = overrideOf(issue, work.doc)!;
  const wire: CellWire = {
    segment,
    revision: work.revision,
    write: work.write as CellWire["write"],
  };
  return (
    <span className="inline-flex items-baseline gap-1" data-e-override={issue.id}>
      <StateCell
        {...cellFromTrichotomy(cell, { value: shown == null ? "" : String(shown), cap: "editable" })}
        scale="row"
        numeric={{ min: 0, digits: what === "flow" ? 0 : 4 }}
        placeholder={what === "flow" ? "design cfm" : "fan static"}
        onCommit={(text: string) =>
          (
            wire.write(
              transitionPatches([segment], key, cell, {
                kind: "stage",
                rung: {
                  value:
                    what === "flow"
                      ? { cfm: Number(text) }
                      : { kind: "fan-static", inWg: Number(text) },
                },
              }),
            ) as Promise<{ message?: string } | undefined>
          ).then((refused) => refused?.message)
        }
        transitions={reviewTransitions(wire, key, cell)}
      />
      <span className="t-small text-ink-2 whitespace-nowrap">{what === "flow" ? "cfm" : "in-wg"}</span>
    </span>
  );
}

/** Where an issue's override lives, and what is staged or proposed there. */
function overrideOf(issue: Issue, doc: DuctsRouteDocument | null) {
  const what = OVERRIDE[issue.kind];
  if (!what || issue.elementId == null) return null;
  const segment = what === "flow" ? "flows" : "assumptions";
  const key = what === "flow" ? String(issue.elementId) : ductOverrideKey("fan-static", issue.elementId);
  const cell = (what === "flow" ? doc?.flows[key] : doc?.assumptions[key]) ?? {};
  const authored = (cell.staged ?? cell.proposal)?.value as
    | { inWg?: number; cfm?: number }
    | undefined;
  const shown = what === "flow" ? authored?.cfm : authored?.inWg;
  return { segment, key, cell, shown, unit: what === "flow" ? "cfm" : "in-wg" };
}

const stagedVerdict = (doc: DuctsRouteDocument | null, id: string) => {
  const v = doc?.assumptions[id]?.staged?.value;
  return v?.kind === "verdict" ? v.verdict : null;
};

const GRADE_TONE = { anomalous: "alarm", stretched: "caution", "near-miss": undefined } as const;

export function Inbox({
  rows,
  work,
  doc,
  nameOf,
  onVerdict,
  light,
  onSelect,
}: {
  rows: readonly InboxRow[];
  work: InboxWork;
  doc: RevitDoc | null;
  nameOf: (id: number) => string;
  onVerdict: ((claim: Claim, verdict: Verdict) => void) | null;
  light: (ids: readonly number[] | null) => void;
  onSelect: (id: number | null) => void;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const names = (ids: readonly number[]) => [...new Set(ids.map(nameOf))].join(", ");
  /** A claim as one plain line: ids resolved to names, a name the prose already holds left out. */
  const claimLine = (claim: Claim) =>
    claimParts(claim.text, nameOf)
      .map((p) => (typeof p === "string" ? p : p.dot ? "" : p.name))
      .join("")
      .replace(/\s+/g, " ")
      .replace(/ ([,.;:?])/g, "$1");
  const groups = new Map<string, InboxRow[]>();
  for (const row of rows) groups.set(groupOf(row), [...(groups.get(groupOf(row)) ?? []), row]);

  const revit = (ids: readonly number[]) =>
    ids.length ? (
      <Verb
        icon={Crosshair}
        label="select in Revit"
        refusal={doc ? null : "no Revit document is connected"}
        onClick={() => doc && void showElements(doc, ids)}
      />
    ) : null;
  const confirmJoin = (key: string) => {
    const on = stagedVerdict(work.doc, key) === "connect";
    void work.write(
      transitionPatches(
        ["assumptions"],
        key,
        work.doc?.assumptions[key] ?? {},
        on
          ? { kind: "unstage" }
          : { kind: "stage", rung: { value: { kind: "verdict", verdict: "connect" } } },
      ),
    );
  };
  const ignoreIssue = (issue: Issue) =>
    void work.write(
      issueVerdictPatches(
        work.doc,
        issue.id,
        stagedVerdict(work.doc, issue.id) === "ignore" ? "unset" : "ignore",
      ),
    );

  const parts = (row: InboxRow) => {
    if (row.kind === "claim") {
      const v = row.claim.verdict;
      return {
        label: claimLine(row.claim),
        meta: v ? (VERDICTS.find((x) => x.value === v)?.word ?? v) : row.claim.state,
        actions: (
          <>
            {([Check, X, Ban] as const).map((icon, i) => {
              const verdict = VERDICTS[i]!;
              return (
                <Verb
                  key={verdict.value}
                  icon={icon}
                  label={`${verdict.word}: ${verdict.says}`}
                  pressed={v === verdict.value}
                  refusal={onVerdict ? null : "no subject: the verdict has nowhere to stage"}
                  onClick={() => onVerdict?.(row.claim, verdict.value)}
                />
              );
            })}
            {revit(row.ids)}
          </>
        ),
      };
    }
    if (row.kind === "join") {
      const on = stagedVerdict(work.doc, row.key) === "connect";
      return {
        label: names(row.ids),
        meta: (
          <span data-tone={on || !row.finding.grade ? undefined : GRADE_TONE[row.finding.grade]}>
            {on ? "confirmed" : row.finding.grade}
          </span>
        ),
        actions: (
          <>
            <Verb
              icon={Link}
              label={on ? "take the confirmation back" : "confirm this join"}
              pressed={on}
              onClick={() => confirmJoin(row.key)}
            />
            {revit(row.ids)}
          </>
        ),
      };
    }
    const issue = row.issue;
    const override = overrideOf(issue, work.doc);
    const verdict = stagedVerdict(work.doc, issue.id);
    return {
      label: row.ids.length ? names(row.ids) : "no element",
      meta:
        override?.shown != null
          ? `${override.shown} ${override.unit}`
          : verdict
            ? verdict
            : "open",
      actions: (
        <>
          {override ? (
            <Verb icon={Pencil} label="enter an override" onClick={() => setOpen(row.key)} />
          ) : null}
          {DISMISS.has(issue.kind) ? (
            <Verb
              icon={EyeOff}
              label={verdict === "ignore" ? "take the ignore back" : "ignore: leave it out of the walk"}
              pressed={verdict === "ignore"}
              onClick={() => ignoreIssue(issue)}
            />
          ) : null}
          {revit(row.ids)}
        </>
      ),
    };
  };

  /** The open row's child: its prose, then one line of worded verbs, both on the tree's first
   *  child indent and under its guide line (the kit's `data-depth` rule), so it reads as the row's. */
  const body = (row: InboxRow) => {
    const prose =
      row.kind === "claim" ? (
        <>
          <p>
            {claimParts(row.claim.text, nameOf).map((p, j) =>
              typeof p === "string" ? (
                <span key={j}>{p}</span>
              ) : p.dot ? (
                <span key={j} className="text-ink-2" title={p.name}>
                  ·
                </span>
              ) : (
                <span key={j} className="underline decoration-dotted">
                  {p.name}
                </span>
              ),
            )}
          </p>
          <p className="text-ink-2">Pea says this is {row.claim.state}</p>
        </>
      ) : row.kind === "join" ? (
        <p>{row.finding.note}</p>
      ) : (
        <>
          <p>{row.issue.note}</p>
          <p className="text-ink-2">{ISSUE_KINDS[row.issue.kind].what}</p>
        </>
      );
    const verbs =
      row.kind === "claim" ? (
        VERDICTS.map((v) => (
          <Button
            key={v.value}
            kind="framed"
            label={v.word}
            reason={v.says}
            pressed={row.claim.verdict === v.value}
            refusal={onVerdict ? null : "no subject: the verdict has nowhere to stage"}
            onClick={() => onVerdict?.(row.claim, v.value)}
          >
            {v.word}
          </Button>
        ))
      ) : row.kind === "join" ? (
        <Button
          kind="framed"
          label="confirm this join"
          pressed={stagedVerdict(work.doc, row.key) === "connect"}
          onClick={() => confirmJoin(row.key)}
        >
          {stagedVerdict(work.doc, row.key) === "connect" ? "confirmed" : "confirm"}
        </Button>
      ) : (
        <>
          {row.issue.kind in OVERRIDE ? <OverrideCell issue={row.issue} work={work} /> : null}
          {DISMISS.has(row.issue.kind) ? <AssumptionCell issue={row.issue} work={work} /> : null}
        </>
      );
    return (
      <div
        className="dl-row items-start! py-1 select-text!"
        data-depth={1}
        style={{ "--depth": 1 } as CSSProperties}
        data-e-inbox-body={row.key}
      >
        <span className="dl-row-twist" aria-hidden />
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          {prose}
          <div className="flex flex-wrap items-center gap-1" data-e-inbox-verbs="">
            {verbs}
            {row.ids.length ? (
              doc ? (
                <ShowInRevit doc={doc} elementIds={row.ids} what="it" />
              ) : (
                <Button kind="framed" label="select it in Revit" refusal="no Revit document is connected">
                  select in Revit
                </Button>
              )
            ) : null}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="flex flex-col" aria-label="inbox" onMouseLeave={() => light(null)}>
      {[...groups].map(([label, list]) => (
        <Fragment key={label}>
          <RowGroupHead label={label} count={list.length} />
          {list.map((row) => {
            const p = parts(row);
            const active = open === row.key;
            return (
              <Fragment key={row.key}>
                <Row
                  data-key={row.key}
                  active={active}
                  depth={0}
                  expanded={active}
                  onToggle={() => setOpen(active ? null : row.key)}
                  title={p.label}
                  label={<span data-e-inbox={row.kind}>{p.label}</span>}
                  meta={p.meta}
                  actions={p.actions}
                  onMouseEnter={() => light(row.ids)}
                  onClick={() => {
                    setOpen(active ? null : row.key);
                    onSelect(row.ids[0] ?? null);
                  }}
                />
                {active ? body(row) : null}
              </Fragment>
            );
          })}
        </Fragment>
      ))}
    </div>
  );
}
