/**
 * /design-system/arming — SATELLITE. What it stress-tests: **a lifecycle, not a specimen.**
 *
 * `ArmingStrip` is the ceremony surface SURFACE-PHILOSOPHY §3 has been owed since the honesty
 * rules were written, and it is the one component in `lang/` with NO live consumer. Every
 * previous look at it was a frozen frame: the design-lang fixture rendered "armed" and
 * "refused" and nothing else, which is precisely why round 1 recorded "arming has no lifecycle"
 * as a state-model gap rather than as a rendering one. A component whose whole argument is a
 * sequence cannot be reviewed one frame at a time.
 *
 * So this page does both, deliberately. The three phases stand side by side as frozen frames —
 * because a lifecycle you must perform to see is a lifecycle nobody reviews — and one live
 * instance runs the real sequence: type a reason to arm it, commit, take a drift refusal, re-plan
 * against a fresh hash, commit again for a receipt.
 *
 * SPECIMEN DATA, ANNOUNCED: `design-system/specimens-data.ts`. No host, no plan, no model. The refusal is
 * simulated on the first commit because that is the case the ceremony exists for; nothing here
 * asks Revit anything.
 *
 * NO STAND-INS: the strip is mounted with its real props. Everything it cannot say — how old its plan
 * is, who armed it, which verb it arms — is a `GAP:` note, not a prop this page invented.
 */
import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";

import { ThemeToggle } from "#/components/lang/theme-toggle";
import { ArmingStrip } from "#/components/lang/arming-strip";
import { FactChip, Tag } from "#/components/lang/chip";
import { OutcomeLine } from "#/components/lang/outcome";
import { Section } from "#/components/lang/section";
import { ActionButton } from "#/components/lang/action-button";
import { Gap } from "#/design-system/exhibit";
import { ARMING_SPECIMEN } from "#/design-system/specimens-data";

export const Route = createFileRoute("/design-system_/arming")({ component: ArmingRoute });

const noop = () => {};

/** The live instance's own phase. `armed` is not stored — the strip derives it from the reason,
 *  which is the ruling: arming is driven by supplying the reason, so there is no separate "arm"
 *  press to forget. */
/* `landed` NOT `written`: the cell grammar rules that no proposal state is called `written`
 * (ledger 2026-08-31), and a literal `written` phase in the executable design authority would be
 * read as that state. This is the arming ceremony's own phase — the write went through. */
type Phase = "arming" | "refused" | "landed";

function ArmingRoute() {
  const [reason, setReason] = useState("");
  const [phase, setPhase] = useState<Phase>("arming");
  /** Whether the plan has been re-made since the refusal. Drives which hash the strip cites. */
  const [replanned, setReplanned] = useState(false);

  const planHash = replanned ? ARMING_SPECIMEN.freshPlanHash : ARMING_SPECIMEN.planHash;

  const commit = () => {
    // The first commit refuses — that IS the case the ceremony exists for. After a re-plan the
    // same press lands, so the receipt and the refusal are reachable from the same button.
    setPhase(replanned ? "landed" : "refused");
  };
  const replan = () => {
    setReplanned(true);
    setPhase("arming");
  };
  const reset = () => {
    setReason("");
    setPhase("arming");
    setReplanned(false);
  };

  return (
    <div className="min-h-screen">
      <Header
        title="arming"
        note="unarmed → armed → refused → re-plan, driven live and frozen side by side"
      />

      <main className="flex flex-col gap-10 pt-8 pb-24">
        <p className="max-w-[78ch]">
          The strip is the cell grammar at its largest scale: a tinted ground plus one edge, inside
          the artifact frame it draws itself. Round 1 found that only this treatment read as{" "}
          <em>ceremony</em> rather than as another component, and attributed it to border scarcity.
          The colour is the phase and nothing else — no ceremony colour until it is armed, the one
          filled blue when it is, the one alarm when the model refuses it.
        </p>

        {/* ── live ─────────────────────────────────────────────────────────────────────── */}
        <Section label="01 · live">
          <p>
            type a reason to arm it · the first commit takes a drift refusal · re-plan, then commit
            again
          </p>
          <div className="max-w-[44rem] flex flex-col gap-2.5">
            {phase === "landed" ? (
              <>
                <OutcomeLine
                  kind="receipt"
                  label={`${ARMING_SPECIMEN.count} parameters written`}
                  says={`against plan ${planHash}`}
                />
                <div className="flex items-center gap-2">
                  <ActionButton
                    label="arm another write"
                    onClick={reset}
                    reason="Puts the strip back to unarmed with the original plan"
                  />
                  <Tag>the receipt is plain content — never framed</Tag>
                </div>
              </>
            ) : (
              <ArmingStrip
                verb={ARMING_SPECIMEN.verb}
                target={ARMING_SPECIMEN.target}
                count={ARMING_SPECIMEN.count}
                planHash={planHash}
                reason={reason}
                onReasonChange={setReason}
                state={
                  phase === "refused"
                    ? { phase: "refused", refusal: ARMING_SPECIMEN.refusal, onReplan: replan }
                    : { phase: "arming" }
                }
                onCommit={commit}
                onCancel={reset}
              />
            )}

            <div className="flex flex-wrap items-center gap-2">
              <FactChip dashed title="Fixture data — nothing is planned, nothing is written.">
                fixture
              </FactChip>
              <Tag>
                phase {phase} · plan {planHash}
                {replanned ? " (re-planned)" : ""}
              </Tag>
              {reason.trim().length === 0 ? null : (
                <ActionButton
                  label="reset"
                  onClick={reset}
                  reason="Back to unarmed on the original plan"
                />
              )}
            </div>

            {phase === "refused" ? (
              <OutcomeLine
                kind="refused"
                label="refused · plan hash drift"
                says="declined before touching anything — a refusal IS the model disagreeing, so it earns the one alarm"
              />
            ) : null}
          </div>
        </Section>

        {/* ── frozen ───────────────────────────────────────────────────────────────────── */}
        <Section label="02 · the three phases, frozen">
          <p>the same component, three states, so the sequence can be read without performing it</p>
          <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
            <Frozen
              phase="unarmed"
              says="present, legible, refused with its reason on the surface. No ceremony colour yet and the firm hairline is its edge: this is a thing that WILL be armed, not a thing that is."
            >
              <ArmingStrip
                verb={ARMING_SPECIMEN.verb}
                target={ARMING_SPECIMEN.target}
                count={ARMING_SPECIMEN.count}
                planHash={ARMING_SPECIMEN.planHash}
                reason=""
                onReasonChange={noop}
                state={{ phase: "arming" }}
                onCommit={noop}
                onCancel={noop}
              />
            </Frozen>
            <Frozen
              phase="armed"
              says="the one filled blue, at every blast radius. The reason stays visible and editable after arming — an armed strip that hides its own reason is a button with extra steps."
            >
              <ArmingStrip
                verb={ARMING_SPECIMEN.verb}
                target={ARMING_SPECIMEN.target}
                count={ARMING_SPECIMEN.count}
                planHash={ARMING_SPECIMEN.planHash}
                reason={ARMING_SPECIMEN.reasonExample}
                onReasonChange={noop}
                state={{ phase: "arming" }}
                onCommit={noop}
                onCancel={noop}
              />
            </Frozen>
            <Frozen
              phase="refused"
              says="the one alarm, and exactly one way forward. The refused frame drops the target, the counts and the reason — it is no longer a thing you can press."
            >
              <ArmingStrip
                verb={ARMING_SPECIMEN.verb}
                target={ARMING_SPECIMEN.target}
                count={ARMING_SPECIMEN.count}
                planHash={ARMING_SPECIMEN.planHash}
                reason={ARMING_SPECIMEN.reasonExample}
                onReasonChange={noop}
                state={{ phase: "refused", refusal: ARMING_SPECIMEN.refusal, onReplan: noop }}
                onCommit={noop}
                onCancel={noop}
              />
            </Frozen>
          </div>
        </Section>

        <section className="flex flex-col gap-1.5">
          <span>what this page found</span>
          <Gap>
            the strip cannot say <strong>how old its own plan is</strong> — the one fact that
            decides whether to press it. It renders &ldquo;armed against a plan of unknown
            age&rdquo; rather than hiding the hole. The arming record needs <code>armedAt</code>,{" "}
            <code>armedBy</code> and <code>supersededBy</code> before that line can be deleted.
          </Gap>
          <Gap>
            the refusal and the fresh plan are <strong>not linked</strong>. This route holds a{" "}
            <code>replanned</code> boolean and swaps the hash itself; nothing in the component or
            the model connects a refusal to the plan that supersedes it, so the strip cannot show
            &ldquo;refused a91f#c04 → now planning b02e#118&rdquo;.
          </Gap>
          <Gap>
            the strip has <strong>no link to the verb it arms</strong>. <code>verb</code> is a
            string used as both the label and the ceremony&apos;s subject, so an armed strip and the
            disabled verb elsewhere on a page that it is arming cannot know about each other.
          </Gap>
          <Gap>
            <strong>the receipt is a separate component with no link back.</strong> Committing here
            renders an <code>OutcomeLine</code> this route assembled from the fixture; the strip
            reports nothing about what it did, and the outcome carries no verb or target.
          </Gap>
          <Gap>
            there is <strong>no cancelled phase</strong>. <code>onCancel</code> disarms and the
            surface simply returns to unarmed, so an abandoned write leaves no trace at all — which
            may be right, and has never been ruled.
          </Gap>
        </section>
      </main>
    </div>
  );
}

function Frozen({
  phase,
  says,
  children,
}: {
  phase: string;
  says: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <span>{phase}</span>
      {children}
      <p>{says}</p>
    </div>
  );
}

/* ── satellite chrome ────────────────────────────────────────────────────────────────────── */

function Header({ title, note }: { title: string; note: string }) {
  return (
    <header className="sticky z-sticky">
      <div className="flex items-center justify-between py-2.5">
        <div className="flex min-w-0 items-baseline gap-3">
          <Link to="/design-system">← design system</Link>
          <span>{title}</span>
          <span>{note}</span>
          <FactChip dashed title="Everything on this page is fixture data — no host, no plan.">
            fixture
          </FactChip>
        </div>
        <ThemeToggle />
      </div>
    </header>
  );
}
