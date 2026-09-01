import { token } from "#/lib/token";
/**
 * /design-system/proposal-flow — SATELLITE. What it stress-tests: **one cell grammar at two
 * scales, sharing one world — and one proposal lifecycle behind both.**
 *
 * Round 1 was won on the claim that pea's chat card, the table cells and the arming strip are the
 * same treatment scaled — and that claim was only ever demonstrated by resemblance: the proto drew
 * a card from one fixture and a table from another, side by side, and asked the eye to believe
 * they were connected. They were not connected by anything.
 *
 * Here they are. ONE `ProposalItem[]` in `useState` is behind both surfaces, and every item holds
 * a TRICHOTOMY cell (`agent-contracts/src/trichotomy.ts`) read through the ONE reader,
 * `cellFromTrichotomy`. Accepting stages pea's value; denying CLEARS the proposal and the cell
 * shows the real value again (ruled 2026-08-31 — there is no `denied` state to draw); committing
 * redeems every staged value into `current` and clears the staging, which is what a `written`
 * state was trying to say.
 *
 * FIXTURE, ANNOUNCED: the world is `design-system/fixtures.ts` — no host, no document, no element
 * behind any value. The dashed seam chip in the header is the reserved mark for exactly that.
 *
 * NO STAND-INS: the card is built from `lang/` primitives only. Where the card needs something
 * `lang/` does not have — a current→proposed pair inside a table cell — there is a `GAP:` at the
 * call site and a visible gap-note, never a local component invented to cover it.
 */
import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Check, Save, Sparkles, Undo2, X } from "lucide-react";

import { ThemeToggle } from "#/components/lang/theme-toggle";
import { ArtifactFrame } from "#/components/lang/artifact-frame";
import { CellStateKey } from "#/components/lang/cell-key";
import { cellFromTrichotomy, cellStateLabel, StateCell } from "#/components/lang/cell";
import type { StateCellProps } from "#/components/lang/cell";
import { FactChip, Tag } from "#/components/lang/chip";
import { OutcomeLine } from "#/components/lang/outcome";
import { Section } from "#/components/lang/section";
import { Verb } from "#/components/lang/verb";
import { Gap } from "#/design-system/exhibit";
import { ReadCell } from "#/components/master-table/cells";
import { MasterTable } from "#/components/master-table/master-table";
import type { Column } from "#/components/master-table/model";
import {
  PROPOSAL_SEED,
  PROPOSAL_TARGET,
  PROPOSAL_THREAD,
  type ProposalItem,
} from "#/design-system/fixtures";

export const Route = createFileRoute("/design-system_/proposal-flow")({
  component: ProposalFlow,
});

/* ── the one reader ──────────────────────────────────────────────────────────────────────────
   Card and table both render an item through THIS, which is itself only a call to
   `cellFromTrichotomy` — the shared reader in `lang/cell-state.ts`. Two scales, one lifecycle,
   so nothing here can invent a mapping the rest of the app does not have. */

/** What the cell shows: the staged value, else the proposal, else what the document holds. */
function shownValue(item: ProposalItem): string {
  return item.cell.staged?.value ?? item.cell.proposal?.value ?? item.current ?? "—";
}

/** A proposal nobody has acted on yet — the only state that offers accept/deny. */
function isOpen(item: ProposalItem): boolean {
  return item.cell.proposal != null && item.cell.staged == null;
}

function itemCell(item: ProposalItem, foot: "inline" | "hover"): StateCellProps {
  const shown = shownValue(item);
  return cellFromTrichotomy(item.cell, {
    value: shown,
    modelValue: item.modelValue,
    agree: item.modelValue != null && item.modelValue !== shown ? "drift" : "agree",
    fresh: "fresh",
    cap: "editable",
    grounding: item.grounding,
    foot,
  });
}

function ProposalFlow() {
  const [items, setItems] = useState<readonly ProposalItem[]>(PROPOSAL_SEED);
  const [receipt, setReceipt] = useState<number | null>(null);

  const open = items.filter(isOpen).length;
  const staged = items.filter((i) => i.cell.staged != null).length;
  const attention = items.filter((i) => i.cell.review === "attention").length;

  /* The three moves ARE the machine's moves — no route-local verdict enum sits between them and
     the cell. Accept promotes the proposal into `staged`; deny CLEARS the proposal; undo puts the
     fixture's cell back. */
  const edit = (key: string, next: (item: ProposalItem) => ProposalItem) => {
    setReceipt(null);
    setItems((prev) => prev.map((i) => (i.key === key ? next(i) : i)));
  };
  const accept = (key: string) =>
    edit(key, (i) =>
      i.cell.proposal == null
        ? i
        : { ...i, cell: { ...i.cell, staged: { value: i.cell.proposal.value } } },
    );
  const deny = (key: string) => edit(key, (i) => ({ ...i, cell: { ...i.cell, proposal: null } }));
  const undo = (key: string) =>
    edit(key, (i) => ({ ...i, cell: PROPOSAL_SEED.find((s) => s.key === key)!.cell }));

  /* Commit redeems the staged set against the outside world: the staged value becomes what the
     document holds and the staging is cleared. There is no `written` state — the cell is simply
     clean, holding the new value. */
  const commit = () => {
    setReceipt(staged);
    setItems((prev) =>
      prev.map((i) =>
        i.cell.staged == null
          ? i
          : {
              ...i,
              current: i.cell.staged.value,
              cell: { ...i.cell, proposal: null, staged: null },
            },
      ),
    );
  };
  const reset = () => {
    setReceipt(null);
    setItems(PROPOSAL_SEED);
  };

  return (
    <div className="min-h-screen">
      <Header
        title="proposal flow"
        note="one in-memory world, two scales — the card and the table are the same values"
      />

      <main className="flex flex-col gap-10 pt-8 pb-24">
        <p className="max-w-[78ch]">
          Accept, deny or undo anything in pea&apos;s card and watch the row below it move. Both
          surfaces render every value through one reader over one lifecycle, so the card cannot
          teach a mark the table does not draw. <strong>Connected Load</strong> is the crucible the
          design-lang round never forced: pea proposes a value <em>and</em> the model disagrees with
          what is on record — two marks on one cell, which precedence asserts and nothing had ever
          proven. A <strong>denial</strong> draws nothing at all: it clears the proposal and the
          cell goes back to showing the real value.
        </p>

        {/* ── scale 1 · pea's card, inline in the thread ───────────────────────────────── */}
        <Section label="01 · scale one · pea's chat card">
          <p>a machine-operated object carrying state — it keeps its frame</p>
          <div className="max-w-[42rem]">
            {PROPOSAL_THREAD.map((m, i) => (
              <div key={i} className="flex gap-3 pb-2.5">
                <span
                  className="w-8 pt-0.5"
                  style={{ color: m.who === "pea" ? token("pea-ink") : token("ink-2") }}
                >
                  {m.who}
                </span>
                <p className="min-w-0">{m.text}</p>
              </div>
            ))}

            <ArtifactFrame
              head={
                <>
                  <Tag>{PROPOSAL_TARGET}</Tag>
                  <FactChip tone="pea" title="Proposals pea is still waiting on you for.">
                    {open} open
                  </FactChip>
                  <FactChip tone="caution" title="Staged but not yet written anywhere.">
                    {staged} staged
                  </FactChip>
                  {attention > 0 ? (
                    <FactChip
                      tone="alarm"
                      title="Low-confidence values pea wants a person to check."
                    >
                      {attention} needs a person
                    </FactChip>
                  ) : null}
                </>
              }
              foot={
                <>
                  <Tag>{staged} to write</Tag>
                  <Verb
                    tone="commit"
                    label={`save ${staged} to profile`}
                    icon={Save}
                    onClick={commit}
                    disabled={staged === 0}
                    reason={
                      staged === 0
                        ? "accept at least one proposal — nothing is staged to write"
                        : `Writes ${staged} staged values into the family profile`
                    }
                  />
                </>
              }
            >
              <div className="flex flex-col">
                {items.map((item) => (
                  <div
                    key={item.key}
                    className="grid grid-cols-[minmax(0,8rem)_minmax(0,1fr)_auto] items-baseline gap-x-4 gap-y-1 px-2.5 py-2"
                  >
                    <span>{item.param}</span>
                    <span className="flex min-w-0 flex-wrap items-baseline gap-2">
                      {/* GAP (StateCell): the card knows the PRIOR value and the cell has no slot
                          for it — `current → proposed` is renderable in a chat card and physically
                          unrenderable in a table cell: the same fact is modelled twice, once
                          incompletely. Rendered here as plain page text
                          beside the cell rather than smuggled into `value`, so the two scales stay
                          honestly different where the model is honestly incomplete. */}
                      {isOpen(item) && item.current != null ? <span>{item.current} →</span> : null}
                      <StateCell {...itemCell(item, "inline")} />
                    </span>
                    <span className="flex items-center gap-1">
                      {isOpen(item) ? (
                        <>
                          <Verb
                            tone="agent"
                            label="accept"
                            icon={Check}
                            onClick={() => accept(item.key)}
                            reason="Stages pea's value — nothing is written until you commit"
                          />
                          <Verb
                            label="deny"
                            icon={X}
                            onClick={() => deny(item.key)}
                            reason="Clears the proposal — the value goes back to what is on record"
                          />
                        </>
                      ) : (
                        <Verb
                          label="undo"
                          icon={Undo2}
                          onClick={() => undo(item.key)}
                          reason="Puts pea's proposal back the way it came"
                        />
                      )}
                    </span>
                  </div>
                ))}
              </div>
            </ArtifactFrame>

            {receipt != null ? (
              <div className="pt-2.5">
                <OutcomeLine
                  kind="receipt"
                  label={`${receipt} values written to profile`}
                  says="the staged squares are gone — nothing is unsaved"
                />
                <OutcomeLine
                  kind="advisory"
                  label={`${open} still open`}
                  says="a denial writes nothing and leaves nothing behind"
                />
              </div>
            ) : null}

            <div className="flex items-center gap-2 pt-2">
              <Verb
                label="reset the world"
                icon={Sparkles}
                onClick={reset}
                reason="Puts every proposal back to its fixture state"
              />
              <Tag>
                {open} open · {staged} staged
                {receipt != null ? ` · ${receipt} written` : ""}
              </Tag>
            </div>
          </div>
        </Section>

        {/* ── scale 2 · the same world, in the real table ─────────────────────────────── */}
        <Section label="02 · scale two · the same values, in the real table">
          <p>the actual MasterTable — no second fixture, no second reader</p>
          <ProposalTable items={items} />
        </Section>

        <section className="flex flex-col gap-1.5">
          <span>what this page found</span>
          <Gap>
            <strong>current → proposed</strong> lives beside the cell, not in it. The chat card
            knows the prior value; the table cell physically cannot show one. Until{" "}
            <code>StateCell</code> carries a prior, the two scales are the same grammar over
            different amounts of truth.
          </Gap>
          <Gap>
            the receipt cannot name the write it reports. <code>OutcomeLine</code> carries no verb,
            target or item list, so &ldquo;{receipt ?? 0} values written&rdquo; is a sentence this
            route assembled, not a fact the outcome holds.
          </Gap>
        </section>
      </main>
    </div>
  );
}

function ProposalTable({ items }: { items: readonly ProposalItem[] }) {
  const columns = useMemo<Column<ProposalItem>[]>(
    () => [
      {
        key: "param",
        label: "parameter",
        width: "w-40",
        lock: true,
        sort: (r) => r.param,
        search: (r) => r.param,
        cell: (r) => <ReadCell value={r.param} />,
      },
      {
        key: "value",
        label: "value",
        search: (r) => shownValue(r),
        // ROW SCALE, like every other table in the app (critic verdict row 5): rendering the
        // card scale inside a `td` gave this page — the executable authority — a 4px vertical
        // inset no route draws. Row scale already collapses the footline to the title, which is
        // what `foot: "hover"` means one scale up.
        cell: (r) => <StateCell {...itemCell(r, "hover")} scale="row" />,
      },
      {
        // The state word is `cellStateLabel` over the same props the cell renders — not a second
        // model of the review. What the table facets is exactly what the cell drew.
        key: "state",
        label: "state",
        width: "w-24",
        facet: (r) => cellStateLabel(itemCell(r, "hover")),
        cell: (r) => <ReadCell value={cellStateLabel(itemCell(r, "hover"))} />,
      },
    ],
    [],
  );

  return (
    <ArtifactFrame
      head={
        <>
          <Tag>{PROPOSAL_TARGET} · under review</Tag>
          <FactChip dashed title="Fixture data — no host, no document, no element behind it.">
            fixture
          </FactChip>
        </>
      }
    >
      <div className="flex h-[16rem] flex-col">
        <MasterTable
          rows={items}
          columns={columns}
          rowKey={(r) => r.key}
          scopeLabel="proposals in scope"
          searchPlaceholder="search…"
        />
      </div>
      <CellStateKey />
    </ArtifactFrame>
  );
}

/* ── shared satellite chrome ─────────────────────────────────────────────────────────────── */

function Header({ title, note }: { title: string; note: string }) {
  return (
    <header className="sticky z-sticky">
      <div className="flex items-center justify-between py-2.5">
        <div className="flex min-w-0 items-baseline gap-3">
          <Link to="/design-system">← design system</Link>
          <span>{title}</span>
          <span>{note}</span>
          <FactChip dashed title="Everything on this page is fixture data — no host, no document.">
            fixture
          </FactChip>
        </div>
        <ThemeToggle />
      </div>
    </header>
  );
}
