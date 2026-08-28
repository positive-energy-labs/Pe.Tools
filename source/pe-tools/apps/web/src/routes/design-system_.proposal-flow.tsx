/**
 * /design-system/proposal-flow — SATELLITE. What it stress-tests: **one cell grammar at two
 * scales, sharing one world.**
 *
 * Round 1 was won on the claim that pea's chat card, the table cells and the arming strip are the
 * same treatment scaled — and that claim was only ever demonstrated by resemblance: the proto drew
 * a card from one fixture and a table from another, side by side, and asked the eye to believe
 * they were connected. They were not connected by anything.
 *
 * Here they are. ONE `ProposalItem[]` in `useState` is behind both surfaces. Accepting in the card
 * moves the value in the table; denying puts it back; undo returns it to open; committing turns
 * every accepted value into a written one and drops a receipt. If the grammar is a mechanism
 * rather than a resemblance, this page shows it moving.
 *
 * FIXTURE, ANNOUNCED: the world is `design-system/fixtures.ts` — no host, no document, no element
 * behind any value. The dashed seam chip in the header is the reserved mark for exactly that.
 *
 * NO STAND-INS: the card is built from `lang/` primitives only. Where the card needs something `lang/`
 * does not have — a denied proposal, a current→proposed pair inside a table cell — there is a
 * `GAP:` at the call site and a visible gap-note, never a local component invented to cover it.
 */
import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Check, Save, Sparkles, Undo2, X } from "lucide-react";

import { ThemeToggle } from "#/components/ThemeToggle";
import { ArtifactFrame } from "#/components/lang/artifact-frame";
import { CellStateKey } from "#/components/lang/cell-key";
import { StateCell, type StateCellProps } from "#/components/lang/cell";
import { FactChip } from "#/components/lang/chip";
import { OutcomeLine } from "#/components/lang/outcome";
import { Section } from "#/components/lang/section";
import { Verb } from "#/components/lang/verb";
import { MasterTable } from "#/components/master-table/master-table";
import type { Column } from "#/components/master-table/model";
import { GapNote } from "#/design-system/gap-note";
import {
  PROPOSAL_SEED,
  PROPOSAL_TARGET,
  PROPOSAL_THREAD,
  type ProposalItem,
} from "#/design-system/fixtures";
import { cn } from "#/lib/utils";

export const Route = createFileRoute("/design-system_/proposal-flow")({
  component: ProposalFlow,
});

/* ── the one reader ──────────────────────────────────────────────────────────────────────────
   Card and table both render an item through THIS. That is the whole point of the page: two
   scales, one function, so they cannot disagree about what a value is. */

function itemCell(item: ProposalItem, committed: boolean): StateCellProps {
  const shown = item.review === "denied" ? (item.current ?? "—") : item.proposed;
  const drifts = item.modelValue != null && item.modelValue !== shown;
  return {
    value: shown,
    modelValue: item.modelValue,
    agree: drifts ? "drift" : "agree",
    fresh: "fresh",
    // committed ⇒ nothing is unsaved any more; open ⇒ pea proposes; accepted ⇒ pea staged it.
    stage: committed
      ? "clean"
      : item.review === "open"
        ? "proposed"
        : item.review === "accepted"
          ? "staged"
          : "clean",
    stagedBy: "pea",
    cap: "editable",
    confidence: item.review === "denied" ? undefined : item.confidence,
    // GAP (StateCell / the state model): a DENIED proposal has no representation. It carries no
    // reason and no author in the model, and the cell has no `denied` member — so the only honest
    // thing this surface can do is show the value pea did NOT change and say so in words on the
    // footline. A struck ghost would be a lie: the ghost token means "what the model holds".
    note: item.review === "denied" ? `denied — pea proposed ${item.proposed}` : item.note,
    grounding: item.grounding,
  };
}

function ProposalFlow() {
  const [items, setItems] = useState<readonly ProposalItem[]>(PROPOSAL_SEED);
  const [committed, setCommitted] = useState(false);

  const set = (key: string, review: ProposalItem["review"]) => {
    setCommitted(false);
    setItems((prev) => prev.map((i) => (i.key === key ? { ...i, review } : i)));
  };
  const reset = () => {
    setCommitted(false);
    setItems(PROPOSAL_SEED);
  };

  const open = items.filter((i) => i.review === "open").length;
  const accepted = items.filter((i) => i.review === "accepted").length;
  const denied = items.filter((i) => i.review === "denied").length;
  const attention = items.filter((i) => i.review !== "denied" && i.confidence === "low").length;

  return (
    <div className="min-h-screen bg-page text-[13px] text-ink">
      <Header
        title="proposal flow"
        note="one in-memory world, two scales — the card and the table are the same values"
      />

      <main className="page-wrap flex flex-col gap-10 pt-8 pb-24">
        <p className="max-w-[78ch] text-[12.5px] leading-relaxed text-ink-2">
          Accept, deny or undo anything in pea&apos;s card and watch the row below it move. Both
          surfaces render every value through one function, so the card cannot teach a mark the
          table does not draw. <strong className="font-normal text-ink">Connected Load</strong> is
          the crucible the design-lang round never forced: pea proposes a value <em>and</em> the
          model disagrees with what is on record — two marks on one cell, which precedence asserts
          and nothing had ever proven.
        </p>

        {/* ── scale 1 · pea's card, inline in the thread ───────────────────────────────── */}
        <Section
          index="01"
          label="scale one · pea's chat card"
          note="a machine-operated object carrying state — it keeps its frame"
        >
          <div className="max-w-168">
            {PROPOSAL_THREAD.map((m, i) => (
              <div key={i} className="flex gap-3 pb-2.5">
                <span
                  className={cn(
                    "w-8 shrink-0 pt-0.5 font-pe-mono text-[10px] tracking-[0.09em] uppercase",
                    m.who === "pea" ? "text-pea-ink" : "text-ink-2",
                  )}
                >
                  {m.who}
                </span>
                <p className="min-w-0 text-[12.5px] leading-relaxed">{m.text}</p>
              </div>
            ))}

            <ArtifactFrame
              className="mt-1"
              head={
                <>
                  <span className="tag">{PROPOSAL_TARGET}</span>
                  <FactChip tone="pea" title="Proposals pea is still waiting on you for.">
                    {open} open
                  </FactChip>
                  <FactChip tone="caution" title="Accepted but not yet written anywhere.">
                    {accepted} staged
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
                  <span className="tag">
                    {denied > 0 ? `${denied} denied · ` : ""}
                    {accepted} to write
                  </span>
                  <Verb
                    tone="commit"
                    label={`save ${accepted} to profile`}
                    icon={Save}
                    onClick={() => setCommitted(true)}
                    disabled={accepted === 0}
                    reason={
                      accepted === 0
                        ? "accept at least one proposal — nothing is staged to write"
                        : `Writes ${accepted} accepted values into the family profile`
                    }
                  />
                </>
              }
            >
              <div className="flex flex-col">
                {items.map((item) => (
                  <div
                    key={item.key}
                    className="grid grid-cols-1 items-baseline gap-x-4 gap-y-1 border-b border-line px-2.5 py-2 last:border-b-0 sm:grid-cols-[minmax(0,8rem)_minmax(0,1fr)_auto]"
                  >
                    <span className="truncate font-pe-mono text-[10.5px] text-ink-2">
                      {item.param}
                    </span>
                    <span className="flex min-w-0 max-w-full flex-wrap items-baseline gap-2">
                      {/* GAP (StateCell): the card knows the PRIOR value and the cell has no slot
                          for it — `current → proposed` is renderable in a chat card and physically
                          unrenderable in a table cell: the same fact is modelled twice, once
                          incompletely. Rendered here as plain page text
                          beside the cell rather than smuggled into `value`, so the two scales stay
                          honestly different where the model is honestly incomplete. */}
                      {item.review === "open" && item.current != null ? (
                        <span className="font-pe-mono text-[10.5px] text-ink-mute">
                          {item.current} →
                        </span>
                      ) : null}
                      <StateCell
                        {...itemCell(item, committed)}
                        className="block min-w-0 max-w-full"
                      />
                    </span>
                    <span className="flex shrink-0 items-center gap-1">
                      {item.review === "open" ? (
                        <>
                          <Verb
                            tone="agent"
                            label="accept"
                            icon={Check}
                            onClick={() => set(item.key, "accepted")}
                            reason="Stages pea's value — nothing is written until you commit"
                          />
                          <Verb
                            label="deny"
                            icon={X}
                            onClick={() => set(item.key, "denied")}
                            reason="Leaves the value as it is"
                          />
                        </>
                      ) : (
                        <Verb
                          label="undo"
                          icon={Undo2}
                          onClick={() => set(item.key, "open")}
                          reason="Puts the proposal back to open"
                        />
                      )}
                    </span>
                  </div>
                ))}
              </div>
            </ArtifactFrame>

            {committed ? (
              <div className="pt-2.5">
                <OutcomeLine
                  kind="receipt"
                  label={`${accepted} values written to profile`}
                  says="the staged squares are gone — nothing is unsaved"
                />
                <OutcomeLine
                  kind="advisory"
                  label={`${denied} denied · ${open} still open`}
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
              <span className="tag">
                {open} open · {accepted} accepted · {denied} denied
                {committed ? " · committed" : ""}
              </span>
            </div>
          </div>
        </Section>

        {/* ── scale 2 · the same world, in the real table ─────────────────────────────── */}
        <Section
          index="02"
          label="scale two · the same values, in the real table"
          note="the actual MasterTable — no second fixture, no second reader"
        >
          <ProposalTable items={items} committed={committed} />
        </Section>

        <section className="flex flex-col gap-1.5">
          <span className="t-caption t-upper text-ink">what this page found</span>
          <GapNote>
            a <strong>denied</strong> proposal has no representation in the language or the model:
            no reason, no author, no <code>denied</code> member on the cell. The card can only put
            the old value back and explain the denial in footline words — and the table row, which
            has no card next to it, reads as an ordinary clean value. A denial is currently
            invisible to anyone who was not watching.
          </GapNote>
          <GapNote>
            <strong>current → proposed</strong> lives beside the cell, not in it. The chat card
            knows the prior value; the table cell physically cannot show one. Until{" "}
            <code>StateCell</code> carries a prior, the two scales are the same grammar over
            different amounts of truth.
          </GapNote>
          <GapNote>
            every staged square on this page is <code>stagedBy=&quot;pea&quot;</code> because the
            fixture says so. In production the same square is inferred from <code>origin</code>,
            which is the author of the VALUE, not of the staging — so pea&apos;s square and yours
            are currently a guess — the strongest signal from the review.
          </GapNote>
          <GapNote>
            the receipt cannot name the write it reports. <code>OutcomeLine</code> carries no verb,
            target or item list, so &ldquo;{accepted} values written&rdquo; is a sentence this route
            assembled, not a fact the outcome holds.
          </GapNote>
        </section>
      </main>
    </div>
  );
}

function ProposalTable({
  items,
  committed,
}: {
  items: readonly ProposalItem[];
  committed: boolean;
}) {
  const columns = useMemo<Column<ProposalItem>[]>(
    () => [
      {
        key: "param",
        label: "parameter",
        width: "w-40",
        lock: true,
        sort: (r) => r.param,
        search: (r) => r.param,
        // GAP (MasterTable): `td` is `p-0`, `Column` has no cell-class hook — see /design-system §04.
        cell: (r) => <span className="block px-1.5 py-1">{r.param}</span>,
      },
      {
        key: "value",
        label: "value",
        search: (r) => r.proposed,
        cell: (r) => (
          <span className="block px-1.5 py-1">
            <StateCell {...itemCell(r, committed)} />
          </span>
        ),
      },
      {
        // GAP (MasterTable): the review state has to be modelled a second time as a string because
        // the table cannot read what the cell beside it drew.
        key: "review",
        label: "review",
        width: "w-24",
        facet: (r) => r.review,
        cell: (r) => (
          <span className="block px-1.5 py-1 font-pe-mono text-[10px] text-ink-mute">
            {committed && r.review === "accepted" ? "written" : r.review}
          </span>
        ),
      },
    ],
    [committed],
  );

  return (
    <ArtifactFrame
      className="max-w-184"
      head={
        <>
          <span className="tag">{PROPOSAL_TARGET} · under review</span>
          <FactChip dashed title="Fixture data — no host, no document, no element behind it.">
            fixture
          </FactChip>
        </>
      }
    >
      <div className="flex h-64 flex-col">
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
    <header className="sticky top-0 z-sticky border-b border-line bg-page/90 backdrop-blur">
      <div className="page-wrap flex items-center justify-between py-2.5">
        <div className="flex min-w-0 items-baseline gap-3">
          <Link to="/design-system" className="text-[11px] text-nav hover:underline">
            ← design system
          </Link>
          <span className="font-pe-display text-sm font-semibold tracking-tight">{title}</span>
          <span className="truncate text-[11px] text-ink-2">{note}</span>
          <FactChip dashed title="Everything on this page is fixture data — no host, no document.">
            fixture
          </FactChip>
        </div>
        <ThemeToggle />
      </div>
    </header>
  );
}
