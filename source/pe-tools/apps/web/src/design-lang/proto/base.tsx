/**
 * PROTOTYPE — design-lang base 2, ROUND 2: THE FIXED BASE. Throwaway.
 *
 * Round 1 ruled variant e (cell states) the winner on whole-page legibility. Round 2 isolates
 * THE PALETTE: this one base is rendered byte-identically under rival palette token scopes and
 * judged by flipping each in both modes. Grammar deviations wait for round 3.
 *
 * WHAT THIS BASE IS — e's grammar, constrained by the ruling grill, plus every donation:
 *
 *   e (winner)   one cell grammar at three scales — the chat card's staged values, the table
 *                cells, and the arming strip are the same treatment; and tasteful FILLS do the
 *                separating, not outline borders. Border-scarce throughout.
 *   weak anchor  cell-BODY treatment (wash/ring/fold) is reserved for PEA PROPOSALS and
 *                UNEDITABLE/DISABLED. e's whole-cell drift hatch is GONE: drift is now a
 *                decoration plus an inline ghost token. Staging left the body too — it is bold
 *                plus the bottom-left square.
 *   c (axis law) ONE decoration family (squiggles) carries "state of the value", ranked by
 *                colour: drift ▸ stale ▸ unverified. Only two primary text colours on the page.
 *                A plain underline is a CITATION, and it lives on the footline's source name —
 *                a different element — so it can never contend for the squiggle's slot.
 *   a (verbs)    the lane is grouped by blast radius with labelled groups, and grouping buys no
 *                hue; each refused option carries its own reason ON the surface.
 *   b (outcomes) coloured mono text + icon + squiggly-under/italic. Never bold — bold is
 *                reserved for unsaved, everywhere, always.
 *
 * Blue is scarce: `--r-commit` is the only filled blue, `--r-nav` is blue TEXT with the three
 * arrow directions, and nothing else in the language is blue.
 *
 * BORDER BUDGET (note 3, ruled 2026-08-16): the ARTIFACT FRAME (one ground shift + one quiet
 * inset hairline) belongs to machine-operated objects that CARRY STATE — the table, pea's chat
 * card, the arming strip, the sentence. Plain content is never enclosed: the verb lane and the
 * outcomes lane sit directly on the page ground under a quiet head. See base.css.
 *
 * ROUND-2 RULING NOTES 1/2/4 also live here: pea's open proposal carries fold AND square (both
 * pea's colour, distinct from your caution square); the cell-state key is a first-class
 * by-axis block; and every hand-rolled control takes one shared hover veil.
 *
 * Fixture is `./world.ts`, READ-ONLY. Colour comes ONLY from `./palettes/tokens.css`; see the
 * slot table at the top of `./base.css` for the rules this file renders.
 */
import { useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Ban,
  Check,
  ChevronsDownUp,
  CircleOff,
  ExternalLink,
  Info,
  Layers,
  LoaderCircle,
  RefreshCw,
  Save,
  Share2,
  Sparkles,
  TriangleAlert,
  Undo2,
  Upload,
  X,
} from "lucide-react";

import {
  ARMING,
  CHAT_THREAD,
  OUTCOMES,
  PROPOSAL_CARD,
  SENTENCE,
  TABLE_ROWS,
  VERBS,
  type CellFixture,
  type OutcomeFixture,
  type ProposalCardCell,
  type VerbEffect,
} from "./world";

import "./palettes/tokens.css";
import "./base.css";

const noop = () => {};

/* ── the one reader of state ───────────────────────────────────────────────────────────────
   Card, table and key all render through this, so the three scales cannot disagree about what
   a cell is. This function IS the precedence written at the top of base.css. */

interface CellRead {
  /** The only two things allowed to own the cell BODY (weak anchor, ruled 2026-08-16). */
  body: "proposed" | "locked" | null;
  /** No real element behind it — the reserved dashed seam edge. */
  seam: boolean;
  /** The one squiggle slot. One winner draws; the losers draw nothing. */
  unsettled: "drift" | "stale" | "unverified" | null;
  /** YOUR unsaved edit: bold + the caution square. Composes with everything above.
   *  Pea's open proposal is unsaved too — it draws the same square in pea's own ink off
   *  `body: "proposed"`, so authorship is the square's colour, never its presence. */
  unsaved: boolean;
}

function readCell(c: CellFixture): CellRead {
  const locked = c.cap !== "editable";
  return {
    body: locked ? "locked" : c.stage === "proposed" ? "proposed" : null,
    seam: c.cap === "nohome",
    unsettled:
      c.agree === "drift"
        ? "drift"
        : c.fresh === "stale"
          ? "stale"
          : c.fresh === "unverified"
            ? "unverified"
            : null,
    unsaved: !locked && c.stage === "staged",
  };
}

/** The cell box. Everything that styles a cell is one of these three attributes. */
function Cell({
  read,
  children,
}: {
  read: Pick<CellRead, "body" | "seam" | "unsaved">;
  children: React.ReactNode;
}) {
  return (
    <span
      className="r-cell"
      data-body={read.body ?? undefined}
      data-seam={read.seam ? "" : undefined}
      data-unsaved={read.unsaved ? "" : undefined}
    >
      {children}
    </span>
  );
}

/** The value text. The squiggle rides HERE — on the text, never on the box. */
function Value({ state, children }: { state: CellRead["unsettled"]; children: React.ReactNode }) {
  if (!state) return <>{children}</>;
  return (
    <span className="r-sq" data-state={state}>
      {children}
    </span>
  );
}

/* ── the base ──────────────────────────────────────────────────────────────────────────── */

export function Base({ palette = "p0" }: { palette?: string }) {
  return (
    <div className="dlv-base" data-palette={palette}>
      <ChatMoment />
      <TableMoment />
      <VerbMoment />
      <SentenceMoment />
    </div>
  );
}

function Section({
  n,
  title,
  note,
  children,
}: {
  n: string;
  title: string;
  note: string;
  children: React.ReactNode;
}) {
  return (
    <section className="r-section">
      <div className="r-section-head">
        <span className="r-tag">{n}</span>
        <span className="r-section-title">{title}</span>
        <span className="r-section-note">{note}</span>
      </div>
      {children}
    </section>
  );
}

/* ── 1 · pea's proposal card, inline in the thread ─────────────────────────────────────── */

function ChatMoment() {
  const { open, staged, attention } = PROPOSAL_CARD.summary;
  return (
    <Section
      n="01"
      title="chat proposal"
      note="pea's card is the table's grammar one scale up — the same wash, ring and fold, inside the same artifact frame"
    >
      <div style={{ width: 660, maxWidth: "100%" }}>
        {CHAT_THREAD.map((m, i) => (
          <div key={i} className="r-msg">
            <span className="r-who" data-who={m.who}>
              {m.who === "pea" ? "pea" : "you"}
            </span>
            <p>{m.text}</p>
          </div>
        ))}

        {/* ARTIFACT FRAME — the card is a machine-operated object sitting on the thread. */}
        <div className="r-artifact" style={{ marginTop: 10 }}>
          <div className="r-artifact-head">
            <span className="r-tag" style={{ color: "var(--r-pea-ink)" }}>
              pea proposes
            </span>
            <span style={{ fontSize: 12.5, fontWeight: 500, minWidth: 0 }}>
              {PROPOSAL_CARD.family}
            </span>
          </div>

          {PROPOSAL_CARD.cells.map((cell) => (
            <CardRow key={cell.key} cell={cell} />
          ))}

          <div className="r-artifact-foot">
            <span className="r-mono" style={{ fontSize: 10.5, color: "var(--r-ink-2)" }}>
              {open} open · {staged} staged ·{" "}
              <span style={{ color: attention > 0 ? "var(--r-caution)" : undefined }}>
                {attention} needs a person
              </span>
            </span>
            {/* The one human-only commit on this surface. Accepting only STAGES (COLOR-ROLES:
                accept is act, not commit), so this is the only blue fill in the whole card. */}
            <button
              type="button"
              className="r-verb"
              data-tone="commit"
              onClick={noop}
              title="Writes the staged value into the profile document"
            >
              <Save />
              {PROPOSAL_CARD.commitLabel}
            </button>
          </div>
        </div>

        <p style={{ margin: "6px 0 0", fontSize: 10.5, color: "var(--r-ink-2)" }}>
          The fold is pea's. The square says nothing is saved yet — green while pea holds it,
          yours once you accept. Nothing leaves the page until the blue verb is pressed.
        </p>
      </div>
    </Section>
  );
}

function CardRow({ cell }: { cell: ProposalCardCell }) {
  // The card's three states map onto the ONE cell grammar: open → pea owns the body, and the
  // fold + pea-coloured unsaved square travel with it; staged → the body is released and the
  // value goes bold with the CAUTION square (same shape, your colour — the handover from pea
  // to you is visible as a colour change in one mark); denied → the event is withdrawn
  // entirely and the value goes quiet and struck.
  const read: Pick<CellRead, "body" | "seam" | "unsaved"> = {
    body: cell.state === "open" ? "proposed" : null,
    seam: false,
    unsaved: cell.state === "staged",
  };
  return (
    <div className="r-card-row">
      <span className="r-card-label">{cell.label}</span>

      <div style={{ minWidth: 0 }}>
        <span
          style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", gap: 6 }}
          className="r-mono"
        >
          {cell.current != null ? (
            <span className="r-was">{cell.current}</span>
          ) : (
            // FIXTURE GAP: `current: null` cannot distinguish "the parameter is empty" from
            // "we never read it" — two different facts, one null (§1: not-started is a state).
            <span className="r-denied" style={{ textDecoration: "none", fontSize: 11 }}>
              empty
            </span>
          )}
          <span className="r-arrow">→</span>
          {cell.state === "denied" ? (
            <span className="r-denied r-mono" style={{ fontSize: 12 }}>
              {cell.proposed}
            </span>
          ) : (
            <Cell read={read}>
              <span style={{ fontSize: 12 }}>{cell.proposed}</span>
            </Cell>
          )}
        </span>

        {cell.note || cell.confidence === "low" || cell.state === "denied" ? (
          <div className="r-note">
            {cell.confidence === "low" ? (
              <span style={{ color: "var(--r-caution)" }}>low confidence — </span>
            ) : null}
            {/* FIXTURE GAP: a denial carries no reason and no author, so the one state on this
                card a newcomer cannot read is the one that needs explaining most. */}
            {cell.state === "denied" ? "denied — no reason recorded" : cell.note}
          </div>
        ) : null}
      </div>

      <div style={{ display: "flex", gap: 2 }}>
        {cell.state === "open" ? (
          <>
            <button
              type="button"
              className="r-icon-btn"
              onClick={noop}
              title="Deny — drops pea's proposal"
            >
              <X />
            </button>
            <button
              type="button"
              className="r-icon-btn"
              onClick={noop}
              title="Accept — stages the value; nothing leaves the page"
            >
              <Check />
            </button>
          </>
        ) : cell.state === "staged" ? (
          <button
            type="button"
            className="r-icon-btn"
            onClick={noop}
            title="Undo — unstages the value"
          >
            <Undo2 />
          </button>
        ) : (
          <button
            type="button"
            className="r-icon-btn"
            onClick={noop}
            title="Restore pea's proposal"
          >
            <RefreshCw />
          </button>
        )}
      </div>
    </div>
  );
}

/* ── 2 · the table slice ───────────────────────────────────────────────────────────────── */

function TableMoment() {
  return (
    <Section
      n="02"
      title="table slice"
      note="drift and freshness left the cell body for the squiggle slot, so density holds: one footline per row, no row taller than its own value"
    >
      <div className="r-artifact">
        <table className="r-table">
          <colgroup>
            <col style={{ width: 158 }} />
            <col />
            <col style={{ width: 58 }} />
          </colgroup>
          <thead>
            <tr>
              <th>parameter</th>
              <th>value</th>
              <th className="r-right">read</th>
            </tr>
          </thead>
          <tbody>
            {TABLE_ROWS.map((row) => (
              <ValueRow
                key={row.param}
                row={row}
                // Selection is a FILL and never a hue — one row lit to exercise the token.
                selected={row.param === "Sill Height"}
              />
            ))}
          </tbody>
        </table>
        <CellKey />
      </div>
    </Section>
  );
}

function ValueRow({ row, selected }: { row: CellFixture; selected: boolean }) {
  const r = readCell(row);

  // ONE footline per row. Facts are ranked and joined onto a single clamped line rather than
  // stacked, which is what killed e's density (round 1 measured a 2.1× row-height spread).
  const facts: React.ReactNode[] = [];
  if (row.capReason) facts.push(row.capReason);
  if (row.note)
    facts.push(row.confidence ? `${row.confidence} confidence — ${row.note}` : row.note);
  if (row.grounding)
    facts.push(
      // A PLAIN underline is a citation. It sits here, on the source name, not on the value —
      // which is how "citation never contends with the squiggle" becomes structurally true
      // rather than a rule someone has to remember.
      <span className="r-cite" key="cite">
        {row.grounding.doc} p.{row.grounding.page}
      </span>,
    );

  return (
    <tr data-selected={selected ? "" : undefined}>
      <td className="r-param">{row.param}</td>
      <td className="r-value">
        <span style={{ display: "inline-flex", flexWrap: "wrap", alignItems: "baseline", gap: 6 }}>
          <Cell read={r}>
            <Value state={r.unsettled}>{row.value}</Value>
          </Cell>
          {/* Drift's second half: the other side's value as a struck ghost token, INLINE, so
              the one alarm is unmissable and still costs zero row height. */}
          {row.agree === "drift" && row.modelValue ? (
            <span className="r-ghost" title="the value Revit currently holds">
              {row.modelValue}
            </span>
          ) : null}
        </span>
        {facts.length > 0 ? (
          <span className="r-foot">
            {facts.map((f, i) => (
              <span key={i}>
                {i > 0 ? " · " : null}
                {f}
              </span>
            ))}
          </span>
        ) : null}
      </td>
      <td className="r-right r-age">
        {/* FIXTURE GAP: `ageMin` is absent on the unverified row by design, but ALSO absent on
            Zone Area, which claims fresh: "fresh" — a freshness with no reading behind it. §3
            calls that a defect, not an empty field; it renders as an honest em-dash. */}
        {row.ageMin != null ? `${row.ageMin}m` : "—"}
      </td>
    </tr>
  );
}

/**
 * THE CELL-STATE KEY — promoted to a first-class entity (note 2, ruled 2026-08-16): it was
 * instrumental to the table reading at all, so it stops being a flat strip of specimens and
 * becomes a component-shaped block.
 *
 * SEED OF `CellStateKey` — the component-repair step should lift this whole thing verbatim:
 * the axis list is data, the specimens render through the SAME `Cell`/`Value` readers the table
 * uses, and the block is the natural home for the "which axes does this table actually use"
 * question (a real key would take the rows it describes and drop axes nobody exercises).
 *
 * GROUPING — by AXIS, the four the base actually renders, in the order the eye needs them:
 * who acted (event) ▸ does the model agree ▸ how old is the reading ▸ can it be written at all.
 * ORDER WITHIN A GROUP — the cell's own precedence, so the key cannot teach a ranking the
 * table does not obey: capability outranks pea's proposal (rule 1 ▸ 2); the squiggle family is
 * drift ▸ stale ▸ unverified (rule 3); the unsaved square composes last (rule 4).
 */
const KEY_AXES: {
  axis: string;
  asks: string;
  items: { label: string; specimen: React.ReactNode }[];
}[] = [
  {
    axis: "event",
    asks: "who is holding an unsaved change?",
    items: [
      {
        label: "pea proposes — fold + green square",
        specimen: <Cell read={{ body: "proposed", seam: false, unsaved: false }}>2 hr</Cell>,
      },
      {
        label: "you staged — bold + your square",
        specimen: <Cell read={{ body: null, seam: false, unsaved: true }}>36 in</Cell>,
      },
    ],
  },
  {
    axis: "agreement",
    asks: "does Revit hold the same value?",
    items: [
      {
        label: "the model disagrees",
        specimen: (
          <span style={{ display: "inline-flex", alignItems: "baseline", gap: 6 }}>
            <span className="r-sq" data-state="drift">
              1.75 in
            </span>
            <span className="r-ghost">1.375 in</span>
          </span>
        ),
      },
    ],
  },
  {
    axis: "freshness",
    asks: "how old is the reading behind it?",
    items: [
      {
        label: "stale read",
        specimen: (
          <span className="r-sq" data-state="stale">
            5.5 in
          </span>
        ),
      },
      {
        label: "never read",
        specimen: (
          <span className="r-sq" data-state="unverified">
            26 in
          </span>
        ),
      },
    ],
  },
  {
    axis: "capability",
    asks: "can it be written at all?",
    items: [
      // FIXTURE/GRAMMAR GAP: `readonly` and `excluded` are two different refusals (a formula
      // drives it · Revit never bound it) and render as ONE greyed-italic body. The key can
      // only show what the base draws, so it shows one specimen and says both names.
      {
        label: "locked — formula-driven or excluded",
        specimen: <Cell read={{ body: "locked", seam: false, unsaved: false }}>84 in</Cell>,
      },
      {
        label: "seam — no element behind it",
        specimen: <Cell read={{ body: "locked", seam: true, unsaved: false }}>412 sf</Cell>,
      },
    ],
  },
  {
    axis: "grounding",
    asks: "where did the number come from?",
    items: [
      {
        label: "citation — plain underline, on the footline",
        specimen: <span className="r-cite">RFI-217 p.2</span>,
      },
    ],
  },
];

function CellKey() {
  return (
    <div className="r-key">
      {KEY_AXES.map((a) => (
        <div key={a.axis} className="r-key-axis">
          <div className="r-key-axis-head">
            <span className="r-key-axis-name">{a.axis}</span>
            <span className="r-key-axis-asks">{a.asks}</span>
          </div>
          {a.items.map((it) => (
            <span key={it.label} className="r-key-item">
              {it.specimen}
              <span>{it.label}</span>
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}

/* ── 3 · the verb lane, arming, outcomes ───────────────────────────────────────────────── */

const VERB_ICON: Record<VerbEffect, React.ComponentType> = {
  "nav:back": ArrowLeft,
  "nav:forward": ArrowRight,
  "nav:out": ExternalLink,
  page: ChevronsDownUp,
  read: RefreshCw,
  stage: Check,
  "write:doc": Save,
  "write:model": Upload,
  "write:external": Share2,
  agent: Sparkles,
};

type Tone = "nav" | "act" | "pea" | "commit";

function toneOf(effect: VerbEffect): Tone {
  if (effect.startsWith("nav:")) return "nav";
  if (effect.startsWith("write:")) return "commit";
  if (effect === "agent") return "pea";
  return "act";
}

/** a's donation: blast radius GROUPS the lane and labels the group. It never buys a hue —
 *  all three writes wear the same single blue no matter how far they reach. */
const GROUPS: { title: string; radius: string; effects: VerbEffect[] }[] = [
  {
    title: "goes somewhere",
    radius: "writes nothing · three directions, as browsers taught them",
    effects: ["nav:back", "nav:forward", "nav:out"],
  },
  {
    title: "acts on this page",
    radius: "page-scoped · reversible by looking away",
    effects: ["page", "read", "stage"],
  },
  { title: "pea", radius: "proposes; you cross", effects: ["agent"] },
  {
    title: "writes beyond the page",
    radius: "document · model · external",
    effects: ["write:doc", "write:model", "write:external"],
  },
];

function VerbMoment() {
  return (
    <Section
      n="03"
      title="verbs, arming, outcomes"
      note="one filled blue for every write however far it reaches; nav is blue text and nothing else in the language is blue"
    >
      {/* BORDER BUDGET (note 3): NOT framed. A lane of plain controls carries no state, so it
          sits on the page ground; the group heads are the only grouping it is allowed to buy.
          The frames below it — the arming strip — are what a framed thing looks like, and that
          contrast is exactly what the budget is protecting. */}
      <div className="r-verbs">
        {GROUPS.map((g) => (
          <div key={g.title}>
            <div className="r-group-head">
              <span className="r-group-title">{g.title}</span>
              <span className="r-group-radius">{g.radius}</span>
            </div>
            <div className="r-verb-row">
              {g.effects.map((e) => {
                const v = VERBS.find((x) => x.effect === e);
                return v ? <VerbButton key={v.label} verb={v} /> : null;
              })}
            </div>
          </div>
        ))}
      </div>

      <ArmingStrip />
      <OutcomeLane />
    </Section>
  );
}

function VerbButton({ verb }: { verb: (typeof VERBS)[number] }) {
  const Icon = VERB_ICON[verb.effect];
  const disabled = verb.disabledReason != null;
  // GAP (round-1 census, unchanged): `ui/verb` has no icon slot — the three nav directions are
  // ONLY legible as icons — no filled tone, no agent tone (so pea's own verb is illegal), and
  // `reason` is title-only, so a refusal is invisible until hover. Hand-rolled here.
  return (
    <span className="r-verb-slot">
      <button
        type="button"
        className="r-verb"
        data-tone={toneOf(verb.effect)}
        disabled={disabled}
        onClick={noop}
        title={verb.disabledReason ?? `${verb.effect} — stands in for ${verb.from}`}
      >
        <Icon />
        {verb.label}
      </button>
      {verb.disabledReason ? (
        // §3: refuse per option, with its own reason, ON the surface.
        <span className="r-refusal">{verb.disabledReason}</span>
      ) : null}
    </span>
  );
}

function ArmingStrip() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <span className="r-tag">arming — ceremony scales with blast radius</span>

      {/* The strip is the cell grammar at its largest scale: a tinted ground plus one edge,
          the same "fills separate, borders do not" move that won round 1. */}
      <div className="r-artifact">
        <div className="r-strip" data-state="armed">
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", gap: 8 }}>
            <span className="r-tag" style={{ color: "var(--r-commit)" }}>
              armed
            </span>
            <span style={{ fontSize: 12.5, fontWeight: 500 }}>{ARMING.verb}</span>
            <span className="r-mono" style={{ fontSize: 11, color: "var(--r-ink-2)" }}>
              {ARMING.target}
            </span>
            <span className="r-chip" title="The plan this write was made against.">
              plan {ARMING.planHash}
            </span>
            <span
              className="r-chip"
              title="Parameters this write will touch, counted from the plan."
            >
              {ARMING.count} params
            </span>
          </div>

          {/* The reason is supplied BEFORE the verb arms and stays visible after — an armed
              strip that hides its own reason is a button with extra steps. */}
          <div className="r-strip-reason">“{ARMING.reasonExample}”</div>

          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button
              type="button"
              className="r-verb"
              data-tone="commit"
              onClick={noop}
              title={`Writes ${ARMING.count} parameters into the live model against plan ${ARMING.planHash}`}
            >
              <Upload />
              {ARMING.verb}
            </button>
            <button
              type="button"
              className="r-verb"
              data-tone="act"
              onClick={noop}
              title="Disarms — nothing is written"
            >
              cancel
            </button>
            <span className="r-mono" style={{ fontSize: 9.5, color: "var(--r-ink-2)" }}>
              {/* FIXTURE GAP: ARMING carries no armed-at and no armed-by, so the strip cannot
                  say how stale its own plan is — the one fact that decides whether to press it. */}
              armed against a plan of unknown age
            </span>
          </div>
        </div>

        <div
          className="r-strip"
          data-state="refused"
          style={{ borderTop: "1px solid var(--r-line)" }}
        >
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", gap: 8 }}>
            <span className="r-tag" style={{ color: "var(--r-alarm)" }}>
              refused
            </span>
            <span style={{ fontSize: 12.5, fontWeight: 500 }}>{ARMING.verb}</span>
          </div>
          <p style={{ margin: 0, maxWidth: "72ch", fontSize: 12, lineHeight: 1.45 }}>
            {ARMING.driftRefusal}
          </p>
          <div>
            <button
              type="button"
              className="r-verb"
              data-tone="act"
              onClick={noop}
              title="Re-reads the model and builds a fresh plan"
            >
              <RefreshCw />
              re-plan
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** b's donation, executed under c's axis law: colour + icon + decoration, never the type
 *  weight. Every hue here is a MEANING role already in the contract — outcomes buy nothing. */
const OUTCOME_ICON: Record<OutcomeFixture["kind"], React.ComponentType<{ className?: string }>> = {
  busy: LoaderCircle,
  receipt: Check,
  refused: Ban,
  dropped: CircleOff,
  advisory: Info,
  partial: Layers,
  error: TriangleAlert,
};

function OutcomeLane() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <span className="r-tag">outcomes — coloured mono text, one icon, no bars, never bold</span>
      {/* BORDER BUDGET (note 3): receipts are plain content — they report on a machine-operated
          object, they are not one. Unframed, on the page ground, under a quiet head. */}
      <div>
        {OUTCOMES.map((o) => {
          const Icon = OUTCOME_ICON[o.kind];
          return (
            <div key={o.label} className="r-outcome" data-kind={o.kind}>
              <Icon className={o.kind === "busy" ? "r-spin" : undefined} />
              <span className="r-outcome-label">{o.label}</span>
              <span className="r-outcome-says">{o.says}</span>
            </div>
          );
        })}
      </div>
      {/* FIXTURE GAP: an outcome carries no verb, no time and no target, so a lane of them
          cannot say which write produced which receipt, and "4 staged for retry" has nowhere
          for the 4 to live. */}
    </div>
  );
}

/* ── 4 · the addressing sentence ───────────────────────────────────────────────────────── */

function SentenceMoment() {
  const [dropped, setDropped] = useState<string[]>([]);
  const chips = SENTENCE.chips.filter((c) => !dropped.includes(c.label));

  return (
    <Section
      n="04"
      title="addressing"
      note="nouns only; every narrowing is a removable chip; the receipt borrows the line and gives it back"
    >
      <div className="r-artifact">
        <div className="r-sentence">
          {SENTENCE.nouns.map((n, i) => (
            <span key={n.label} style={{ display: "contents" }}>
              {i > 0 ? <span className="r-sep">›</span> : null}
              <button
                type="button"
                className="r-noun"
                data-kind={n.kind}
                onClick={noop}
                title={`${n.kind} — click to address this level`}
              >
                {n.label}
              </button>
            </span>
          ))}
        </div>

        {/* the narrowing chips ride a recess strip INSIDE the sentence's frame — the sentence
            is the framed object; this is a band of it, not a second frame. (It borrowed the
            key's class before note 2 made the key a by-axis grid.) */}
        <div className="r-chiprow">
          {chips.map((c) => (
            // GAP: canon `ui/chip` is a STATE fact — no removal affordance, no count slot — so a
            // NARROWING chip (individually removable, §4) cannot be built from it. Two
            // primitives wearing one name; second consumer that would move the signature.
            <span key={c.label} className="r-chip">
              {c.label}
              <span style={{ color: "var(--r-ink-2)" }}>{c.count}</span>
              <button
                type="button"
                className="r-chip-x"
                onClick={() => setDropped((d) => [...d, c.label])}
                title={`Remove the "${c.label}" narrowing — widens the table back out`}
              >
                <X />
              </button>
            </span>
          ))}
          <span
            className="r-chip"
            title="Chips narrow but never hide: the count is of rows still in scope."
          >
            {chips.length > 0 ? "3 of 12 rows" : "12 of 12 rows"}
          </span>
        </div>

        <div
          className="r-artifact-foot"
          style={{ justifyContent: "flex-start", boxShadow: "none" }}
        >
          <Check style={{ width: 12, height: 12, color: "var(--r-done)" }} />
          <span className="r-mono" style={{ fontSize: 12, color: "var(--r-done)" }}>
            {SENTENCE.receipt}
          </span>
          <span style={{ fontSize: 10.5, color: "var(--r-ink-2)" }}>
            — the receipt borrows the line just after a commit, then relaxes back to the nouns
          </span>
        </div>
      </div>
    </Section>
  );
}
