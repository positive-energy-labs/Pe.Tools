/**
 * /design-system/band — SATELLITE. One proposal fixture is rendered at route and chat-head scale.
 * SPECIMEN DATA: no host, document, persistence, plan, or apply sits behind this page.
 * SIMULATED controls are deliberately alien and do not record a K1-K4 verdict.
 */
import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Check, X } from "lucide-react";

import { ActionButton } from "#/components/lang/action-button";
import { ArtifactFrame } from "#/components/lang/artifact-frame";
import { WorkBand } from "#/components/lang/band";
import { cellFromTrichotomy, StateCell } from "#/components/lang/cell";
import type { StateCellProps } from "#/components/lang/cell";
import { FactChip, Tag } from "#/components/lang/chip";
import { EmptyState } from "#/components/lang/empty";
import { OutcomeLine } from "#/components/lang/outcome";
import { Section } from "#/components/lang/section";
import { ThemeToggle } from "#/components/lang/theme-toggle";
import { ReadCell } from "#/components/master-table/cells";
import { MasterTable } from "#/components/master-table/master-table";
import type { Column } from "#/components/master-table/model";
import { Gap } from "#/design-system/exhibit";
import { Picker } from "#/route/picker";
import { SituationCell } from "#/route/situation";

export const Route = createFileRoute("/design-system_/band")({ component: BandRoute });

type Rung = { value?: string; delete?: true };
type Item = {
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

const SEED: readonly Item[] = [
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

type Fixture = {
  items: readonly Item[];
  stage: string;
  askSurvives: boolean;
  askVisible: boolean;
  commitMode: "drill" | "sheet";
  draftMode: "today" | "authored";
  outcome: string | null;
};

const INITIAL: Fixture = {
  items: SEED,
  stage: "audit",
  askSurvives: true,
  askVisible: true,
  commitMode: "drill",
  draftMode: "today",
  outcome: null,
};

const shown = (item: Item) => {
  const rung = item.cell.staged ?? item.cell.proposal;
  return rung?.delete ? "DELETE" : (rung?.value ?? item.current ?? "—");
};
const open = (item: Item) => item.cell.proposal != null && item.cell.staged == null;
const contested = (item: Item) =>
  item.cell.proposal != null &&
  item.cell.staged != null &&
  (item.cell.proposal.value !== item.cell.staged.value ||
    item.cell.proposal.delete !== item.cell.staged.delete);
const changed = (item: Item) => item.cell.proposal != null || item.cell.staged != null;

function cellProps(item: Item, foot: "inline" | "hover"): StateCellProps {
  return cellFromTrichotomy(item.cell, {
    value: shown(item),
    fresh: "fresh",
    agree: "agree",
    cap: item.cap ?? "editable",
    capReason: item.capReason,
    foot,
  });
}

function BandRoute() {
  const [fixture, setFixture] = useState<Fixture>(INITIAL);
  const { items } = fixture;
  const draftItem: Item = {
    key: "sharedDraft",
    param: "Shared Draft",
    current: "20in",
    cell: {
      proposal: null,
      staged: fixture.draftMode === "authored" ? { value: "20in" } : null,
    },
  };
  const displayItems = [...items, draftItem];
  const staged = displayItems.filter((item) => item.cell.staged != null).length;
  const changedItems = displayItems.filter(changed);

  const edit = (key: string, change: (item: Item) => Item) =>
    setFixture((value) => ({
      ...value,
      outcome: null,
      items: value.items.map((item) => (item.key === key ? change(item) : item)),
    }));
  const accept = (key: string) =>
    edit(key, (item) => ({
      ...item,
      cell: { ...item.cell, staged: item.cell.proposal && { ...item.cell.proposal } },
    }));
  const deny = (key: string) =>
    edit(key, (item) => ({ ...item, cell: { ...item.cell, proposal: null } }));
  const type = (key: string, value: string) =>
    edit(key, (item) => ({ ...item, cell: { ...item.cell, staged: { value } } }));
  const discard = () =>
    setFixture((value) => ({
      ...value,
      outcome: "staged edits discarded",
      items: value.items.map((item) => ({ ...item, cell: { ...item.cell, staged: null } })),
    }));
  const plan = () =>
    setFixture((value) => ({
      ...value,
      outcome:
        value.commitMode === "drill"
          ? "SIMULATED · opened /family confirmation"
          : "SIMULATED · opened confirmation sheet inside the head",
    }));
  const askEvent = () =>
    setFixture((value) => ({ ...value, askVisible: value.askSurvives, outcome: null }));

  const columns = useMemo<Column<Item>[]>(
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
            onCommit={item.cap === "locked" ? undefined : (value) => type(item.key, value)}
          />
        ),
      },
      {
        key: "review",
        label: "review",
        width: "w-44",
        cell: (item) =>
          open(item) || contested(item) ? (
            <span className="flex gap-1">
              <ActionButton
                tone="agent"
                icon={Check}
                label="accept"
                reason="Stage Pea's proposal"
                onClick={() => accept(item.key)}
              />
              <ActionButton
                icon={X}
                label="deny"
                reason="Clear Pea's proposal"
                onClick={() => deny(item.key)}
              />
            </span>
          ) : (
            <ReadCell value="—" />
          ),
      },
    ],
    [items],
  );

  const work = (body?: React.ReactNode, visible?: boolean) => (
    <WorkBand
      count={staged}
      noun="edit"
      revision={4}
      read="14:02:11 · fresh"
      conflict
      discard={discard}
      commit={{
        label: "plan draft r4 · SIMULATED",
        reason: "Opens confirmation; this fixture never applies",
        run: plan,
      }}
      unresolved={["another writer changed this Work; your last write did not land"]}
      reload={() => setFixture((value) => ({ ...value, outcome: "SIMULATED · Work reloaded" }))}
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

      <main className="flex flex-col gap-10 pt-8 pb-40">
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
                          pick: (stage) => setFixture((value) => ({ ...value, stage })),
                        },
                      ]}
                    />
                  </b>{" "}
                  family <SituationCell io="rw">PE_Supply Diffuser</SituationCell> in{" "}
                  <SituationCell io="rw">MEP Coordination.rvt</SituationCell>
                </p>
                {work()}
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
                              onClick={() =>
                                setFixture((value) => ({ ...value, askVisible: false }))
                              }
                            />
                            <ActionButton
                              icon={X}
                              label="refuse"
                              reason="Refuse this transient tool call"
                              onClick={() =>
                                setFixture((value) => ({ ...value, askVisible: false }))
                              }
                            />
                          </div>
                        ) : null}
                        {changedItems.slice(0, 5).map((item) => (
                          <div
                            key={item.key}
                            className="grid grid-cols-[9rem_minmax(0,1fr)_auto] items-baseline gap-3 py-2"
                          >
                            <span>{item.param}</span>
                            <StateCell {...cellProps(item, "inline")} />
                            {open(item) || contested(item) ? (
                              <span className="flex gap-1">
                                <ActionButton
                                  tone="agent"
                                  icon={Check}
                                  label="accept"
                                  reason="Stage Pea's proposal"
                                  onClick={() => accept(item.key)}
                                />
                                <ActionButton
                                  icon={X}
                                  label="deny"
                                  reason="Clear Pea's proposal"
                                  onClick={() => deny(item.key)}
                                />
                              </span>
                            ) : null}
                          </div>
                        ))}
                        {changedItems.length > 5 ? (
                          <p>… and {changedItems.length - 5} more · open in /family</p>
                        ) : null}
                      </div>,
                      true,
                    )
                  : null}
                <ActionButton
                  tone="nav"
                  direction="forward"
                  label="open in /family"
                  reason="Carry this thread to the same Work in Family"
                  onClick={() =>
                    setFixture((value) => ({ ...value, outcome: "SIMULATED · /family" }))
                  }
                />
              </div>
            </ArtifactFrame>
          </Section>
        </div>

        {fixture.outcome ? (
          <OutcomeLine kind="advisory" label={fixture.outcome} says="fixture only" />
        ) : null}

        <section className="flex flex-col gap-1.5">
          <span>known gaps</span>
          {/* GAP (structural proposals): the cell grammar can draw delete, but add-row and rename
              have no shape. Do not substitute a route-local mark. */}
          <Gap>
            <strong>GAP: structural proposals.</strong> Today&apos;s cell can draw delete. Rename
            and add-row have no language shape yet.
          </Gap>
          {/* GAP (confirmation): the kit has no confirmation sheet that can be mounted here. */}
          <Gap>
            <strong>GAP: confirmation sheet.</strong> K3 changes the simulated outcome because the
            kit has no confirmation sheet to mount at either scale.
          </Gap>
        </section>
      </main>

      <aside className="fixed inset-x-4 bottom-4 z-overlay border-2 border-dashed border-line bg-ground p-3 shadow-xl">
        <div className="flex flex-wrap items-center gap-3 t-small">
          <b>SIMULATED · K1 ask lifecycle</b>
          {(["leave thread", "reload", "turn ends"] as const).map((label) => (
            <button
              key={label}
              type="button"
              className="border border-line px-2 py-1"
              onClick={askEvent}
            >
              {label}
            </button>
          ))}
          <label>
            <input
              type="checkbox"
              checked={fixture.askSurvives}
              onChange={(event) =>
                setFixture((value) => ({ ...value, askSurvives: event.target.checked }))
              }
            />{" "}
            ask {fixture.askSurvives ? "survives" : "expires"}
          </label>
          <b>K2</b>
          <button
            type="button"
            className="border border-line px-2 py-1"
            onClick={() =>
              setFixture((value) => ({
                ...value,
                items: value.items.map((item) =>
                  item.key === "neckWidth"
                    ? { ...item, cell: { ...item.cell, proposal: { value: "12in", by: "pea" } } }
                    : item.key === "throw"
                      ? { ...item, cell: { ...item.cell, proposal: { value: "18ft", by: "pea" } } }
                      : item,
                ),
              }))
            }
          >
            Pea writes again
          </button>
          <b>K3</b>
          <select
            value={fixture.commitMode}
            onChange={(event) =>
              setFixture((value) => ({
                ...value,
                commitMode: event.target.value as Fixture["commitMode"],
              }))
            }
          >
            <option value="drill">drill-in to confirm</option>
            <option value="sheet">sheet inside the head</option>
          </select>
          <b>K4 D1 preview</b>
          <select
            value={fixture.draftMode}
            onChange={(event) =>
              setFixture((value) => ({
                ...value,
                draftMode: event.target.value as Fixture["draftMode"],
              }))
            }
          >
            <option value="today">today · indistinguishable</option>
            <option value="authored">pea ink + unsaved square</option>
          </select>
        </div>
      </aside>
    </div>
  );
}
