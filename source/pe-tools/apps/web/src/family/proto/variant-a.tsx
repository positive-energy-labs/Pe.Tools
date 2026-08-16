/**
 * PROTOTYPE — throwaway, variant A of the /family clean room.
 *
 * THESIS: the page IS the duality. Two facing columns — PROFILE (the portable family.json)
 * on the left, LIVE (the family open in Revit) on the right — and a narrow SPINE between
 * them. Every verb is a CROSSING and every crossing lives in the spine, drawn as a direction:
 * `← capture` pulls Revit's number into the profile, `apply →` pushes the authored number into
 * Revit. The spine also renders the per-parameter verdict — agree, drift, only-one-side — so
 * the reconciliation state is read at the seam, not hunted for in either column.
 *
 * One scrolling grid owns all three columns, because ROW ALIGNMENT is the whole argument: a
 * profile row and its live row must sit on the same baseline or the spine mark means nothing.
 *
 * Nothing here talks to a host. Every verb mutates local copies of the fixture, immediately,
 * so the flow can be judged rather than imagined.
 */
import { useMemo, useState } from "react";

import { Sentence, type SlotSpec } from "#/components/sentence";
import { Pane, PaneSplit } from "#/components/ui/pane";
import {
  WORLD,
  WORLD_PROFILE_ONLY,
  type ProposalVerdict,
  type ProtoLive,
  type ProtoLiveValue,
  type ProtoParam,
} from "#/family/proto/world";
import { cn } from "#/lib/utils";

// ── seeds ───────────────────────────────────────────────────────────────────────────────────────

const LIVE_SEED: ProtoLive = WORLD.live ?? {
  familyName: "",
  worldLabel: "",
  readAgo: "",
  values: {},
  extraParams: [],
  missingParams: [],
};

/** The verdict the spine renders for one parameter, at the type on stage. */
type Agreement = "agree" | "drift" | "derived" | "only-profile" | "only-live" | "unread";

interface Row {
  param: string;
  group: string;
  dataType: string | null;
  isInstance: boolean;
  /** Resolved for the type on stage: the type override, else the family-level value. */
  profileValue: string | null;
  /** True when the value came from a type override rather than the family-level value. */
  overridden: boolean;
  liveValue: string | null;
  liveReadOnly: boolean;
  state: Agreement;
}

const MARK: Record<Agreement, string> = {
  agree: "=",
  drift: "≠",
  derived: "ƒ",
  "only-profile": "◀ only",
  "only-live": "only ▶",
  unread: "·",
};

const MARK_TITLE: Record<Agreement, string> = {
  agree: "The profile and Revit carry the same value for this parameter at this type. Nothing to cross; the verbs would be no-ops.",
  drift: "DRIFT — the profile and Revit disagree here. Click to open the reconciliation strip and pick which side wins; nothing crosses until you do.",
  derived:
    "Derived — the profile authors this as a formula, so Revit's number is an OUTPUT, not a competing value. Neither direction is a crossing: capturing would overwrite the formula with a frozen number, applying would be writing to a read-only cell.",
  "only-profile":
    "The profile carries this parameter and Revit does not. Click to open the strip; applying it creates the parameter in the live family. Capturing is impossible — there is nothing on the right to read.",
  "only-live":
    "Revit carries this parameter and the profile does not. Click to open the strip; capturing adopts it into the profile so it becomes portable. Applying is impossible — there is nothing on the left to write.",
  unread:
    "The last read of the live family did not report this parameter, so its live value is UNKNOWN, not absent. Re-read before treating the blank as agreement.",
};

const MARK_COLOR: Record<Agreement, string> = {
  agree: "var(--slate)",
  drift: "var(--clay)",
  derived: "var(--slate)",
  "only-profile": "var(--kiln)",
  "only-live": "var(--kiln)",
  unread: "var(--slate)",
};

// ── page ────────────────────────────────────────────────────────────────────────────────────────

export function VariantA() {
  /** The header toggle swaps the whole fixture, so the empty right column is a real state. */
  const [liveOn, setLiveOn] = useState(true);
  const world = liveOn ? WORLD : WORLD_PROFILE_ONLY;

  // Local copies of both substrates. Every verb writes here and nowhere else.
  const [params, setParams] = useState<ProtoParam[]>(world.profile.params);
  const [types, setTypes] = useState<Record<string, Record<string, string>>>(world.profile.types);
  const [values, setValues] = useState<Record<string, Record<string, ProtoLiveValue>>>(
    LIVE_SEED.values,
  );
  const [extra, setExtra] = useState<string[]>(LIVE_SEED.extraParams);
  const [missing, setMissing] = useState<string[]>(LIVE_SEED.missingParams);
  const [verdicts, setVerdicts] = useState<Record<string, ProposalVerdict>>({});

  const typeNames = Object.keys(types);
  const [stageType, setStageType] = useState<string>(typeNames[0] ?? "Standard");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [specCollapsed, setSpecCollapsed] = useState(false);
  const [receipt, setReceipt] = useState<{ text: string; atMs: number } | null>(null);

  const say = (text: string) => setReceipt({ text, atMs: Date.now() });

  // ── the aligned row model ──────────────────────────────────────────────────────────────────
  const rows = useMemo<Row[]>(() => {
    const authored: Row[] = params.map((param) => {
      const override = types[stageType]?.[param.name];
      const profileValue = override ?? param.value;
      const live = liveOn ? values[param.name]?.[stageType] : undefined;
      const state: Agreement = !live
        ? missing.includes(param.name) || !liveOn
          ? "only-profile"
          : "unread"
        : profileValue.startsWith("=")
          ? "derived"
          : profileValue === live.value
            ? "agree"
            : "drift";
      return {
        param: param.name,
        group: param.group ?? "other",
        dataType: param.dataType,
        isInstance: param.isInstance === true,
        profileValue,
        overridden: override != null,
        liveValue: live?.value ?? null,
        liveReadOnly: live?.readOnly === true,
        state,
      };
    });
    const adopted: Row[] = (liveOn ? extra : []).map((name) => ({
      param: name,
      group: "not in the profile",
      dataType: null,
      isInstance: false,
      profileValue: null,
      overridden: false,
      liveValue: values[name]?.[stageType]?.value ?? "—",
      liveReadOnly: false,
      state: "only-live" as const,
    }));
    return [...authored, ...adopted];
  }, [params, types, values, extra, missing, stageType, liveOn]);

  const driftRows = rows.filter((row) => row.state === "drift");

  // ── crossings ──────────────────────────────────────────────────────────────────────────────

  /** profile ← live. Writes the type override, dropping it when it merely restates the base. */
  const capture = (row: Row) => {
    if (row.liveValue == null) return;
    if (row.profileValue == null) {
      setParams((current) => [
        ...current,
        { name: row.param, dataType: "—", value: row.liveValue!, group: "adopted" },
      ]);
      setExtra((current) => current.filter((name) => name !== row.param));
      say(`adopted ${row.param} into the profile`);
      return;
    }
    const base = params.find((param) => param.name === row.param)?.value;
    setTypes((current) => {
      const next = { ...current, [stageType]: { ...current[stageType] } };
      if (row.liveValue === base) delete next[stageType]![row.param];
      else next[stageType]![row.param] = row.liveValue!;
      return next;
    });
    setExpanded(null);
    say(`captured ${row.param} · ${stageType} = ${row.liveValue}`);
  };

  /** live ← profile. The committing direction: this is the one that writes into Revit. */
  const apply = (row: Row) => {
    if (row.profileValue == null || row.profileValue.startsWith("=")) return;
    setValues((current) => ({
      ...current,
      [row.param]: { ...current[row.param], [stageType]: { value: row.profileValue! } },
    }));
    setMissing((current) => current.filter((name) => name !== row.param));
    setExpanded(null);
    say(`applied ${row.param} · ${stageType} = ${row.profileValue}`);
  };

  const captureAll = () => {
    for (const row of driftRows) capture(row);
    say(`captured ${driftRows.length} drifting value${driftRows.length === 1 ? "" : "s"}`);
  };

  const applyAll = () => {
    for (const row of driftRows) apply(row);
    say(`applied ${driftRows.length} drifting value${driftRows.length === 1 ? "" : "s"}`);
  };

  // ── proposals (ephemeral, page-scoped) ─────────────────────────────────────────────────────

  const openProposals = world.proposals.filter(
    (proposal) => (verdicts[proposal.id] ?? "open") === "open",
  );

  const acceptProposal = (id: string) => {
    const proposal = world.proposals.find((entry) => entry.id === id);
    if (!proposal) return;
    if (proposal.typeName) {
      setTypes((current) => ({
        ...current,
        [proposal.typeName!]: {
          ...current[proposal.typeName!],
          [proposal.param]: proposal.proposed,
        },
      }));
    } else {
      setParams((current) =>
        current.map((param) =>
          param.name === proposal.param ? { ...param, value: proposal.proposed } : param,
        ),
      );
    }
    setVerdicts((current) => ({ ...current, [id]: "accepted" }));
    say(`accepted pea's ${proposal.param} = ${proposal.proposed}`);
  };

  const denyProposal = (id: string) => {
    setVerdicts((current) => ({ ...current, [id]: "denied" }));
    say("denied a proposal — the profile is unchanged");
  };

  /** Which spec block a hovered row was read from — the grounding highlight. */
  const litBlock =
    world.proposals.find((proposal) => proposal.param === hovered)?.sourceBlockId ?? null;

  const slots: SlotSpec[] = [
    {
      key: "family",
      joiner: "—",
      text: liveOn ? LIVE_SEED.familyName : null,
      placeholder: "nothing live",
      options: null,
      title: liveOn
        ? "The family open in the bound Revit session. It is the right-hand column: the real, driftable thing the profile is trying to describe."
        : "No family is open in Revit, so there is no right-hand column to cross into. Open one and every verb in the spine wakes up.",
    },
  ];

  // ── the three-column body ──────────────────────────────────────────────────────────────────

  let lastGroup = "";
  const body = (
    <Pane kind="content" scroll="auto">
      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_170px_minmax(0,1fr)] items-stretch">
        {/* identity strips — what each substrate IS, one line each, and the spine's name */}
        <div className="sticky top-0 z-10 border-b border-[var(--line)] bg-[var(--paper)] px-3 py-1.5">
          <div className="tele-label text-[9px] tracking-[0.3em] text-[var(--clay-ink)]">
            PROFILE
          </div>
          <div
            className="tele truncate text-[10px] text-[var(--slate)]"
            title="The portable family.json. It is versionable, pea can propose into it, and it is grounded in the spec sheet at the bottom of this page. It is NOT what Revit currently has."
          >
            {world.profile.path}
          </div>
        </div>
        <div className="sticky top-0 z-10 border-x border-b border-[var(--line)] bg-[var(--paper)] px-2 py-1.5 text-center">
          <div className="tele-label text-[9px] tracking-[0.3em] text-[var(--slate)]">SPINE</div>
          <div
            className="tele text-[10px] text-[var(--slate)]"
            title="Every verb on this page is a crossing between the two columns, so every verb lives here, drawn as a direction. The marks below say, parameter by parameter, whether the two sides currently agree."
          >
            {driftRows.length > 0 ? (
              <span className="text-[var(--clay)]">{driftRows.length} drifting</span>
            ) : (
              "in agreement"
            )}
          </div>
        </div>
        <div className="sticky top-0 z-10 border-b border-[var(--line)] bg-[var(--paper)] px-3 py-1.5">
          <div className="tele-label text-[9px] tracking-[0.3em] text-[var(--clay-ink)]">LIVE</div>
          <div
            className="tele truncate text-[10px] text-[var(--slate)]"
            title="The family open in Revit right now. This is the proof: whatever it says is what the model actually contains, however long ago it was read."
          >
            {liveOn ? `${LIVE_SEED.worldLabel} · read ${LIVE_SEED.readAgo}` : "nothing open"}
          </div>
        </div>

        {/* the column-level crossings, in the spine, flanked by each side's stage note */}
        <div className="border-b border-[var(--line-soft)] px-3 py-1">
          <span
            className="tele text-[10px] text-[var(--slate)]"
            title="Which type's values both columns are showing. The profile authors overrides per type; Revit resolves per type. Comparing anything without naming a type is comparing nothing."
          >
            showing type
          </span>{" "}
          <span className="inline-flex items-center gap-1">
            {typeNames.map((name) => (
              <button
                key={name}
                type="button"
                onClick={() => setStageType(name)}
                title={`Put the ${name} type on stage. Both columns re-resolve to this type — the profile falls back to its family-level value where ${name} has no override, and Revit reports what that type actually carries.`}
                className={cn(
                  "tele h-5 rounded-[2px] border px-1.5 text-[10px]",
                  name === stageType
                    ? "border-[var(--line-2)] text-[var(--foreground)]"
                    : "border-transparent text-[var(--slate)] hover:border-[var(--line-soft)]",
                )}
              >
                {name}
              </button>
            ))}
          </span>
        </div>
        <div className="flex flex-col items-stretch gap-1 border-x border-b border-[var(--line-soft)] px-2 py-1">
          <Crossing
            label="← capture all"
            onClick={captureAll}
            disabled={driftRows.length === 0}
            reason={
              driftRows.length === 0
                ? "Nothing is drifting at this type, so there is nothing to pull back. Capture only ever moves values Revit and the profile disagree about."
                : `Let Revit win on all ${driftRows.length} drifting parameters: each live value is written into the profile as a ${stageType} override. Revit is not touched — this only changes the document.`
            }
          />
          <Crossing
            label="apply all →"
            tone="commit"
            onClick={applyAll}
            disabled={driftRows.length === 0}
            reason={
              driftRows.length === 0
                ? "Nothing is drifting at this type, so an apply would write values Revit already has."
                : `Let the profile win on all ${driftRows.length} drifting parameters: each authored value is written into the family open in Revit. This is the direction that MODIFIES the model, which is why it is the only thing on this page wearing the commit colour.`
            }
          />
          <Crossing
            label="⌃ ground from spec"
            onClick={() => {
              for (const proposal of openProposals) acceptProposal(proposal.id);
              say(`grounded ${openProposals.length} value${openProposals.length === 1 ? "" : "s"}`);
            }}
            disabled={openProposals.length === 0}
            reason={
              openProposals.length === 0
                ? "Pea has no open proposals against this spec — nothing is waiting to be grounded."
                : `Accept all ${openProposals.length} of pea's spec-backed proposals at once. Each writes the cut sheet's number into the profile and cites the block it came from. Revit is untouched, and nothing is saved until you cross right.`
            }
          />
          <Crossing
            label="build evidence ⌄"
            onClick={() => say("built the profile into an .rfa · 12 values proved")}
            reason="Build the profile into a real .rfa and read the numbers back out. This crosses out of the page entirely — it proves the LEFT column on its own terms, without asking the family currently open in Revit to agree."
          />
        </div>
        <div className="border-b border-[var(--line-soft)] px-3 py-1">
          <span
            className="tele text-[10px] text-[var(--slate)]"
            title="The live column is a snapshot. Revit is free to have moved on since it was read, so an old read is a weaker claim than a fresh one — the age is stated rather than implied."
          >
            {liveOn ? `snapshot · ${LIVE_SEED.readAgo}` : "no snapshot"}
          </span>
        </div>

        {/* ENTRY — with nothing live, the right column has no values to show, so the absence is
            announced once at the seam rather than repeated as a blank in every row. */}
        {!liveOn ? (
          <div className="col-span-3 border-b border-[var(--line-soft)] p-4">
            <div className="mx-auto max-w-md space-y-2 rounded-[2px] border border-[var(--line-2)] p-4">
              <div className="tele-label text-[9px] tracking-[0.3em] text-[var(--clay-ink)]">
                NOTHING LIVE
              </div>
              <p
                className="tele text-[11px] leading-relaxed text-[var(--slate)]"
                title="The profile can be edited, grounded, and built with no Revit at all. What it cannot do is DISAGREE with anything — drift is a relation, and there is only one side here."
              >
                The profile stands on its own, but there is nothing to cross into. Open a family in
                Revit, or pick one already loaded, and the right-hand column becomes the other half
                of this page.
              </p>
              <button
                type="button"
                onClick={() => setLiveOn(true)}
                title="Pretend a family was opened in Revit. In the real surface this opens the family editor on the bound session and reads a snapshot back; here it restores the fixture."
                className="tele h-6 rounded-[2px] border border-[var(--pe-blue)] px-2 text-[10px] text-[var(--pe-blue)] hover:bg-[var(--pe-blue)]/10"
              >
                open a family in Revit
              </button>
            </div>
          </div>
        ) : null}

        {/* the parameter rows, aligned across the seam */}
        {rows.map((row) => {
          const proposal = world.proposals.find(
            (entry) =>
              entry.param === row.param &&
              (entry.typeName == null || entry.typeName === stageType) &&
              (verdicts[entry.id] ?? "open") === "open",
          );
          const groupBreak = row.group !== lastGroup;
          lastGroup = row.group;
          const lit = hovered === row.param;
          return (
            <RowCells
              key={row.param}
              row={row}
              groupBreak={groupBreak}
              lit={lit}
              liveOn={liveOn}
              stageType={stageType}
              proposal={proposal ?? null}
              expanded={expanded === row.param}
              onHover={setHovered}
              onToggleExpand={() =>
                setExpanded((current) => (current === row.param ? null : row.param))
              }
              onCapture={() => capture(row)}
              onApply={() => apply(row)}
              onAccept={() => proposal && acceptProposal(proposal.id)}
              onDeny={() => proposal && denyProposal(proposal.id)}
            />
          );
        })}

        {/* the parameters the profile has and Revit does not, once applied, leave this list */}
        {liveOn && missing.length > 0 ? (
          <div className="col-span-3 border-t border-[var(--line-soft)] px-3 py-1">
            <span
              className="tele text-[10px] text-[var(--kiln)]"
              title="These parameters exist in the profile but not in the family open in Revit. Applying one creates it there; until then the profile is describing something the model does not have."
            >
              not in the live family: {missing.join(" · ")}
            </span>
          </div>
        ) : null}
      </div>
    </Pane>
  );

  // ── the spec band: where the left column's numbers claim to come from ──────────────────────

  const specBand = (
    <Pane
      kind="content"
      scroll="auto"
      title="SPEC"
      meta={
        world.spec
          ? `${world.spec.fileName} · ${world.spec.blocks.length} blocks`
          : "no spec attached"
      }
      actions={
        <button
          type="button"
          onClick={() => setSpecCollapsed((current) => !current)}
          title={
            specCollapsed
              ? "Show the OCR'd spec blocks again. Hovering a parameter row lights the block its value was read from, which is the only thing that makes a proposal checkable."
              : "Collapse the spec band. The grounding still exists — you just stop being able to see which block a number came from."
          }
          className="tele h-5 rounded-[2px] border border-[var(--line-2)] px-1.5 text-[10px] text-[var(--slate)] hover:border-[var(--pe-blue)]"
        >
          {specCollapsed ? "show" : "hide"}
        </button>
      }
    >
      {world.spec ? (
        <div className="flex flex-wrap items-start gap-2 p-2">
          {world.spec.blocks.map((block) => {
            const lit = block.id === litBlock;
            return (
              <div
                key={block.id}
                title={
                  lit
                    ? "This is the block the hovered parameter was read from. That correspondence is the whole claim a proposal makes — if the text does not say what the cell says, the proposal is wrong."
                    : `Page ${block.page} of the cut sheet, as OCR read it. Hover a parameter that pea has proposed against to see which block backs it.`
                }
                className={cn(
                  "tele max-w-[22rem] whitespace-pre-wrap rounded-[2px] border p-2 text-[10px] leading-relaxed",
                  lit
                    ? "border-[var(--pe-blue)] bg-[color-mix(in_srgb,var(--pe-blue)_6%,transparent)] text-[var(--foreground)]"
                    : "border-[var(--line-soft)] text-[var(--slate)]",
                )}
              >
                <span className="tele-label mr-1 text-[8px] tracking-[0.2em] text-[var(--slate)]">
                  P{block.page} {block.kind}
                </span>
                {block.md}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="p-3">
          <p
            className="tele text-[11px] text-[var(--slate)]"
            title="Without a spec, every number in the profile is asserted rather than sourced. Pea can still propose, but nothing it proposes can be checked against anything."
          >
            No spec sheet attached — the profile's numbers are unsourced.
          </p>
        </div>
      )}
    </Pane>
  );

  return (
    <main className="flex h-screen min-h-0 flex-col bg-[var(--paper)] text-[var(--foreground)]">
      <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-[var(--line)] px-4 py-2">
        <span className="tele-label text-[10px] tracking-[0.3em] text-[var(--clay-ink)]">
          CROSSING
        </span>
        <Sentence
          prefix={
            openProposals.length > 0
              ? `${openProposals.length} proposal${openProposals.length === 1 ? "" : "s"} against`
              : "reconciling"
          }
          prefixTone={openProposals.length > 0 ? "awaiting" : "rest"}
          documentLabel={world.profile.path}
          documents={[world.profile.path]}
          onPickDocument={() => say("the fixture carries exactly one profile")}
          documentsEmpty="This prototype ships one profile — the fixture has nothing else to bind."
          slots={slots}
          target=""
          onBind={() => say("binding is inert in this prototype")}
          receipt={receipt}
        />
        <button
          type="button"
          onClick={() => setLiveOn((current) => !current)}
          title={
            liveOn
              ? "Drop the live family, to see what this page is when only the profile exists: the right column becomes an entry card and every crossing verb refuses, because there is nothing on the other side to cross into."
              : "Restore the live family. The right column fills, the spine's marks come back, and the crossings become possible again."
          }
          className="tele h-6 shrink-0 rounded-[2px] border border-[var(--line-2)] px-2 text-[10px] text-[var(--slate)] hover:border-[var(--pe-blue)]"
        >
          {liveOn ? "drop the live family" : "restore the live family"}
        </button>
        <span
          className="tele ml-auto shrink-0 rounded-[2px] border border-dashed border-[var(--line-2)] px-1 text-[10px] text-[var(--slate)]"
          title="Prototype — a fixture, no host, no network. Every verb rewrites local state so the flow can be judged; nothing here would survive a reload."
        >
          prototype · fixture only
        </span>
      </header>

      <PaneSplit
        className="min-h-0 flex-1"
        axis="vertical"
        resize={{
          target: "end",
          defaultSize: 200,
          minSize: 34,
          minOtherSize: 280,
          collapse: {
            collapsed: specCollapsed,
            onCollapsedChange: setSpecCollapsed,
            collapsedSize: 34,
            collapseBelow: 90,
          },
        }}
        start={body}
        end={specBand}
      />
    </main>
  );
}

// ── pieces ──────────────────────────────────────────────────────────────────────────────────────

/** A crossing verb. Direction is in the label; the commit colour is spent only on the write. */
function Crossing({
  label,
  onClick,
  disabled,
  reason,
  tone,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  /** Say what the crossing MEANS and which side it changes — or why it refuses. */
  reason: string;
  tone?: "commit";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={reason}
      className={cn(
        "tele h-5 w-full rounded-[2px] border px-1 text-[10px]",
        disabled
          ? "cursor-not-allowed border-[var(--line-soft)] text-[var(--slate)] opacity-60"
          : tone === "commit"
            ? "border-[var(--pe-blue)] text-[var(--pe-blue)] hover:bg-[var(--pe-blue)]/10"
            : "border-[var(--line-2)] text-[var(--foreground)] hover:border-[var(--pe-blue)]",
      )}
    >
      {label}
    </button>
  );
}

interface RowCellsProps {
  row: Row;
  groupBreak: boolean;
  lit: boolean;
  liveOn: boolean;
  stageType: string;
  proposal: { id: string; proposed: string; note: string } | null;
  expanded: boolean;
  onHover: (param: string | null) => void;
  onToggleExpand: () => void;
  onCapture: () => void;
  onApply: () => void;
  onAccept: () => void;
  onDeny: () => void;
}

/** One parameter, spread across the seam. Three cells plus, when open, a strip spanning all. */
function RowCells({
  row,
  groupBreak,
  lit,
  liveOn,
  stageType,
  proposal,
  expanded,
  onHover,
  onToggleExpand,
  onCapture,
  onApply,
  onAccept,
  onDeny,
}: RowCellsProps) {
  const hover = {
    onMouseEnter: () => onHover(row.param),
    onMouseLeave: () => onHover(null),
  };
  const tint = lit ? "bg-[color-mix(in_srgb,var(--pe-blue)_4%,transparent)]" : undefined;
  const reconcilable =
    row.state === "drift" || row.state === "only-profile" || row.state === "only-live";

  return (
    <>
      {groupBreak ? (
        <div className="col-span-3 border-y border-[var(--line-soft)] px-3 pb-0.5 pt-1.5">
          <span className="tele-label text-[9px] tracking-[0.25em] text-[var(--slate)]">
            {row.group}
          </span>
        </div>
      ) : null}

      {/* PROFILE */}
      <div
        {...hover}
        className={cn("flex h-7 items-center gap-2 px-3", tint)}
        title={
          row.profileValue == null
            ? `The profile does not carry ${row.param}. It exists only in Revit, so it is not portable — capturing it is what makes it part of the document.`
            : row.overridden
              ? `The profile authors ${row.param} = ${row.profileValue} specifically for the ${stageType} type, overriding the family-level value.`
              : `The profile authors ${row.param} = ${row.profileValue} at family level; ${stageType} adds no override, so it inherits.`
        }
      >
        <span className="tele min-w-0 flex-1 truncate text-[11px]">
          {row.param}
          {row.isInstance ? (
            <span
              className="tele ml-1 text-[9px] text-[var(--slate)]"
              title="Instance parameter — every placed instance carries its own value, so the type's number is only the default."
            >
              inst
            </span>
          ) : null}
        </span>
        {proposal ? (
          <span className="flex items-center gap-1">
            <span
              className="tele rounded-[2px] border border-[var(--pe-blue)] bg-[color-mix(in_srgb,var(--pe-blue)_6%,transparent)] px-1 text-[10px] text-[var(--pe-blue)]"
              title={`Pea proposes ${proposal.proposed}. ${proposal.note} This lives only in this page — nothing is written until you accept it.`}
            >
              {proposal.proposed}
            </span>
            <button
              type="button"
              onClick={onAccept}
              title={`Write ${proposal.proposed} into the profile at ${stageType}. Only the document changes; Revit still has whatever it had, so accepting may CREATE drift you then have to cross.`}
              className="tele h-4 rounded-[2px] border border-[var(--pe-blue)] px-1 text-[9px] text-[var(--pe-blue)] hover:bg-[var(--pe-blue)]/10"
            >
              accept
            </button>
            <button
              type="button"
              onClick={onDeny}
              title="Drop the proposal. The profile is left exactly as it is, and pea's reading of the spec is discarded for this session."
              className="tele h-4 rounded-[2px] border border-[var(--line-2)] px-1 text-[9px] text-[var(--slate)] hover:border-[var(--clay)]"
            >
              deny
            </button>
          </span>
        ) : null}
        <span
          className={cn(
            "tele shrink-0 text-[11px]",
            row.profileValue == null ? "text-[var(--slate)]" : undefined,
            row.overridden ? "text-[var(--clay-ink)]" : undefined,
          )}
        >
          {row.profileValue ?? "—"}
        </span>
      </div>

      {/* SPINE */}
      <div
        {...hover}
        className={cn("flex h-7 items-center justify-center border-x border-[var(--line)]", tint)}
      >
        <button
          type="button"
          onClick={reconcilable ? onToggleExpand : undefined}
          title={MARK_TITLE[row.state]}
          className={cn(
            "tele h-5 rounded-[2px] border px-1.5 text-[10px]",
            reconcilable
              ? "border-[var(--line-soft)] hover:border-[var(--clay)]"
              : "cursor-default border-transparent",
            expanded ? "border-[var(--clay)]" : undefined,
          )}
          style={{ color: MARK_COLOR[row.state] }}
        >
          {MARK[row.state]}
        </button>
      </div>

      {/* LIVE */}
      <div
        {...hover}
        className={cn("flex h-7 items-center gap-2 px-3", tint)}
        title={
          !liveOn
            ? "Nothing is open in Revit, so there is no live value — not a blank one, an absent one."
            : row.liveValue == null
              ? `The last read did not report ${row.param}. Treat that as unknown rather than as agreement.`
              : row.liveReadOnly
                ? `Revit computes ${row.param} = ${row.liveValue} from a formula. It cannot be written; the way to change it is to change what feeds it.`
                : `The family open in Revit carries ${row.param} = ${row.liveValue} at ${stageType}. This is what the model actually contains.`
        }
      >
        <span
          className={cn(
            "tele shrink-0 text-[11px]",
            row.liveValue == null ? "text-[var(--slate)]" : undefined,
            row.state === "drift" ? "text-[var(--clay)]" : undefined,
          )}
        >
          {row.liveValue ?? "—"}
        </span>
        {row.liveReadOnly ? (
          <span
            className="tele text-[9px] text-[var(--slate)]"
            title="Read-only in Revit — a formula output. Applying into it would be refused by the host."
          >
            computed
          </span>
        ) : null}
        <span className="tele min-w-0 flex-1 truncate text-right text-[10px] text-[var(--slate)]">
          {row.profileValue == null ? row.param : (row.dataType ?? "")}
        </span>
      </div>

      {/* the reconciliation strip — one row, spanning the seam, so nothing shifts sideways */}
      {expanded ? (
        <div className="col-span-3 flex items-center gap-2 border-y border-[var(--line-soft)] bg-[color-mix(in_srgb,var(--clay)_3%,transparent)] px-3 py-1">
          <span
            className="tele text-[10px] text-[var(--clay-ink)]"
            title="Reconciling means deciding which substrate is right. There is no merge — one side's number replaces the other's."
          >
            {row.param} · {stageType} — pick the side that is right
          </span>
          <button
            type="button"
            onClick={onCapture}
            disabled={row.liveValue == null}
            title={
              row.liveValue == null
                ? "Nothing on the live side to capture — Revit has no value for this parameter."
                : row.profileValue == null
                  ? `Adopt ${row.param} into the profile with Revit's value ${row.liveValue}. That is what makes it portable; Revit is not modified.`
                  : `Let Revit win: write ${row.liveValue} into the profile as a ${stageType} override. The document changes, the model does not.`
            }
            className={cn(
              "tele h-5 rounded-[2px] border px-1.5 text-[10px]",
              row.liveValue == null
                ? "cursor-not-allowed border-[var(--line-soft)] text-[var(--slate)] opacity-60"
                : "border-[var(--line-2)] text-[var(--foreground)] hover:border-[var(--pe-blue)]",
            )}
          >
            ← capture {row.liveValue ?? "nothing"}
          </button>
          <button
            type="button"
            onClick={onApply}
            disabled={row.profileValue == null || row.profileValue.startsWith("=")}
            title={
              row.profileValue == null
                ? "Nothing on the profile side to apply — the parameter exists only in Revit."
                : row.profileValue.startsWith("=")
                  ? "This is a formula in the profile. Applying it would ask Revit to accept an expression as a value; change what feeds the formula instead."
                  : `Let the profile win: write ${row.profileValue} into the family open in Revit. This MODIFIES the model, which is why it is the only button here in the commit colour.`
            }
            className={cn(
              "tele h-5 rounded-[2px] border px-1.5 text-[10px]",
              row.profileValue == null || row.profileValue.startsWith("=")
                ? "cursor-not-allowed border-[var(--line-soft)] text-[var(--slate)] opacity-60"
                : "border-[var(--pe-blue)] text-[var(--pe-blue)] hover:bg-[var(--pe-blue)]/10",
            )}
          >
            apply {row.profileValue ?? "nothing"} →
          </button>
          <button
            type="button"
            onClick={onToggleExpand}
            title="Close the strip and leave the drift standing. Nothing is decided by closing — the mark stays clay until one side wins."
            className="tele ml-auto h-5 rounded-[2px] border border-[var(--line-2)] px-1.5 text-[10px] text-[var(--slate)] hover:border-[var(--line-2)]"
          >
            leave it drifting
          </button>
        </div>
      ) : null}
    </>
  );
}
