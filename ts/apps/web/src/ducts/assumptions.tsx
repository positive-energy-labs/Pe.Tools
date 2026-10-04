/**
 * The verdict half of Work's `assumptions`: one issue id, one answer (capped, connect, ignore).
 * Numeric overrides are not staged here; the losses view owns them.
 */
import {
  transitionPatches,
  type DuctAssumption,
  type DuctsRouteDocument,
  type RouteStatePatch,
} from "@pe/agent-contracts";
import { Switcher } from "#/components/lang/switcher";
import { ISSUE_KINDS, type IssueKind } from "./issues";
import type { DuctSnapshot } from "./readiness";

type Issue = DuctSnapshot["issues"][number];
type Verdict = Extract<DuctAssumption, { kind: "verdict" }>["verdict"];
type Choice = Verdict | "unset";

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
          ? "needs an override value"
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
