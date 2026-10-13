/**
 * The launcher: one sentence that becomes one launch. Open [document] in Revit [year] on [a new
 * Revit | a running one], with the new Revit's shape as cells (payload fixed by this host,
 * posture and add-ins togglable), the refusal said before the press, and the exact commands
 * printed under it. The press runs the one `instances.open` or `instances.start` action
 * directly: pressing the verb is the consent, and nothing is staged first (ADR 0016).
 */
import { instancesActions, type Machine } from "@pe/agent-contracts";

import { ArtifactFrame } from "#/components/lang/artifact-frame";
import { Tag } from "#/components/lang/chip";
import { Button } from "#/components/lang/button";
import { ShapeCells } from "#/components/lang/process";
import { Switcher } from "#/components/lang/switcher";
import { executionRefusal, keyOf, nameOf, phaseOf, pidOf } from "#/machine/session";
import type { OpenHandle } from "#/open/manifest";
import { EMPTY_DRAFT, launchPlan, type DocRow, type LaunchDraft } from "#/open/model";
import { useAction } from "#/readings";
import { runSemanticAction } from "../../../../packages/mcps/src/shared/takeoff-action-client";

export function Launcher({
  handle,
  machine,
  rows,
  draft,
  setDraft,
  fixture,
}: {
  handle: OpenHandle;
  machine: Machine | null;
  rows: readonly DocRow[];
  draft: LaunchDraft;
  setDraft: (next: LaunchDraft) => void;
  fixture: boolean;
}) {
  const plan = launchPlan(draft, machine, rows);
  const years = machine?.revit.years ?? [];
  const isNew = draft.target === "new" || (draft.target === null && plan.target === null);
  const refusal =
    plan.refusal ?? (fixture ? "Fixture: nothing on this page reaches a host." : null);

  const launch = useAction(async () => {
    const planned = plan.launch;
    if (!planned) return;
    try {
      const receipt = await runSemanticAction(
        planned.key,
        instancesActions[planned.key].input.parse(planned.input),
        undefined,
        {},
        "human",
        "",
        crypto.randomUUID(),
        30_000,
      );
      handle.note(
        `${planned.key} ${receipt.state}`,
        `action ${receipt.id}`,
        receipt.state !== "succeeded",
        {
          kind: "receipt",
          id: receipt.id,
        },
      );
      setDraft(EMPTY_DRAFT);
    } catch (caught) {
      handle.note(`${planned.key} refused`, String(caught), true);
    }
  });

  return (
    <ArtifactFrame label="launcher">
      <div className="flex flex-col gap-1 px-3 py-2" aria-label="launcher">
        <div className="flex min-h-(--control-h) flex-wrap items-center gap-2">
          <span className="w-16 shrink-0">
            <Tag>open</Tag>
          </span>
          {plan.doc ? (
            <>
              <span className="font-semibold text-ink">{plan.doc.title}</span>
              <span className="min-w-0 max-w-[32rem] truncate face-mono text-ink-2">
                {plan.doc.path}
              </span>
              <Button label="clear" onClick={() => setDraft({ ...draft, doc: null })}>
                clear
              </Button>
            </>
          ) : (
            <span className="text-ink-2">
              No document. Pick one below, or start an empty Revit.
            </span>
          )}
        </div>
        <div className="flex min-h-(--control-h) flex-wrap items-center gap-2">
          <span className="w-16 shrink-0">
            <Tag>in revit</Tag>
          </span>
          <Switcher
            ariaLabel="Revit year"
            value={plan.year === null ? "" : String(plan.year)}
            onChange={(year) => setDraft({ ...draft, year: Number(year), target: null })}
            options={years.map((year) => ({
              value: String(year),
              label: <span className="face-mono">{year}</span>,
              title: `installed Revit ${year}`,
            }))}
          />
          <Tag>on</Tag>
          <Switcher
            ariaLabel="target Revit"
            value={draft.target ?? (plan.target ? keyOf(plan.target) : "new")}
            onChange={(target) => setDraft({ ...draft, target })}
            options={[
              { value: "new", label: "new Revit", title: `start a new Revit ${plan.year ?? ""}` },
              ...(draft.target && draft.target !== "new" && !plan.target
                ? [
                    {
                      value: draft.target,
                      label: `${draft.target} unavailable`,
                      title: "The selected Revit is unavailable; choose another target",
                      disabled: true,
                    },
                  ]
                : []),
              ...plan.live.map((session) => ({
                value: keyOf(session),
                label: (
                  <span className="face-mono">
                    {session.row.case === "observed-active" ? "icon" : session.row.id} ·{" "}
                    {pidOf(session.row)}
                  </span>
                ),
                title:
                  executionRefusal(session.row) ??
                  `${nameOf(session.row)} · ${phaseOf(session.row)}`,
                disabled:
                  executionRefusal(session.row) !== null || phaseOf(session.row) !== "ready",
              })),
            ]}
          />
          {isNew ? (
            <>
              <ShapeCells
                shape={{ payload: machine?.host?.payload ?? "installed" }}
                axes={["payload"]}
              />
              <Switcher
                ariaLabel="posture"
                value={draft.posture}
                onChange={(posture) => setDraft({ ...draft, posture })}
                options={[
                  { value: "foreground", label: "foreground", title: "a normal Revit window" },
                  { value: "background", label: "background", title: "no window brought forward" },
                ]}
              />
              <Switcher
                ariaLabel="add-ins"
                value={draft.quarantine ? "quarantine" : "on"}
                onChange={(value) => setDraft({ ...draft, quarantine: value === "quarantine" })}
                options={[
                  { value: "on", label: "add-ins on", title: "load every add-in" },
                  {
                    value: "quarantine",
                    label: "quarantine",
                    title: "third-party add-ins off for this Revit",
                  },
                ]}
              />
            </>
          ) : null}
          {plan.doc ? (
            <Switcher
              ariaLabel="missing linked files"
              value={draft.missingLinks}
              onChange={(missingLinks) => setDraft({ ...draft, missingLinks })}
              options={[
                {
                  value: "refuse",
                  label: "links: refuse",
                  title: "refuse to open if linked files are missing",
                },
                {
                  value: "allow",
                  label: "links: allow",
                  title: "open with missing links; omissions appear in the result",
                },
              ]}
            />
          ) : null}
          <span className="ml-auto">
            <Button
              kind="commit"
              label={plan.verb}
              reason={refusal ?? plan.argv.join("  then  ")}
              refusal={
                refusal !== null || plan.launch === null
                  ? (refusal ?? plan.argv.join("  then  "))
                  : null
              }
              busy={launch.isPending}
              onClick={() => launch.mutate(undefined)}
            >
              {plan.verb}
            </Button>
          </span>
        </div>
        {[plan.refusal, plan.caution].filter(Boolean).map((line) => (
          <p key={line} className="pl-18" data-tone="caution">
            {line}
          </p>
        ))}
        {plan.note ? <p className="pl-18 text-ink-2">{plan.note}</p> : null}
        <div className="pl-18 face-mono text-ink-2" title="what the host runs" data-argv>
          {plan.argv.map((line) => (
            <div key={line}>{line}</div>
          ))}
        </div>
      </div>
    </ArtifactFrame>
  );
}
