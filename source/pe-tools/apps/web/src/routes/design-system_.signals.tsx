/**
 * /design-system/signals — the signal-discipline specimen (signals crusade, for the user's verdict).
 *
 * Two routes, BEFORE and AFTER. BEFORE is what refine/ix-band 9683205 draws, rebuilt from the same
 * primitives with the user's own screenshot data (the RV-5 unit refusal on /schedules; the empty,
 * disconnected /families). AFTER applies the draft tenets in `signals-census.md`.
 *
 * SPECIMEN DATA, ANNOUNCED: nothing here talks to a host. The Situation head is drawn with the same
 * Press, FactChip, PageLog and StateCell it uses in production, but without a RouteHandle.
 */
import type { ReactNode } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";

import { ActionButton } from "#/components/lang/action-button";
import { StateCell } from "#/components/lang/cell";
import { FactChip } from "#/components/lang/chip";
import { EmptyState } from "#/components/lang/empty";
import { OutcomeLine } from "#/components/lang/outcome";
import { Press } from "#/components/lang/press";
import { ThemeToggle } from "#/components/lang/theme-toggle";
import { PageLog } from "#/route/situation";

export const Route = createFileRoute("/design-system_/signals")({ component: SignalsRoute });

const noop = () => {};

const REFUSAL =
  "Bare numeric value '300' is ambiguous for measurable parameter 'PE_M_Fan_AirFlowMin'. Pass unit (e.g. unit: \"CFM\"), or rawInternal: true if the value is already in internal units.";
/** The cell's own words for the same refusal: what to do, in the person's terms. */
const CELL_REFUSAL = "Revit refused a bare 300 — type it with a unit: 300 CFM";

const ROWS = [
  { n: 2, tag: "RV-1", serves: "Guest Suite FC-18", min: "0 CFM", flow: "30 CFM" },
  { n: 3, tag: "RV-2", serves: "Gym FC-31", min: "0 CFM", flow: "45 CFM" },
  { n: 6, tag: "RV-5", serves: "Kathy's Office FC-9", min: "300", flow: "35 CFM", refused: true },
  { n: 7, tag: "RV-6", serves: "Xbox/Hall FC-15", min: "0 CFM", flow: "60 CFM" },
];

/* ── shared pieces ─────────────────────────────────────────────────────────── */

const Label = ({ children }: { children: ReactNode }) => (
  <span className="t-small t-upper text-ink-mute">{children}</span>
);

/** A stage verb, drawn the way `SituationAction` draws it. */
function Verb({
  label,
  count,
  commit,
  caution,
  title,
}: {
  label: string;
  count?: ReactNode;
  commit?: boolean;
  caution?: boolean;
  title?: string;
}) {
  return (
    <Press
      frame="line"
      tone={commit ? "neutral" : "quiet"}
      size="value"
      state="rest"
      data-tone={caution ? "caution" : undefined}
      title={title ?? label}
      onClick={noop}
      style={{ fontWeight: commit ? 600 : undefined }}
    >
      {label}
      {count != null ? <span className="face-mono text-ink-2">{count}</span> : null}
    </Press>
  );
}

function Head({
  name,
  sentence,
  verbs,
  meter,
  under,
  log,
  quiet,
}: {
  name: string;
  sentence: ReactNode;
  verbs: ReactNode;
  meter?: string;
  under?: ReactNode;
  log: Parameters<typeof PageLog>[0]["entries"];
  /** AFTER: an empty log says nothing. */
  quiet?: boolean;
}) {
  return (
    <section className="border border-line">
      <h3 className="px-3 pt-2 t-head face-display text-ink">{name}</h3>
      <div className="flex flex-wrap gap-x-10 gap-y-1 px-3 pt-2 pb-1">
        <div className="flex min-w-[28rem] flex-[3] flex-col">
          <p className="mb-1.5 t-prose text-ink-2 [&_b]:font-semibold [&_b]:text-ink">{sentence}</p>
          <div className="hairline-t flex flex-wrap items-center gap-x-2 gap-y-1 py-1.5">
            <span className="w-[9rem]">
              <Label>▸ verbs</Label>
            </span>
            {verbs}
            {meter ? <span className="t-small face-mono text-ink-mute">{meter}</span> : null}
          </div>
          {under}
        </div>
        <div className="flex min-w-[20rem] flex-[2] flex-col">
          <div className="hairline-t flex flex-col gap-1 py-1.5">
            <Label>log</Label>
            {quiet && !log.length ? null : <PageLog entries={log} />}
          </div>
        </div>
      </div>
    </section>
  );
}

function Grid({ refusedOnCell }: { refusedOnCell: boolean }) {
  return (
    <table className="w-full t-small">
      <thead>
        <tr className="text-left">
          <th className="w-10" />
          <th>
            <Label>tag</Label>
          </th>
          <th>
            <Label>serves equipment</Label>
          </th>
          <th>
            <Label>flow rate min (cfm)</Label>
          </th>
          <th>
            <Label>flow rate (cfm)</Label>
          </th>
        </tr>
      </thead>
      <tbody>
        {ROWS.map((row) => (
          <tr key={row.n} className="hairline-t">
            <td className="face-mono text-ink-mute">
              {refusedOnCell && row.refused ? (
                <FactChip tone="caution" title="1 cell on this row was refused by the last push">
                  {row.n}
                </FactChip>
              ) : (
                row.n
              )}
            </td>
            <td>{row.tag}</td>
            <td>{row.serves}</td>
            <td className="w-64">
              {row.refused ? (
                <StateCell
                  scale="row"
                  value={row.min}
                  modelValue="0 CFM"
                  stage="staged"
                  stagedBy="you"
                  refused={refusedOnCell ? CELL_REFUSAL : undefined}
                  onCommit={() => undefined}
                />
              ) : (
                row.min
              )}
            </td>
            <td>{row.flow}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function PaneHead({ children, actions }: { children: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-2 border-y border-line px-3 py-1.5">
      {children}
      {actions ? <span className="ml-auto flex gap-1.5">{actions}</span> : null}
    </div>
  );
}

function Column({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-2">
      <Label>{title}</Label>
      {children}
    </div>
  );
}

function Why({ items }: { items: string[] }) {
  return (
    <ol className="list-decimal pl-5 t-prose text-ink-2">
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ol>
  );
}

/* ── /schedules: the unit refusal ─────────────────────────────────────────── */

const SCHEDULES_SENTENCE = (
  <>
    <b>Auditing</b> schedule in <u>ProjectA_Clone_Aug_11</u>, filed to <u>choose a pod</u>.
  </>
);

function SchedulesBefore() {
  return (
    <Column title="before · refine/ix-band 9683205">
      <Head
        name="Schedules"
        sentence={SCHEDULES_SENTENCE}
        verbs={
          <>
            <Verb label="list schedules" />
            <Verb label="read schedule" />
            <Verb label="push" caution />
            <Verb label="capture schedule" />
            <Verb label="apply schedule" commit />
          </>
        }
        meter="r2"
        under={
          <div
            data-surface="artifact"
            data-tone="caution"
            className="max-w-[60ch] rounded-lg px-3 py-1.5 t-prose ring-1 ring-line"
          >
            refused — nothing ran: 6::6: {REFUSAL}{" "}
            <span className="face-mono text-ink-mute">Esc</span>
          </div>
        }
        log={[
          {
            at: "04:02:13",
            kind: "verb",
            label: "push refused",
            says: `refused — nothing ran: 6::6: ${REFUSAL}`,
            refused: true,
          },
          { at: "04:01:57", kind: "work", label: "work r2", says: "loaded", refused: false },
          { at: "04:01:57", kind: "work", label: "work r1", says: "loaded", refused: false },
          { at: "04:00:28", kind: "verb", label: "read schedule", says: "ran", refused: false },
        ]}
      />
      <div className="t-small">
        <div role="status">
          Staged cells retain their original binding reading. Apply checks current bindings before
          writing.
        </div>
        <div role="status">
          push run · Refused · action receipt (no pod bound) · 6::6 0 CFM → 300
        </div>
        <div>No unresolved actions for this selection</div>
      </div>
      <PaneHead>
        <Label>schedules</Label>
        <span>Energy/Heat Recovery Ventilator Schedule</span>
        <FactChip title="as drawn today">bridge connected</FactChip>
        <FactChip title="as drawn today">25×34</FactChip>
        <FactChip title="as drawn today">read just now</FactChip>
        <ActionButton
          tone="commit"
          label="push 1 to Revit"
          reason="Write 1 staged cell"
          onClick={noop}
        />
      </PaneHead>
      <OutcomeLine
        kind="refused"
        label="not-ready refusal"
        says={`refused — nothing ran: 6::6: ${REFUSAL}`}
      />
      <Grid refusedOnCell={false} />
    </Column>
  );
}

function SchedulesAfter() {
  return (
    <Column title="after · the tenets">
      <Head
        name="Schedules"
        sentence={SCHEDULES_SENTENCE}
        verbs={
          <>
            <Verb label="list schedules" />
            <Verb label="read schedule" />
            <Verb
              label="push"
              count={1}
              caution
              title="Write 1 staged cell into Revit. The last push was refused on RV-5 · Flow Rate Min; fix the cell and push again."
            />
            <Verb label="capture schedule" />
            <Verb label="apply schedule" commit />
          </>
        }
        log={[
          {
            at: "04:02:13",
            kind: "verb",
            label: "push",
            says: "1 refused · RV-5 Flow Rate Min — nothing written",
            refused: true,
          },
          {
            at: "04:00:28",
            kind: "verb",
            label: "read schedule",
            says: "Energy/Heat Recovery Ventilator Schedule",
            refused: false,
          },
        ]}
      />
      <PaneHead actions={<Verb label="re-read" />}>
        <Label>schedules</Label>
        <span>Energy/Heat Recovery Ventilator Schedule</span>
      </PaneHead>
      <Grid refusedOnCell />
      <Why
        items={[
          "The refusal lives on the cell, in the cell's words (StateCell `refused`), and on its row number. The log keeps one history line. Popover, grey strip and red banner are gone.",
          "One push. The operand rides the verb (push 1). The caution tint says the last run was refused; the title says where. The pane's push-1-to-Revit button is gone.",
          "bridge connected, 25×34 and read just now are gone. The host lamp owns connection. A read shows its age only once it is stale.",
          "unwritten / r2 is gone from the verb row; the revision stays in the ledger behind the state gauge.",
          "No unresolved actions, and the binding-reading prose, are gone. Absence says nothing.",
        ]}
      />
    </Column>
  );
}

/* ── /families: empty and disconnected ────────────────────────────────────── */

const FAMILIES_SENTENCE = (
  <>
    <b>Auditing</b> families over <u>no staged scope</u> (0 picked) in <u>choose a session</u>,
    filed to <u>choose a pod</u>.
  </>
);

function FamiliesBefore() {
  return (
    <Column title="before · refine/ix-band 9683205">
      <Head
        name="Families"
        sentence={FAMILIES_SENTENCE}
        verbs={
          <>
            <Verb label="apply scope" />
            <Verb label="save draft to pod" />
            <Verb label="capture families" />
            <Verb label="plan" commit />
          </>
        }
        meter="unwritten"
        log={[]}
      />
      <PaneHead>
        <Label>scope draft</Label>
        <span className="t-small">all loaded</span>
        <EmptyState story="scope" exit="bind a different world in the sentence above">
          no categories — the category-names read succeeded and reported none
        </EmptyState>
      </PaneHead>
      <PaneHead
        actions={
          <>
            <ActionButton label="accept all" reason="Accept every open proposal" onClick={noop} />
            <ActionButton label="deny all" reason="Deny every open proposal" onClick={noop} />
          </>
        }
      >
        <Label>proposals</Label>
        <FactChip title="as drawn today">0 open</FactChip>
        <FactChip title="as drawn today">0 staged</FactChip>
        <span className="t-small text-ink-2">nothing proposed or staged</span>
      </PaneHead>
      <PaneHead>
        <Label>families in scope</Label>
        <span className="t-small face-mono">0 families · 0 types 0 parameters | 0 picked</span>
      </PaneHead>
      <EmptyState
        story="scope"
        exit="connect the host in Revit, then bind that world in the sentence above"
      >
        nothing to audit — the bridge is disconnected
      </EmptyState>
    </Column>
  );
}

function FamiliesAfter() {
  return (
    <Column title="after · the tenets">
      <Head
        name="Families"
        sentence={FAMILIES_SENTENCE}
        verbs={
          <>
            <Verb label="apply scope" title="Refused: choose a session first" />
            <Verb label="save draft to pod" title="Refused: nothing is staged" />
            <Verb label="capture families" title="Refused: choose a session first" />
            <Verb label="plan" commit title="Refused: choose a session first" />
          </>
        }
        log={[]}
        quiet
      />
      <PaneHead>
        <Label>families in scope</Label>
      </PaneHead>
      <EmptyState story="scope" exit="choose a session in the sentence above">
        no families yet
      </EmptyState>
      <Why
        items={[
          "The one missing thing is the session. It is said once, where it is chosen: the sentence. Every verb it blocks says so on hover.",
          "The bridge-disconnected sentence is gone from the pane. The host lamp at the top right owns connection state.",
          "The proposals band does not render with 0 proposals. accept all / deny all appear only when there is something to accept.",
          "The empty scope-draft band, the 0 counts and the empty log line are gone. The empty pane keeps one line with its exit.",
        ]}
      />
    </Column>
  );
}

function SignalsRoute() {
  return (
    <div className="min-h-screen px-4">
      <header className="flex items-center justify-between py-2.5">
        <div className="flex items-baseline gap-3">
          <Link to="/design-system">← design system</Link>
          <span>signals</span>
          <span className="text-ink-2">
            one fact, one place · one verb, one control · silence is the default
          </span>
          <FactChip dashed title="The user's /schedules screenshot data; no host.">
            fixture
          </FactChip>
        </div>
        <ThemeToggle />
      </header>
      <main className="flex flex-col gap-10 pb-16">
        <section className="flex flex-col gap-3">
          <h2 className="t-head">/schedules · one push refusal</h2>
          <div className="flex flex-wrap gap-6">
            <SchedulesBefore />
            <SchedulesAfter />
          </div>
        </section>
        <section className="flex flex-col gap-3">
          <h2 className="t-head">/families · no session</h2>
          <div className="flex flex-wrap gap-6">
            <FamiliesBefore />
            <FamiliesAfter />
          </div>
        </section>
      </main>
    </div>
  );
}
