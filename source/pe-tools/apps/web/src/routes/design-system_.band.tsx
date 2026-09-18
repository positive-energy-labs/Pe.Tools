/** /design-system/band — one reducer-backed proposal fixture at route and chat-head scale. */
import { useMemo, useReducer } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Check, X } from "lucide-react";

import { ActionButton } from "#/components/lang/action-button";
import { ArtifactFrame } from "#/components/lang/artifact-frame";
import { ReviewRow, reviewTransitions, WorkBand } from "#/components/lang/band";
import { cellFromTrichotomy, StateCell } from "#/components/lang/cell";
import type { StateCellProps } from "#/components/lang/cell";
import { FactChip, Tag } from "#/components/lang/chip";
import { EmptyState } from "#/components/lang/empty";
import { OutcomeLine } from "#/components/lang/outcome";
import { Section } from "#/components/lang/section";
import { Switch } from "#/components/lang/switch";
import { ThemeToggle } from "#/components/lang/theme-toggle";
import { ReadCell } from "#/components/master-table/cells";
import { MasterTable } from "#/components/master-table/master-table";
import type { Column } from "#/components/master-table/model";
import { Gap } from "#/design-system/exhibit";
import type { PlanSheet } from "#/route/manifest";
import { Picker } from "#/route/picker";
import { PlanSheetView } from "#/route/plan-sheet";
import { SituationCell } from "#/route/situation";

export const Route = createFileRoute("/design-system_/band")({ component: BandRoute });

type Rung = { value?: string; delete?: true };
export type BandItem = {
  key: string;
  param: string;
  current: string | null;
  cap?: "editable" | "locked";
  capReason?: string;
  cell: {
    proposal: (Rung & { by: "pea" | "human"; confidence?: "high" | "low"; note?: string }) | null;
    staged: Rung | null;
  };
};

export const BAND_SEED: readonly BandItem[] = [
  {
    key: "neckWidth",
    param: "Neck Width",
    current: "8in",
    cell: {
      proposal: {
        value: "10in",
        by: "pea",
        confidence: "high",
        note: "matches 10x10 neck on schedule M-401",
      },
      staged: null,
    },
  },
  {
    key: "neckHeight",
    param: "Neck Height",
    current: "8in",
    cell: { proposal: { value: "10in", by: "pea" }, staged: { value: "10in" } },
  },
  {
    key: "throw",
    param: "Throw",
    current: "12ft",
    cell: { proposal: null, staged: { value: "15ft" } },
  },
  {
    key: "faceWidth",
    param: "Face Width",
    current: "Neck Width + 4in",
    cell: {
      proposal: { value: "Neck Width + 5in", by: "pea" },
      staged: { value: "Neck Width + 6in" },
    },
  },
  {
    key: "cfm",
    param: "CFM",
    current: "250",
    cap: "locked",
    capReason: "driven by a formula in the host project",
    cell: { proposal: null, staged: null },
  },
  {
    key: "airflowLabel",
    param: "Airflow Label",
    current: "CFM",
    cell: { proposal: { delete: true, by: "pea" }, staged: null },
  },
];

export type BandFixture = {
  items: readonly BandItem[];
  stage: string;
  askSurvives: boolean;
  askVisible: boolean;
  records: readonly string[];
  commitMode: "drill" | "sheet";
  draftMode: "today" | "authored";
  conflict: boolean;
  outcome: string | null;
};

export const INITIAL_BAND_FIXTURE: BandFixture = {
  items: BAND_SEED,
  stage: "audit",
  askSurvives: true,
  askVisible: true,
  records: [],
  commitMode: "drill",
  draftMode: "today",
  conflict: false,
  outcome: null,
};

export const PLAN_REFUSAL = "another writer changed this Work; plan is refused until you reload";
export const planRefusal = (fixture: BandFixture) => (fixture.conflict ? PLAN_REFUSAL : null);

type BandAction =
  | { type: "accept" | "deny" | "unstage"; key: string }
  | { type: "stage"; key: string; value: string }
  | { type: "discard" }
  | { type: "ask-event"; event: string }
  | { type: "resolve-ask"; verdict: "allowed" | "refused" }
  | { type: "set-stage"; value: string }
  | { type: "set-ask-survives"; value: boolean }
  | { type: "set-commit-mode"; value: BandFixture["commitMode"] }
  | { type: "set-draft-mode"; value: BandFixture["draftMode"] }
  | { type: "set-conflict"; value: boolean }
  | { type: "pea-writes" }
  | { type: "outcome"; value: string | null };

export function bandFixtureReducer(fixture: BandFixture, action: BandAction): BandFixture {
  const edit = (key: string, change: (item: BandItem) => BandItem) => ({
    ...fixture,
    outcome: null,
    items: fixture.items.map((item) => (item.key === key ? change(item) : item)),
  });
  switch (action.type) {
    case "accept":
      return edit(action.key, (item) => ({
        ...item,
        cell: {
          ...item.cell,
          staged: item.cell.proposal
            ? { value: item.cell.proposal.value, delete: item.cell.proposal.delete }
            : null,
        },
      }));
    case "deny":
      return edit(action.key, (item) => ({ ...item, cell: { ...item.cell, proposal: null } }));
    case "unstage":
      return edit(action.key, (item) => ({ ...item, cell: { ...item.cell, staged: null } }));
    case "stage":
      return edit(action.key, (item) => ({
        ...item,
        cell: { ...item.cell, staged: { value: action.value } },
      }));
    case "discard":
      return {
        ...fixture,
        outcome: "all staged edits un-staged",
        items: fixture.items.map((item) => ({
          ...item,
          cell: { ...item.cell, staged: null },
        })),
      };
    case "ask-event":
      return fixture.askSurvives
        ? fixture
        : {
            ...fixture,
            askVisible: false,
            records: [...fixture.records, `family.capture expired when ${action.event}`],
          };
    case "resolve-ask":
      return {
        ...fixture,
        askVisible: false,
        records: [...fixture.records, `family.capture ${action.verdict}`],
      };
    case "set-stage":
      return { ...fixture, stage: action.value };
    case "set-ask-survives":
      return { ...fixture, askSurvives: action.value };
    case "set-commit-mode":
      return { ...fixture, commitMode: action.value };
    case "set-draft-mode":
      return { ...fixture, draftMode: action.value };
    case "set-conflict":
      return { ...fixture, conflict: action.value, outcome: null };
    case "pea-writes":
      return {
        ...fixture,
        items: fixture.items.map((item) =>
          item.key === "neckWidth"
            ? { ...item, cell: { ...item.cell, proposal: { value: "12in", by: "pea" } } }
            : item.key === "throw"
              ? { ...item, cell: { ...item.cell, proposal: { value: "18ft", by: "pea" } } }
              : item,
        ),
      };
    case "outcome":
      return { ...fixture, outcome: action.value };
  }
}

const shown = (item: BandItem) => {
  const rung = item.cell.staged ?? item.cell.proposal;
  return rung?.delete ? "DELETE" : (rung?.value ?? item.current ?? "—");
};
const changed = (item: BandItem) => item.cell.proposal != null || item.cell.staged != null;

const facts = (item: BandItem, foot: "inline" | "hover"): StateCellProps => ({
  value: shown(item),
  fresh: "fresh",
  agree: "agree",
  cap: item.cap ?? "editable",
  capReason: item.capReason,
  foot,
});
const cellProps = (item: BandItem, foot: "inline" | "hover") =>
  cellFromTrichotomy(item.cell, facts(item, foot));

const PLAN_SHEET: PlanSheet = {
  entries: [
    {
      id: "PE_Supply Diffuser.rfa",
      name: "PE_Supply Diffuser.rfa",
      planHash: "simulated-r4",
      actions: 3,
      detail: "3 staged family parameter edits",
      flag: null,
      warnings: [],
    },
  ],
};

function BandRoute() {
  const [fixture, dispatch] = useReducer(bandFixtureReducer, INITIAL_BAND_FIXTURE);
  const draftItem: BandItem = {
    key: "sharedDraft",
    param: "Shared Draft",
    current: "20in",
    cell: {
      proposal: null,
      staged: fixture.draftMode === "authored" ? { value: "20in" } : null,
    },
  };
  const displayItems = [...fixture.items, draftItem];
  const staged = displayItems.filter((item) => item.cell.staged != null).length;
  const changedItems = displayItems.filter(changed);
  const chatItems =
    fixture.draftMode === "authored"
      ? [draftItem, ...changedItems.filter((item) => item.key !== draftItem.key)]
      : changedItems;
  const counter = displayItems.find((item) => cellProps(item, "hover").counterValue != null);
  const verbs = {
    onAccept: (key: string) => dispatch({ type: "accept", key }),
    onDeny: (key: string) => dispatch({ type: "deny", key }),
    onUnstage: (key: string) => dispatch({ type: "unstage", key }),
  };
  const refusal = planRefusal(fixture);

  const columns = useMemo<Column<BandItem>[]>(
    () => [
      {
        key: "parameter",
        label: "parameter",
        width: "w-40",
        lock: true,
        search: (item) => item.param,
        cell: (item) => <ReadCell value={item.param} />,
      },
      {
        key: "value",
        label: "value",
        search: shown,
        cell: (item) => (
          <StateCell
            {...cellProps(item, "hover")}
            scale="row"
            onCommit={
              item.cap === "locked"
                ? undefined
                : (value) => dispatch({ type: "stage", key: item.key, value })
            }
          />
        ),
      },
      {
        key: "review",
        label: "review",
        width: "w-44",
        cell: (item) =>
          changed(item) ? (
            <StateCell
              value=""
              scale="row"
              transitions={reviewTransitions("cells", item.key, item.cell, async (patches) => {
                const kind =
                  patches[0]!.path.at(-1) === "proposal"
                    ? "deny"
                    : "value" in (patches[0] ?? {})
                      ? "accept"
                      : "unstage";
                verbs[kind === "accept" ? "onAccept" : kind === "deny" ? "onDeny" : "onUnstage"](
                  item.key,
                );
                return null;
              })}
            />
          ) : (
            <ReadCell value="—" />
          ),
      },
    ],
    [fixture.items, fixture.draftMode],
  );

  const simulate = (label: string) => dispatch({ type: "outcome", value: `SIMULATED · ${label}` });
  const sheet = (
    <div className="hairline-t mt-1">
      <div className="px-2 py-1">
        <FactChip dashed title="Fixture plan; apply writes nothing.">
          SIMULATED
        </FactChip>
      </div>
      <PlanSheetView
        sheet={PLAN_SHEET}
        excluded={new Set()}
        included={PLAN_SHEET.entries}
        apply={() => simulate("apply 1 row")}
        cancel={() => simulate("confirmation cancelled")}
        replan={() => simulate("plan refreshed")}
        refusal={refusal}
        busy={false}
      />
    </div>
  );
  const work = (body?: React.ReactNode, visible?: boolean) => (
    <WorkBand
      count={staged}
      noun="edit"
      revision={4}
      read="14:02:11 · fresh"
      conflict={fixture.conflict}
      discard={() => dispatch({ type: "discard" })}
      commit={{
        label: "plan draft r4 · SIMULATED",
        reason: refusal ?? "Opens confirmation; this fixture never applies",
        disabled: refusal != null,
        run: () => simulate("opened /family confirmation"),
      }}
      unresolved={fixture.conflict ? [PLAN_REFUSAL] : []}
      reload={() => dispatch({ type: "set-conflict", value: false })}
      body={body}
      visible={visible}
    />
  );

  return (
    <div className="min-h-screen">
      <header className="sticky z-sticky">
        <div className="flex items-center justify-between py-2.5">
          <div className="flex min-w-0 items-baseline gap-3">
            <Link to="/design-system">← design system</Link>
            <span>band</span>
            <span>one proposal motif at route and chat-head scale</span>
            <FactChip dashed title="Fixture data only; no host or document is connected.">
              fixture
            </FactChip>
          </div>
          <ThemeToggle />
        </div>
      </header>

      <main className="flex flex-col gap-10 pt-8 pb-48">
        <p>
          Work is keyed by document, not thread: another thread on MEP Coordination.rvt shows these
          same proposals
        </p>
        <div className="grid gap-8 xl:grid-cols-2">
          <Section label="01 · route scale">
            <ArtifactFrame
              head={
                <div className="flex min-w-0 flex-1 items-center justify-between gap-4">
                  <h1 className="t-head face-display text-ink">Family</h1>
                  <Tag>Work r4 · fixture</Tag>
                </div>
              }
            >
              <div className="px-3 pt-2 pb-1">
                <p className="mb-1.5 t-prose text-ink-2">
                  <b>
                    <Picker
                      levels={[
                        {
                          key: "stage",
                          label: fixture.stage === "audit" ? "Auditing" : "Reviewing",
                          placeholder: "choose a stage",
                          options: [
                            { id: "audit", label: "Auditing" },
                            { id: "review", label: "Reviewing" },
                          ],
                          picked: (id) => id === fixture.stage,
                          pick: (value) => dispatch({ type: "set-stage", value }),
                        },
                      ]}
                    />
                  </b>{" "}
                  family <SituationCell io="rw">PE_Supply Diffuser</SituationCell> in{" "}
                  <SituationCell io="rw">MEP Coordination.rvt</SituationCell>
                </p>
                {work()}
                {fixture.commitMode === "sheet" ? sheet : null}
              </div>
            </ArtifactFrame>
            <div className="h-[25rem]">
              {changedItems.length ? (
                <MasterTable
                  rows={displayItems}
                  columns={columns}
                  rowKey={(item) => item.key}
                  scopeLabel="family parameters"
                  searchPlaceholder="search parameters…"
                />
              ) : (
                <EmptyState story="scope" exit="ask Pea or type in a cell">
                  no proposals
                </EmptyState>
              )}
            </div>
            {counter?.cell.proposal ? (
              <div className="hairline-t py-1.5 t-prose">
                <span className="t-small t-upper text-ink-mute">contested</span>{" "}
                <span>{counter.param}</span> · pea proposes{" "}
                <span className="face-mono">{counter.cell.proposal.value ?? "DELETE"}</span>
              </div>
            ) : null}
          </Section>

          <Section label="02 · chat-head scale">
            <ArtifactFrame
              head={
                <span className="flex items-baseline gap-2">
                  <b>Pea</b> in Diffuser resize on MEP Coordination.rvt
                </span>
              }
            >
              <div className="px-3 py-2">
                <p className="t-prose">
                  <b>Family</b> · PE_Supply Diffuser
                </p>
                {changedItems.length || fixture.askVisible
                  ? work(
                      <div className="max-h-[19rem] overflow-y-auto">
                        {fixture.askVisible ? (
                          <div className="hairline-t flex flex-wrap items-baseline gap-3 py-2">
                            <span className="face-mono text-ink">⌗ family.capture</span>
                            <span>on PE_Supply Diffuser</span>
                            <ActionButton
                              tone="commit"
                              icon={Check}
                              label="allow"
                              reason="Allow this transient tool call"
                              onClick={() => dispatch({ type: "resolve-ask", verdict: "allowed" })}
                            />
                            <ActionButton
                              icon={X}
                              label="refuse"
                              reason="Refuse this transient tool call"
                              onClick={() => dispatch({ type: "resolve-ask", verdict: "refused" })}
                            />
                          </div>
                        ) : null}
                        {chatItems.slice(0, 5).map((item) => (
                          <ReviewRow
                            key={item.key}
                            address={item.key}
                            label={item.param}
                            cell={item.cell}
                            facts={facts(item, "inline")}
                            segment="cells"
                            write={async (patches) => {
                              const p = patches[0]!;
                              if (p.path.at(-1) === "proposal") verbs.onDeny(item.key);
                              else if ("value" in p) verbs.onAccept(item.key);
                              else verbs.onUnstage(item.key);
                              return null;
                            }}
                          />
                        ))}
                        {chatItems.length > 5 ? (
                          <p>… and {chatItems.length - 5} more · open in /family</p>
                        ) : null}
                      </div>,
                      true,
                    )
                  : null}
                {fixture.commitMode === "sheet" ? sheet : null}
                <ActionButton
                  tone="nav"
                  direction="forward"
                  label="open in /family"
                  reason="Carry this thread to the same Work in Family"
                  onClick={() => simulate("/family")}
                />
              </div>
            </ArtifactFrame>
            <div className="hairline-t mt-2 py-2 t-prose" aria-label="Stub transcript">
              <span className="t-small t-upper text-ink-mute">transcript</span>
              {fixture.records.length ? (
                fixture.records.map((record, index) => (
                  <p key={index} className="face-mono text-ink-2">
                    {record}
                  </p>
                ))
              ) : (
                <p className="text-ink-mute">no ask record yet</p>
              )}
            </div>
          </Section>
        </div>

        {fixture.outcome ? (
          <OutcomeLine kind="advisory" label={fixture.outcome} says="fixture only" />
        ) : null}

        <section className="flex flex-col gap-1.5">
          <span>known gaps and owed work</span>
          {/* GAP (structural proposals): delete has a shape; rename and add-row do not. */}
          <Gap>
            <strong>GAP: structural proposals.</strong> Today&apos;s cell can draw delete. Rename
            and add-row have no language shape yet.
          </Gap>
          <p>
            <strong>Owed:</strong> <code>PlanSheetView</code> may move into <code>lang/</code>.
          </p>
        </section>
      </main>

      <aside className="fixed inset-x-4 bottom-4 z-overlay border-2 border-dashed border-line bg-ground p-3 shadow-xl">
        <div className="flex flex-wrap items-center gap-3 t-small">
          <b>SIMULATED · K1 ask lifecycle</b>
          {(["leave thread", "reload", "turn ends"] as const).map((event) => (
            <button
              key={event}
              type="button"
              className="border border-line px-2 py-1"
              onClick={() => dispatch({ type: "ask-event", event })}
            >
              {event}
            </button>
          ))}
          <span className="flex items-center gap-1.5">
            <Switch
              aria-label="ask expiry"
              checked={fixture.askSurvives}
              onCheckedChange={(value) => dispatch({ type: "set-ask-survives", value })}
            />
            ask {fixture.askSurvives ? "survives" : "expires"}
          </span>
          <b>K2</b>
          <button
            type="button"
            className="border border-line px-2 py-1"
            onClick={() => dispatch({ type: "pea-writes" })}
          >
            Pea writes again
          </button>
          <b>K3</b>
          <select
            value={fixture.commitMode}
            onChange={(event) =>
              dispatch({
                type: "set-commit-mode",
                value: event.target.value as BandFixture["commitMode"],
              })
            }
          >
            <option value="drill">drill-in to confirm</option>
            <option value="sheet">sheet inside the head</option>
          </select>
          <b>K4 D1 preview</b>
          <select
            value={fixture.draftMode}
            onChange={(event) =>
              dispatch({
                type: "set-draft-mode",
                value: event.target.value as BandFixture["draftMode"],
              })
            }
          >
            <option value="today">today · indistinguishable</option>
            <option value="authored">pea ink + unsaved square</option>
          </select>
          <span>
            Pea wrote this value directly; no proposal, no accept — today&apos;s
            Takeoffs/Instances/Parameter Links model.
          </span>
          <b>K5 conflict</b>
          <span className="flex items-center gap-1.5">
            <Switch
              aria-label="conflict"
              checked={fixture.conflict}
              onCheckedChange={(value) => dispatch({ type: "set-conflict", value })}
            />
            {fixture.conflict ? "on" : "off"}
          </span>
        </div>
      </aside>
    </div>
  );
}
