/**
 * PROTOTYPE — throwaway, variant D of the /family clean room.
 *
 * DOSSIER. The structural bet: a profile IS a document, so the page should read like one rather
 * than like a tool that happens to hold one. The centre column is a manufactured cut sheet —
 * masthead, typeset parameter tables, a type-comparison table, an anatomy list, a footer stamp —
 * set on paper inside a hairline frame, at a real reading measure.
 *
 * The margins are where the page earns its keep. A document alone cannot show a crossing, so the
 * two crossings live in the two margins beside the section they touch:
 *
 *   RIGHT margin — pea's proposals. Ephemeral, page-scoped, pe-blue: proposed value, the note,
 *     the snippet of spec it was read from, accept/deny. The cell it targets carries a matching
 *     pe-blue rule and tick; hovering either lights both, so "which cell does this claim touch"
 *     is answered by looking, not by clicking.
 *   LEFT margin — live drift. Clay: Revit carries a different number here. A drift is not a
 *     proposal, so it does not get accept/deny — it gets the two document acts that resolve it.
 *
 * Verbs are DOCUMENT ACTS in the slim toolbar above the sheet, and each one visibly rewrites the
 * document: capture flips drifted cells to Revit's numbers, materialize declares the sheet the
 * truth and clears the drifts, build proof stamps an evidence line into the footer.
 *
 * The left rail is the SOURCE document — the scanned spec, the sibling of the sheet. Clicking a
 * block scrolls its proposals into view and flashes them: the spec is navigation, not decoration.
 */
import { useMemo, useRef, useState } from "react";

import { Sentence } from "#/components/sentence";
import { Pane, PaneSplit } from "#/components/ui/pane";
import {
  WORLD,
  type ProposalVerdict,
  type ProtoParam,
  type ProtoProposal,
  type SpecBlock,
} from "#/family/proto/world";

// ── the document's own state ────────────────────────────────────────────────────────────────────

/** The sheet as it currently reads: family-level values plus per-type overrides. Every act
 * rewrites this, so "did the act do anything" is answerable by reading the sheet. */
interface Sheet {
  params: Record<string, string>;
  types: Record<string, Record<string, string>>;
}

function initialSheet(): Sheet {
  return {
    params: Object.fromEntries(WORLD.profile.params.map((param) => [param.name, param.value])),
    types: Object.fromEntries(
      Object.entries(WORLD.profile.types).map(([name, overrides]) => [name, { ...overrides }]),
    ),
  };
}

/** One disagreement between the sheet and Revit. Resolved by an ACT, never by accept/deny. */
interface Drift {
  key: string;
  param: string;
  typeName: string;
  live: string;
}

type DriftState = "open" | "captured" | "materialized";

const LIVE = WORLD.live;
const SPEC = WORLD.spec;

const DRIFTS: Drift[] = Object.entries(LIVE?.values ?? {}).flatMap(([param, byType]) =>
  Object.entries(byType)
    .filter(([, cell]) => cell.drift === true)
    .map(([typeName, cell]) => ({
      key: `${param}::${typeName}`,
      param,
      typeName,
      live: cell.value,
    })),
);

const GROUP_ORDER = ["dimensions", "connections", "mechanical", "electrical"] as const;

const GROUP_TITLE: Record<string, string> = {
  dimensions: "Dimensions",
  connections: "Connections",
  mechanical: "Mechanical",
  electrical: "Electrical",
};

/** Section keys — the anchor vocabulary the margins hang off. A note lives beside the section
 * that contains the cell it argues about, so scrolling to a note scrolls to the evidence. */
function sectionOf(param: string, typeName: string | undefined): string {
  if (typeName != null) return "types";
  const spec = WORLD.profile.params.find((entry) => entry.name === param);
  return `group:${spec?.group ?? "dimensions"}`;
}

function cellValue(sheet: Sheet, param: string, typeName: string): string | null {
  return sheet.types[typeName]?.[param] ?? null;
}

// ── small typeset pieces ────────────────────────────────────────────────────────────────────────

function SectionHead({ title, note }: { title: string; note: string }) {
  return (
    <div className="mb-2 flex items-baseline justify-between border-b border-[var(--line)] pb-1">
      <h3 className="tele-label text-[10px] tracking-[0.24em] text-[var(--clay-ink)]">{title}</h3>
      <span className="tele text-[9px] text-[var(--slate)]">{note}</span>
    </div>
  );
}

/** The document act. One act = one visible rewrite of the sheet; "commit" is the single verb
 * that pushes the document at Revit, and it is the only one wearing pe-blue. */
function Act({
  label,
  reason,
  onClick,
  tone,
  disabled,
}: {
  label: string;
  reason: string;
  onClick: () => void;
  tone?: "commit";
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={reason}
      className="tele h-6 shrink-0 rounded-[2px] border px-2 text-[10px]"
      style={{
        borderColor: disabled
          ? "var(--line-soft)"
          : tone === "commit"
            ? "var(--pe-blue)"
            : "var(--line-2)",
        color: disabled
          ? "var(--muted-foreground)"
          : tone === "commit"
            ? "var(--pe-blue)"
            : "var(--foreground)",
        background: "transparent",
        cursor: disabled ? "not-allowed" : "pointer",
      }}
    >
      {label}
    </button>
  );
}

// ── margin annotations ──────────────────────────────────────────────────────────────────────────

function ProposalNote({
  proposal,
  block,
  verdict,
  hot,
  flashing,
  onHot,
  onAccept,
  onDeny,
  register,
}: {
  proposal: ProtoProposal;
  block: SpecBlock | null;
  verdict: ProposalVerdict;
  hot: boolean;
  flashing: boolean;
  onHot: (id: string | null) => void;
  onAccept: () => void;
  onDeny: () => void;
  register: (node: HTMLDivElement | null) => void;
}) {
  const target = proposal.typeName ? `${proposal.param} · ${proposal.typeName}` : proposal.param;

  // A settled proposal collapses to a mark. The page keeps the mark rather than deleting the
  // note, so the margin still records that a claim was made and answered.
  if (verdict !== "open") {
    return (
      <div
        ref={register}
        className="tele flex items-baseline gap-1 py-1 text-[9px]"
        title={
          verdict === "accepted"
            ? `Accepted — the sheet now reads ${proposal.proposed} for ${target}, from ${block?.id ?? "the spec"}. The proposal itself was never persisted; only the value it argued for is now in the document.`
            : `Denied — the sheet keeps its own value for ${target}. Nothing was written, and pea's proposal is gone with the page.`
        }
        style={{ color: verdict === "accepted" ? "var(--cat-green)" : "var(--slate)" }}
        onMouseEnter={() => onHot(proposal.id)}
        onMouseLeave={() => onHot(null)}
      >
        <span>{verdict === "accepted" ? "✓" : "—"}</span>
        <span className="truncate">{target}</span>
      </div>
    );
  }

  return (
    <div
      ref={register}
      className="mb-2 py-1 pl-2"
      onMouseEnter={() => onHot(proposal.id)}
      onMouseLeave={() => onHot(null)}
      style={{
        borderLeft: "1.5px solid var(--pe-blue)",
        background: hot
          ? "color-mix(in srgb, var(--pe-blue) 7%, transparent)"
          : flashing
            ? "color-mix(in srgb, var(--pe-blue) 12%, transparent)"
            : "transparent",
        transition: "background 0.3s",
      }}
      title="A pea proposal — ephemeral and page-scoped. It is not in the document and never will be; accepting is what writes the value, and leaving the page throws the proposal away."
    >
      <div className="tele text-[9px] text-[var(--slate)]">{target}</div>
      <div className="tele text-[11px] text-[var(--pe-blue)]">
        {proposal.current ?? "—"} → {proposal.proposed}
      </div>
      <p className="mt-1 text-[10px] leading-snug text-[var(--foreground)]">{proposal.note}</p>
      {block && (
        <p
          className="tele mt-1 line-clamp-3 whitespace-pre-line text-[9px] leading-snug text-[var(--slate)]"
          title={`Read from ${SPEC?.fileName ?? "the spec"} block ${block.id}, page ${block.page}. This is the source text verbatim — the claim is checkable without leaving the page.`}
        >
          {block.md}
        </p>
      )}
      <div className="mt-1 flex gap-1">
        <button
          type="button"
          onClick={onAccept}
          title={`Write ${proposal.proposed} into the sheet for ${target}. The typeset table changes under you — that IS the accept; there is no separate save in this prototype.`}
          className="tele rounded-[2px] border border-[var(--pe-blue)] px-1.5 text-[9px] text-[var(--pe-blue)]"
        >
          accept
        </button>
        <button
          type="button"
          onClick={onDeny}
          title="Throw the proposal away and keep the sheet as authored. Nothing is written, and the note collapses to a struck mark so the margin still records that it was answered."
          className="tele rounded-[2px] border border-[var(--line-2)] px-1.5 text-[9px] text-[var(--slate)]"
        >
          deny
        </button>
      </div>
    </div>
  );
}

function DriftNote({
  drift,
  state,
  hot,
  onHot,
}: {
  drift: Drift;
  state: DriftState;
  hot: boolean;
  onHot: (key: string | null) => void;
}) {
  const settled = state !== "open";
  return (
    <div
      className="mb-2 py-1 pr-2 text-right"
      onMouseEnter={() => onHot(drift.key)}
      onMouseLeave={() => onHot(null)}
      style={{
        borderRight: `1.5px solid ${settled ? "var(--cat-green)" : "var(--clay)"}`,
        background: hot ? "color-mix(in srgb, var(--clay) 7%, transparent)" : "transparent",
        transition: "background 0.3s",
      }}
      title={
        settled
          ? state === "captured"
            ? `Resolved by capture — the sheet was rewritten to Revit's ${drift.live}, so the two agree because the document moved.`
            : `Resolved by materialize — the sheet was pushed at Revit, so the two agree because Revit moved.`
          : `Revit carries ${drift.live} for ${drift.param} on the ${drift.typeName} type, and this sheet does not. A drift is not a proposal: it is answered by an act — capture pulls Revit's number into the document, materialize pushes the document's number at Revit.`
      }
    >
      <div className="tele text-[9px] text-[var(--slate)]">
        {drift.param} · {drift.typeName}
      </div>
      <div
        className="tele text-[11px]"
        style={{ color: settled ? "var(--cat-green)" : "var(--clay)" }}
      >
        {settled ? (state === "captured" ? "captured" : "materialized") : `Revit: ${drift.live}`}
      </div>
      {!settled && (
        <p className="mt-0.5 text-[10px] leading-snug text-[var(--clay-ink)]">
          apply or capture to settle
        </p>
      )}
    </div>
  );
}

// ── the sheet's rows ────────────────────────────────────────────────────────────────────────────

/** One document row across the full width: left margin (drift), sheet, right margin (proposals).
 * The centre cell carries the paper and the frame, so the rows stack into one continuous page. */
function Row({
  left,
  right,
  children,
  edge,
}: {
  left?: React.ReactNode;
  right?: React.ReactNode;
  children: React.ReactNode;
  edge?: "top" | "bottom";
}) {
  return (
    <div className="grid grid-cols-[200px_minmax(0,720px)_240px] justify-center">
      <div className="pr-3 pt-6">{left}</div>
      <div
        className="px-10 py-5"
        style={{
          background: "var(--paper)",
          borderLeft: "0.5px solid var(--line)",
          borderRight: "0.5px solid var(--line)",
          borderTop: edge === "top" ? "0.5px solid var(--line)" : undefined,
          borderBottom: edge === "bottom" ? "0.5px solid var(--line)" : undefined,
        }}
      >
        {children}
      </div>
      <div className="pl-3 pt-6">{right}</div>
    </div>
  );
}

export function VariantD() {
  const [sheet, setSheet] = useState<Sheet>(initialSheet);
  const [verdicts, setVerdicts] = useState<Record<string, ProposalVerdict>>({});
  const [drifts, setDrifts] = useState<Record<string, DriftState>>({});
  const [stamp, setStamp] = useState<string | null>(null);
  const [hotProposal, setHotProposal] = useState<string | null>(null);
  const [hotDrift, setHotDrift] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [target, setTarget] = useState("");
  const [receipt, setReceipt] = useState<{ text: string; atMs: number } | null>(null);
  const noteRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const verdictOf = (id: string): ProposalVerdict => verdicts[id] ?? "open";
  const driftOf = (key: string): DriftState => drifts[key] ?? "open";
  const openDrifts = DRIFTS.filter((drift) => driftOf(drift.key) === "open");
  const openProposals = WORLD.proposals.filter((proposal) => verdictOf(proposal.id) === "open");

  const blockById = useMemo(
    () => new Map((SPEC?.blocks ?? []).map((block) => [block.id, block] as const)),
    [],
  );

  // ── acts ──
  const accept = (proposal: ProtoProposal) => {
    setSheet((current) => {
      if (proposal.typeName) {
        const typeName = proposal.typeName;
        return {
          ...current,
          types: {
            ...current.types,
            [typeName]: { ...current.types[typeName], [proposal.param]: proposal.proposed },
          },
        };
      }
      return { ...current, params: { ...current.params, [proposal.param]: proposal.proposed } };
    });
    setVerdicts((current) => ({ ...current, [proposal.id]: "accepted" }));
    setReceipt({ text: `accepted ${proposal.param} = ${proposal.proposed}`, atMs: Date.now() });
  };

  const deny = (proposal: ProtoProposal) => {
    setVerdicts((current) => ({ ...current, [proposal.id]: "denied" }));
  };

  /** capture — re-derive the document from what Revit actually carries. Drifted cells flip to
   * Revit's numbers, in place, in the typeset table. */
  const capture = () => {
    setSheet((current) => {
      const types = { ...current.types };
      for (const drift of DRIFTS) {
        if (driftOf(drift.key) !== "open") continue;
        types[drift.typeName] = { ...types[drift.typeName], [drift.param]: drift.live };
      }
      return { ...current, types };
    });
    setDrifts((current) => {
      const next = { ...current };
      for (const drift of DRIFTS)
        if ((next[drift.key] ?? "open") === "open") next[drift.key] = "captured";
      return next;
    });
    setStamp(null);
    setReceipt({
      text: `captured ${openDrifts.length} value${openDrifts.length === 1 ? "" : "s"} from ${LIVE?.worldLabel ?? "Revit"}`,
      atMs: Date.now(),
    });
  };

  /** materialize — push the sheet at Revit. The document does not move; the drifts do. */
  const materialize = () => {
    setDrifts((current) => {
      const next = { ...current };
      for (const drift of DRIFTS)
        if ((next[drift.key] ?? "open") === "open") next[drift.key] = "materialized";
      return next;
    });
    setStamp(null);
    setReceipt({
      text: `materialized ${WORLD.profile.familyName} into ${LIVE?.worldLabel ?? "Revit"}`,
      atMs: Date.now(),
    });
  };

  const buildProof = () => {
    setStamp(
      `proven against ${LIVE?.worldLabel ?? "a Revit world"} · ${openDrifts.length === 0 ? "fresh" : `${openDrifts.length} drift(s) unresolved`}`,
    );
    setReceipt({ text: "built proof for the profile", atMs: Date.now() });
  };

  const exportProfile = () => {
    setReceipt({ text: `exported ${WORLD.profile.path}`, atMs: Date.now() });
  };

  /** Clicking a spec block is navigation: scroll to the proposals it fathered and flash them. */
  const gotoBlock = (blockId: string) => {
    const proposal = WORLD.proposals.find((entry) => entry.sourceBlockId === blockId);
    if (!proposal) return;
    noteRefs.current[proposal.id]?.scrollIntoView({ block: "center", behavior: "smooth" });
    setFlash(proposal.id);
    window.setTimeout(() => setFlash(null), 1200);
  };

  // ── margin contents, bucketed by the section they argue about ──
  const proposalsFor = (section: string) =>
    WORLD.proposals.filter((proposal) => sectionOf(proposal.param, proposal.typeName) === section);

  const renderProposals = (section: string) =>
    proposalsFor(section).map((proposal) => (
      <ProposalNote
        key={proposal.id}
        proposal={proposal}
        block={blockById.get(proposal.sourceBlockId) ?? null}
        verdict={verdictOf(proposal.id)}
        hot={hotProposal === proposal.id}
        flashing={flash === proposal.id}
        onHot={setHotProposal}
        onAccept={() => accept(proposal)}
        onDeny={() => deny(proposal)}
        register={(node) => {
          noteRefs.current[proposal.id] = node;
        }}
      />
    ));

  const seal =
    openDrifts.length > 0
      ? `DRIFTING · ${openDrifts.length}`
      : `GROUNDED · ${WORLD.proposals.length - openProposals.length} link${
          WORLD.proposals.length - openProposals.length === 1 ? "" : "s"
        }`;

  // Every type × every parameter any type overrides — recomputed from the sheet, so accepting a
  // proposal that introduces an override makes a new row appear.
  const typeNames = Object.keys(sheet.types);
  const overriddenParams = WORLD.profile.params.filter((param) =>
    typeNames.some((typeName) => cellValue(sheet, param.name, typeName) != null),
  );

  const groups = GROUP_ORDER.map((group) => ({
    group,
    params: WORLD.profile.params.filter((param) => param.group === group),
  })).filter((entry) => entry.params.length > 0);

  // ── the source document, as a sibling ──
  const specRail = (
    <Pane
      kind="navigation"
      title="source"
      meta={SPEC?.fileName ?? "no spec attached"}
      className="border-r border-[var(--line)]"
    >
      <div className="space-y-2 p-3">
        <p className="text-[10px] leading-snug text-[var(--slate)]">
          The sibling document. Everything pea proposes in the right margin was read from a block
          here — click one to jump to the claim it fathered.
        </p>
        {(SPEC?.blocks ?? []).map((block) => {
          const linked = WORLD.proposals.filter((entry) => entry.sourceBlockId === block.id);
          return (
            <button
              key={block.id}
              type="button"
              onClick={() => gotoBlock(block.id)}
              title={
                linked.length > 0
                  ? `Page ${block.page} · ${block.kind}. ${linked.length} proposal${linked.length === 1 ? "" : "s"} on the sheet cite this block — clicking scrolls the margin to ${linked.map((entry) => entry.param).join(", ")} and flashes it.`
                  : `Page ${block.page} · ${block.kind}. Nothing on the sheet cites this block yet, so clicking has nowhere to go.`
              }
              className="block w-full rounded-[2px] border p-2 text-left"
              style={{
                borderColor: linked.length > 0 ? "var(--pe-blue)" : "var(--line-soft)",
                background: "transparent",
                cursor: linked.length > 0 ? "pointer" : "default",
              }}
            >
              <div className="tele flex items-baseline justify-between text-[9px] text-[var(--slate)]">
                <span>
                  {block.id} · p{block.page}
                </span>
                <span>{block.kind}</span>
              </div>
              <pre className="mt-1 whitespace-pre-wrap break-words font-sans text-[10px] leading-snug text-[var(--foreground)]">
                {block.md}
              </pre>
            </button>
          );
        })}
      </div>
    </Pane>
  );

  // ── the sheet ──
  const cutSheet = (
    <Pane kind="content" scroll="auto" className="bg-[var(--paper-2)]">
      <div className="pb-24 pt-6">
        {/* masthead */}
        <Row edge="top">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h1
                className="truncate text-[22px] leading-tight tracking-tight text-[var(--foreground)]"
                title="The family this document describes. The document is the portable unit — the name here is the profile's name, not a Revit element's."
              >
                {WORLD.profile.familyName}
              </h1>
              <p className="tele mt-1 text-[10px] text-[var(--slate)]">
                {WORLD.profile.category} · {WORLD.profile.template} · {WORLD.profile.placement}
              </p>
            </div>
            <span
              className="tele shrink-0 rounded-[2px] border px-1.5 py-0.5 text-[9px] tracking-[0.18em]"
              title={
                openDrifts.length > 0
                  ? `The seal reads DRIFTING because Revit disagrees with this sheet in ${openDrifts.length} place(s), listed in the left margin. Capture or materialize is what settles it.`
                  : "The seal reads GROUNDED: nothing in Revit disagrees with this sheet, and the links counted here are the spec claims the document has accepted."
              }
              style={{
                borderColor: openDrifts.length > 0 ? "var(--clay)" : "var(--cat-green)",
                color: openDrifts.length > 0 ? "var(--clay)" : "var(--cat-green)",
              }}
            >
              {seal}
            </span>
          </div>
        </Row>

        {/* parameters, one typeset table per group */}
        {groups.map((entry) => {
          const section = `group:${entry.group}`;
          return (
            <Row key={entry.group} right={renderProposals(section)}>
              <SectionHead
                title={GROUP_TITLE[entry.group] ?? entry.group}
                note={`${entry.params.length} parameter${entry.params.length === 1 ? "" : "s"}`}
              />
              <table className="w-full border-collapse">
                <tbody>
                  {entry.params.map((param) => (
                    <ParamRow
                      key={param.name}
                      param={param}
                      value={sheet.params[param.name] ?? param.value}
                      proposal={
                        WORLD.proposals.find(
                          (candidate) =>
                            candidate.param === param.name && candidate.typeName == null,
                        ) ?? null
                      }
                      verdictOf={verdictOf}
                      hot={hotProposal}
                      onHot={setHotProposal}
                      missing={LIVE?.missingParams.includes(param.name) ?? false}
                    />
                  ))}
                </tbody>
              </table>
            </Row>
          );
        })}

        {/* types — the one table where the margins are busiest */}
        <Row
          left={DRIFTS.map((drift) => (
            <DriftNote
              key={drift.key}
              drift={drift}
              state={driftOf(drift.key)}
              hot={hotDrift === drift.key}
              onHot={setHotDrift}
            />
          ))}
          right={renderProposals("types")}
        >
          <SectionHead
            title="Types"
            note={`${typeNames.length} types · blank inherits the family value`}
          />
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className="tele-label border-b border-[var(--line)] px-1 pb-1 text-left text-[9px] text-[var(--slate)]">
                  parameter
                </th>
                {typeNames.map((typeName) => (
                  <th
                    key={typeName}
                    className="tele-label border-b border-[var(--line)] px-1 pb-1 text-right text-[9px] text-[var(--slate)]"
                  >
                    {typeName}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {overriddenParams.map((param) => (
                <tr key={param.name}>
                  <td className="border-b border-[var(--line-soft)] px-1 py-1 text-[11px] text-[var(--foreground)]">
                    {param.name}
                  </td>
                  {typeNames.map((typeName) => {
                    const override = cellValue(sheet, param.name, typeName);
                    const proposal = WORLD.proposals.find(
                      (candidate) =>
                        candidate.param === param.name && candidate.typeName === typeName,
                    );
                    const verdict = proposal ? verdictOf(proposal.id) : null;
                    const drift = DRIFTS.find(
                      (entry) => entry.param === param.name && entry.typeName === typeName,
                    );
                    const driftLive = drift ? driftOf(drift.key) : null;
                    const lit =
                      (proposal != null && hotProposal === proposal.id) ||
                      (drift != null && hotDrift === drift.key);
                    return (
                      <td
                        key={typeName}
                        onMouseEnter={() => {
                          if (proposal) setHotProposal(proposal.id);
                          if (drift) setHotDrift(drift.key);
                        }}
                        onMouseLeave={() => {
                          setHotProposal(null);
                          setHotDrift(null);
                        }}
                        title={
                          override == null
                            ? `${typeName} does not override ${param.name} — it inherits the family value ${sheet.params[param.name] ?? param.value}. A blank cell is an inheritance, not a missing number.`
                            : `${typeName} overrides ${param.name} at ${override}.${
                                driftLive === "open" && drift
                                  ? ` Revit carries ${drift.live} — see the left margin.`
                                  : ""
                              }`
                        }
                        className="border-b border-[var(--line-soft)] px-1 py-1 text-right text-[11px]"
                        style={{
                          background: lit
                            ? "color-mix(in srgb, var(--pe-blue) 8%, transparent)"
                            : "transparent",
                          color: override == null ? "var(--muted-foreground)" : "var(--foreground)",
                          borderBottomColor:
                            verdict === "open"
                              ? "var(--pe-blue)"
                              : verdict === "accepted"
                                ? "var(--cat-green)"
                                : driftLive === "open"
                                  ? "var(--clay)"
                                  : "var(--line-soft)",
                          borderBottomWidth: verdict != null || driftLive === "open" ? 1.5 : 1,
                        }}
                      >
                        {override ?? sheet.params[param.name] ?? param.value}
                        {verdict === "open" && (
                          <span
                            className="ml-1 align-super text-[8px] text-[var(--pe-blue)]"
                            title="A pea proposal in the right margin targets this cell."
                          >
                            ‡
                          </span>
                        )}
                        {verdict === "accepted" && (
                          <span className="ml-1 align-super text-[8px] text-[var(--cat-green)]">
                            ✓
                          </span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </Row>

        {/* anatomy, typeset rather than drawn */}
        <Row>
          <SectionHead
            title="Anatomy"
            note={`${Object.keys(WORLD.profile.solids).length} solids · ${Object.keys(WORLD.profile.connectors).length} connectors`}
          />
          <dl className="space-y-1">
            {Object.entries(WORLD.profile.solids).map(([id, description]) => (
              <div key={id} className="flex items-baseline gap-3">
                <dt
                  className="tele w-28 shrink-0 text-[10px] text-[var(--clay-ink)]"
                  title="A solid constituent of the family, named by the profile. It is parametric: the dimensions beside it are parameter references, not literals."
                >
                  {id}
                </dt>
                <dd className="text-[11px] text-[var(--foreground)]">{description}</dd>
              </div>
            ))}
            {Object.entries(WORLD.profile.connectors).map(([id, description]) => (
              <div key={id} className="flex items-baseline gap-3">
                <dt
                  className="tele w-28 shrink-0 text-[10px] text-[var(--slate)]"
                  title="A connector the family publishes. Connectors are what make the family usable in a system, so they are part of the portable unit, not an afterthought."
                >
                  {id}
                </dt>
                <dd className="text-[11px] text-[var(--foreground)]">{description}</dd>
              </div>
            ))}
          </dl>
        </Row>

        {/* the live sheet's disagreements that are NOT per-cell drifts */}
        {LIVE && (
          <Row>
            <SectionHead title="Live correspondence" note={`read ${LIVE.readAgo}`} />
            <p
              className="text-[11px] leading-relaxed text-[var(--foreground)]"
              title="What the live family carries that this document does not, and the reverse. These are not drifts — no cell disagrees — they are shape differences between the portable unit and the thing in Revit."
            >
              <span className="tele text-[10px] text-[var(--slate)]">in Revit, not here — </span>
              {LIVE.extraParams.join(", ")}
              <span className="tele text-[10px] text-[var(--slate)]"> · here, not in Revit — </span>
              <span style={{ color: "var(--kiln)" }}>{LIVE.missingParams.join(", ")}</span>
            </p>
          </Row>
        )}

        {/* footer stamp */}
        <Row edge="bottom">
          <div className="mt-2 border-t border-[var(--line)] pt-2">
            <p className="tele flex flex-wrap items-baseline gap-x-3 text-[9px] text-[var(--slate)]">
              <span title="Where this profile lives. It is a file — copyable, versionable, movable between projects, which is the whole point of keeping the family as a document.">
                {WORLD.profile.path}
              </span>
              <span>profile · portable unit</span>
              {stamp ? (
                <span
                  style={{ color: "var(--cat-green)" }}
                  title="An evidence line stamped by the build act. It names what the document was proven against, so a number on this sheet can be traced to a Revit run rather than believed on faith."
                >
                  {stamp}
                </span>
              ) : (
                <span
                  style={{ color: "var(--kiln)" }}
                  title="No evidence line yet. Nothing on this sheet has been proven against a Revit build — press build proof to earn one."
                >
                  unproven
                </span>
              )}
            </p>
          </div>
        </Row>
      </div>
    </Pane>
  );

  return (
    <main className="flex h-screen min-h-0 flex-col bg-[var(--paper-2)] text-[var(--foreground)]">
      <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-[var(--line)] px-4 py-2">
        <span className="tele-label text-[10px] tracking-[0.3em] text-[var(--clay-ink)]">
          PROFILE
        </span>
        <Sentence
          prefix={
            openProposals.length > 0
              ? `reading ${openProposals.length} proposal${openProposals.length === 1 ? "" : "s"} against`
              : "reading"
          }
          prefixTone={openProposals.length > 0 ? "awaiting" : "rest"}
          documentLabel={WORLD.profile.path}
          documents={[WORLD.profile.path]}
          documentsEmpty="PROTOTYPE — the fixture carries exactly one profile."
          target={target}
          onBind={(selector) => setTarget(selector ?? "")}
          receipt={receipt}
        />
        <span
          className="tele shrink-0 rounded-[2px] border border-dashed border-[var(--line-2)] px-1 text-[10px] text-[var(--muted-foreground)]"
          title="PROTOTYPE — variant D of the /family clean room, running on a fixture. No host, no store, no network; every act mutates page-local state."
        >
          prototype · dossier
        </span>
      </header>

      {/* document acts — the toolbar is a masthead rule, not a control panel */}
      <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-[var(--line-soft)] px-4 py-1">
        <span className="tele text-[10px] text-[var(--slate)]">
          acts on this document — each one visibly rewrites it
        </span>
        <span className="ml-auto flex flex-wrap items-center gap-1.5">
          <Act
            label="capture from Revit"
            onClick={capture}
            disabled={openDrifts.length === 0}
            reason={
              openDrifts.length === 0
                ? "Nothing to capture — Revit and this sheet already agree on every cell."
                : `Re-derive the document from what ${LIVE?.worldLabel ?? "Revit"} actually carries. The ${openDrifts.length} drifted cell(s) in the left margin flip to Revit's numbers, in the table, where you can read the change.`
            }
          />
          <Act
            label="materialize → Revit"
            tone="commit"
            onClick={materialize}
            disabled={openDrifts.length === 0}
            reason={
              openDrifts.length === 0
                ? "Nothing to push — Revit already matches this sheet."
                : `Push this document at ${LIVE?.worldLabel ?? "Revit"}. The document does not move; Revit does, and the drift annotations settle. This is the one act that writes outside the document.`
            }
          />
          <Act
            label="build proof"
            onClick={buildProof}
            reason="Build this document into a real family and read the result back, stamping an evidence line into the footer. A stamped sheet is one whose numbers Revit actually produced."
          />
          <Act
            label="export profile"
            onClick={exportProfile}
            reason="Hand the profile over as a file. The whole point of keeping the family as a document is that it travels — this is the act that moves it."
          />
        </span>
      </div>

      <PaneSplit
        className="min-h-0 flex-1"
        axis="horizontal"
        resize={{
          target: "start",
          defaultSize: 320,
          minSize: 220,
          maxSize: 520,
          minOtherSize: 640,
          persist: "pe.proto.d.spec-width",
        }}
        start={specRail}
        end={cutSheet}
      />
    </main>
  );
}

/** One typeset parameter line. A formula reads as a formula; a proposal marks the value it
 * argues about, so the margin note and the cell are two views of one claim. */
function ParamRow({
  param,
  value,
  proposal,
  verdictOf,
  hot,
  onHot,
  missing,
}: {
  param: ProtoParam;
  value: string;
  proposal: ProtoProposal | null;
  verdictOf: (id: string) => ProposalVerdict;
  hot: string | null;
  onHot: (id: string | null) => void;
  missing: boolean;
}) {
  const verdict = proposal ? verdictOf(proposal.id) : null;
  const lit = proposal != null && hot === proposal.id;
  const isFormula = value.trimStart().startsWith("=");

  return (
    <tr
      onMouseEnter={() => proposal && onHot(proposal.id)}
      onMouseLeave={() => onHot(null)}
      style={{ background: lit ? "color-mix(in srgb, var(--pe-blue) 6%, transparent)" : undefined }}
    >
      <td
        className="border-b border-[var(--line-soft)] px-1 py-1 text-[11px] text-[var(--foreground)]"
        title={
          param.isInstance === true
            ? "An INSTANCE parameter: every placed instance carries its own value, so the number on this sheet is a default, not a fact about the family."
            : "A TYPE parameter: the value belongs to the family and its types, so the sheet's number is the number."
        }
      >
        {param.name}
        {param.isInstance === true && (
          <span className="tele ml-1 text-[9px] text-[var(--slate)]">inst</span>
        )}
        {missing && (
          <span
            className="tele ml-1 text-[9px]"
            style={{ color: "var(--kiln)" }}
            title="This parameter exists in the document but not in the live family. Materializing is what would give Revit one."
          >
            not in Revit
          </span>
        )}
      </td>
      <td className="tele border-b border-[var(--line-soft)] px-1 py-1 text-right text-[9px] text-[var(--slate)]">
        {param.dataType}
      </td>
      <td
        className="border-b px-1 py-1 text-right text-[11px]"
        style={{
          color: isFormula ? "var(--slate)" : "var(--foreground)",
          fontStyle: isFormula ? "italic" : undefined,
          borderBottomColor:
            verdict === "open"
              ? "var(--pe-blue)"
              : verdict === "accepted"
                ? "var(--cat-green)"
                : "var(--line-soft)",
          borderBottomWidth: verdict != null && verdict !== "denied" ? 1.5 : 1,
        }}
        title={
          isFormula
            ? "A formula, not a literal. What Revit computes from it is only knowable by building — the sheet shows the authored expression because that is what the document actually holds."
            : "The family-level value. A type may override it; the Types table below is where that is visible."
        }
      >
        {value}
        {verdict === "open" && (
          <span className="ml-1 align-super text-[8px] text-[var(--pe-blue)]">‡</span>
        )}
        {verdict === "accepted" && (
          <span className="ml-1 align-super text-[8px] text-[var(--cat-green)]">✓</span>
        )}
      </td>
    </tr>
  );
}
