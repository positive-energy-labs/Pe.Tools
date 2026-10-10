/**
 * The launcher: one sentence that becomes one launch. Open [document] in Revit [year] on [a new
 * Revit | a running one], with the new Revit's shape as cells (payload fixed by this host,
 * posture and add-ins togglable), the refusal said before the press, and the exact commands
 * printed under it. The press stages the launch on the instances Work, then runs the staged
 * value; a Pea proposal is reviewed above it and never launches by itself.
 */
import { useEffect } from "react";
import {
  instancesActions,
  nativeProcessSchema,
  sameValue,
  transitionPatches,
  type InstancesLaunch,
  type Machine,
} from "@pe/agent-contracts";

import { ActionButton } from "#/components/lang/action-button";
import { ArtifactFrame } from "#/components/lang/artifact-frame";
import { ReviewRow, type CellWire } from "#/components/lang/band";
import { Tag } from "#/components/lang/chip";
import { Input } from "#/components/lang/input";
import { Press } from "#/components/lang/press";
import { ShapeCells } from "#/components/lang/process";
import { Switcher } from "#/components/lang/switcher";
import { keyOf, nameOf, phaseOf, pidOf, processOf } from "#/machine/session";
import type { OpenHandle } from "#/open/manifest";
import { EMPTY_DRAFT, launchPlan, type DocRow, type LaunchDraft } from "#/open/model";
import { useAction } from "#/readings";
import { runSemanticAction } from "../../../../packages/mcps/src/shared/takeoff-action-client";

const describeLaunch = (value: unknown) => {
  const launch = value as InstancesLaunch;
  return launch.kind === "open"
    ? `open ${launch.document} in ${"id" in launch.session ? launch.session.id : `pid ${launch.session.pid}`}`
    : `start a new ${launch.year} Revit${launch.document ? ` opening ${launch.document}` : ""}${launch.quarantine ? " with add-ins quarantined" : ""}${launch.posture === "background" ? " in the background" : ""}`;
};

/** A staged launch, read back into the launcher's picks. */
function draftOf(launch: InstancesLaunch) {
  const doc = launch.document ?? null;
  if (launch.kind === "start")
    return {
      ...EMPTY_DRAFT,
      doc,
      year: Number(launch.year),
      target: "new",
      posture: launch.posture,
      quarantine: launch.quarantine,
      name: launch.name,
      missingLinks: launch.missingLinks,
    } satisfies LaunchDraft;
  return {
    ...EMPTY_DRAFT,
    doc,
    target: "pid" in launch.session ? `pid:${launch.session.pid}` : launch.session.id,
    missingLinks: launch.missingLinks,
  } satisfies LaunchDraft;
}

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
  const work = handle.work;
  const cell = work.doc?.launch ?? {};
  const staged = cell.staged?.value;
  const reviewing = cell.proposal != null && !sameValue(cell.proposal, cell.staged);
  const wire: CellWire = { segment: null, write: work.write, revision: work.revision };
  const stagedKey = JSON.stringify(staged ?? null);
  // A staged launch (a person's, or an accepted proposal) becomes the launcher's picks once.
  useEffect(() => {
    if (staged) setDraft(draftOf(staged));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- staged is identified by stagedKey
  }, [stagedKey]);
  const plan = launchPlan(draft, machine, rows);
  const years = machine?.revit.years ?? [];
  const isNew = draft.target === "new" || (draft.target === null && plan.target === null);
  const refusal =
    plan.refusal ??
    (fixture ? "Fixture: nothing on this page reaches a host." : null) ??
    (work.revision === null ? "Reading the instances Work first." : null);

  const launch = useAction(async () => {
    if (!plan.launch || work.revision === null) return;
    try {
      let revision = work.revision;
      if (JSON.stringify(staged ?? null) !== JSON.stringify(plan.launch)) {
        const refused = await work.write(
          transitionPatches([], "launch", {}, { kind: "stage", rung: { value: plan.launch } }),
          revision,
        );
        if (refused) throw Error(refused.message);
        revision += 1;
      }
      const key = plan.launch.kind === "start" ? "instances.start" : "instances.open";
      const process = plan.target ? processOf(plan.target.row) : null;
      const input = instancesActions[key].input.parse({
        workspaceId: work.key.work,
        ...(plan.launch.kind === "open" && process
          ? {
              session: {
                selection: plan.launch.session,
                process: nativeProcessSchema.parse(process),
              },
            }
          : {}),
      });
      const receipt = await runSemanticAction(
        key,
        input,
        undefined,
        { work: { key: work.key, revision } },
        "human",
        "",
        crypto.randomUUID(),
        30_000,
      );
      handle.note(
        `${plan.launch.kind} ${receipt.state}`,
        `action ${receipt.id}`,
        receipt.state !== "succeeded",
        {
          kind: "receipt",
          id: receipt.id,
        },
      );
      setDraft(EMPTY_DRAFT);
    } catch (caught) {
      handle.note(`${plan.launch.kind} refused`, String(caught), true);
    }
  });

  return (
    <ArtifactFrame label="launcher">
      <div className="flex flex-col gap-1 px-3 py-2" aria-label="launcher">
        {reviewing ? (
          <ReviewRow
            wire={wire}
            address="launch"
            label={<Tag>pea proposes</Tag>}
            cell={cell}
            facts={{
              value: describeLaunch(cell.staged?.value ?? cell.proposal?.value),
              scale: "row",
            }}
            show={describeLaunch}
          />
        ) : null}
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
              <Press tone="quiet" size="caption" onClick={() => setDraft({ ...draft, doc: null })}>
                clear
              </Press>
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
                title: `${nameOf(session.row)} · ${phaseOf(session.row)}`,
                disabled: phaseOf(session.row) !== "ready",
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
              <span className="w-44">
                <Input
                  face="mono"
                  aria-label="session name"
                  placeholder="name (optional)"
                  value={draft.name}
                  onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                />
              </span>
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
            <ActionButton
              tone="commit"
              label={plan.verb}
              reason={refusal ?? plan.argv.join("  then  ")}
              disabled={refusal !== null || plan.launch === null}
              busy={launch.isPending}
              onClick={() => launch.mutate(undefined)}
            />
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
