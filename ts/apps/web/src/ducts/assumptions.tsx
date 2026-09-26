import { useState, useTransition } from "react";
import {
  transitionPatches,
  ductOverrideKey,
  type DuctAssumption,
  type DuctsRouteDocument,
  type DuctOverrideKind,
  type RouteStatePatch,
} from "@pe/agent-contracts";
import { Input } from "#/components/lang/input";
import { Press } from "#/components/lang/press";
import { Switcher } from "#/components/lang/switcher";
import { ISSUE_KINDS, type IssueKind } from "./issues";
import type { DuctSnapshot } from "./readiness";
type Issue = DuctSnapshot["issues"][number];
type Verdict = Extract<DuctAssumption, { kind: "verdict" }>["verdict"];
type Choice = Verdict | "unset";
export type AssumptionWork = {
  doc: DuctsRouteDocument | null;
  write: (patch: RouteStatePatch[]) => Promise<unknown>;
};

function NumericAssumption({
  kind,
  subject,
  work,
}: {
  kind: DuctOverrideKind;
  subject: string | number;
  work: AssumptionWork;
}) {
  const key = ductOverrideKey(kind, subject);
  const cell = work.doc?.assumptions[key] ?? {};
  const number = (value?: DuctAssumption) =>
    value?.kind === "flex-roughness"
      ? value.ft
      : value?.kind === "fan-static" || value?.kind === "component-drop"
        ? value.inWg
        : undefined;
  const staged = number(cell.staged?.value);
  const proposed = number(cell.proposal?.value);
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const text = draft ?? (staged == null ? "" : String(staged));
  const value = Number(text);
  const valid =
    text.trim() !== "" &&
    Number.isFinite(value) &&
    (kind === "flex-roughness" ? value > 0 : value >= 0);
  const commit = (unset: boolean) =>
    startTransition(async () => {
      setError(null);
      try {
        const result = await work.write(
          transitionPatches(
            ["assumptions"],
            key,
            cell,
            unset
              ? { kind: "unstage" }
              : {
                  kind: "stage",
                  rung: {
                    value: kind === "flex-roughness" ? { kind, ft: value } : { kind, inWg: value },
                  },
                },
          ),
        );
        if (result && typeof result === "object" && "message" in result)
          setError(String(result.message));
        else setDraft(null);
      } catch (e) {
        setError(String(e));
      }
    });
  return (
    <div className="flex flex-col gap-1" data-assumption={key}>
      <label htmlFor={key}>
        {kind} · {subject} · {kind === "flex-roughness" ? "ft" : "in-wg"}
      </label>
      <div className="flex items-center gap-1">
        <Input
          id={key}
          aria-label={key}
          type="number"
          step="any"
          min={0}
          value={text}
          face="mono"
          aria-invalid={text !== "" && !valid}
          disabled={pending}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && valid) commit(false);
          }}
        />
        <Press
          frame="line"
          size="caption"
          disabled={!valid || pending}
          onClick={() => commit(false)}
        >
          stage
        </Press>
        <Press
          frame="line"
          size="caption"
          disabled={staged == null || pending}
          onClick={() => commit(true)}
        >
          unset
        </Press>
      </div>
      <p className="text-ink-2">
        {staged == null ? "no staged override" : `staged: ${staged}`}
        {proposed != null ? ` · Pea proposed: ${proposed}` : ""}
      </p>
      {error ? (
        <p role="alert" data-tone="alarm">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function NumericAssumptions({
  snapshot,
  group,
  work,
}: {
  snapshot: DuctSnapshot;
  group: string;
  work: AssumptionWork;
}) {
  const roots = snapshot.groups.find((g) => g.id === group)?.rootIds ?? [];
  const families = [
    ...new Set(
      snapshot.nodes
        .filter(
          (n) =>
            (n.groupId === group || roots.includes(n.id)) &&
            ["equipment", "accessory", "terminal"].includes(n.kind),
        )
        .flatMap((n) => (n.family ? [n.family] : [])),
    ),
  ];
  const types = [
    ...new Set(
      snapshot.segments
        .filter((s) => s.groupId === group && s.kind === "flex")
        .flatMap((s) => (s.type ? [s.type] : [])),
    ),
  ];
  return (
    <div className="flex flex-col gap-2">
      <p>Staged assumptions · no Revit writes</p>
      <p className="text-ink-2">
        Component drops are external to the fan rating at design flow. Enter zero only when
        explicitly known.
      </p>
      {roots.map((id) => (
        <NumericAssumption key={`fan:${id}`} kind="fan-static" subject={id} work={work} />
      ))}
      {families.map((name) => (
        <NumericAssumption
          key={`component:${name}`}
          kind="component-drop"
          subject={name}
          work={work}
        />
      ))}
      {types.map((name) => (
        <NumericAssumption key={`flex:${name}`} kind="flex-roughness" subject={name} work={work} />
      ))}
    </div>
  );
}

/** The verdicts an issue kind can take: open ends all three; the rest that `ignore` resolves. */
const CHOICES: Partial<Record<IssueKind, readonly Verdict[]>> = {
  "open-end": ["capped", "connect", "ignore"],
  "no-terminal-flow": ["ignore"],
  "default-flex-roughness": ["ignore"],
};
const CHOICE_TITLE: Record<Choice, string> = {
  capped: "Capped: this end carries no flow. Resolves the open end.",
  connect: "Connect: the model must be fixed in Revit. Does not resolve the open end.",
  ignore: "Ignore: leave this out of the walk. Resolves it.",
  unset: "No staged answer.",
};

/** The patches one verdict choice makes on an issue's cell: stage it, or unstage for `unset`. */
export const verdictPatches = (
  doc: DuctsRouteDocument | null,
  issueId: string,
  choice: Choice,
): RouteStatePatch[] =>
  transitionPatches(
    ["assumptions"],
    issueId,
    doc?.assumptions[issueId] ?? {},
    choice === "unset"
      ? { kind: "unstage" }
      : { kind: "stage", rung: { value: { kind: "verdict", verdict: choice } } },
  );

const verdictAt = (value: DuctAssumption | undefined) =>
  value?.kind === "verdict" ? value.verdict : null;

/** The staged verdict of one issue, and its editor where a verdict can answer it. */
export function AssumptionCell({
  issue,
  work,
}: {
  issue: Issue;
  work: { doc: DuctsRouteDocument | null; write: (patch: RouteStatePatch[]) => Promise<unknown> };
}) {
  const cell = work.doc?.assumptions[issue.id];
  const staged = verdictAt(cell?.staged?.value);
  const proposed = verdictAt(cell?.proposal?.value);
  const choices = CHOICES[issue.kind];
  if (!choices) {
    const info = ISSUE_KINDS[issue.kind];
    return (
      <span className="text-ink-mute">
        {info.blocks === "budgetable"
          ? "numeric assumption editor"
          : info.blocks === "walkable"
            ? "needs a structural answer"
            : ""}
      </span>
    );
  }
  const options = [...choices, "unset" as const].map((value) => ({
    value,
    label: value,
    title: CHOICE_TITLE[value],
  }));
  return (
    <span className="flex flex-wrap items-center gap-1">
      <Switcher<Choice>
        ariaLabel={`assumption for ${issue.id}`}
        options={options}
        value={staged ?? "unset"}
        onChange={(choice) => void work.write(verdictPatches(work.doc, issue.id, choice))}
      />
      {proposed && proposed !== staged ? (
        <span data-tone="pea" title="Pea proposed this; choose it to stage it">
          Pea: {proposed}
        </span>
      ) : null}
    </span>
  );
}
