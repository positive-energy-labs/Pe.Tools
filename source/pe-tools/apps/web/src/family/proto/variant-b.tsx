/**
 * PROTOTYPE — throwaway, variant B of the /family clean room.
 *
 * STAGECRAFT. The thesis: a family is not a screen full of widgets, it is a run through four
 * STAGES — GROUND (the spec that justifies a value), AUTHOR (the profile that carries it),
 * PROVE (the evidence that it compiles), APPLY (the live family it lands in). Every pane
 * declares the stage it serves in its header tag, and a verb may only live in the pane that
 * owns its stage: parse/relink can never appear next to build, apply can never appear next to
 * accept. If you want to know where a verb is, you ask which stage it crosses.
 *
 * The JOURNEY BAR under the sentence is the map of those four stages, each carrying its own
 * live status facts. It is NOT a wizard: no station is ever locked, and clicking one only
 * changes which pane gets the room to work in. Tones are advisory — kiln for "this stage wants
 * attention", green for satisfied, muted for empty — and never block a click.
 *
 * All state is local to this page. Verbs mutate the useState copies and nothing else: accept
 * moves a proposal's value into the profile draft, apply clears a drift, capture pulls the live
 * value back into the draft, build stamps fake evidence. No network, no store.
 */
import { useMemo, useState } from "react";

import { MasterTable } from "#/components/master-table/master-table";
import type { Column } from "#/components/master-table/model";
import { Sentence, type SlotSpec } from "#/components/sentence";
import { Pane, PaneSplit, PaneWorkspace, type PaneSizeSpec } from "#/components/ui/pane";
import { WORLD, type ProposalVerdict } from "#/family/proto/world";
import { cn } from "#/lib/utils";

// ── stages ──────────────────────────────────────────────────────────────────────────────────────

type Stage = "ground" | "author" | "prove" | "apply";

const STAGE_BLURB: Record<Stage, string> = {
  ground: "GROUND — the spec document that justifies a value. Owns parse and relink.",
  author: "AUTHOR — the portable profile (family.json). Owns editing and proposal verdicts.",
  prove: "PROVE — evidence that the profile compiles to a real .rfa. Owns build.",
  apply: "APPLY — the live family in Revit. Owns apply, capture, and the drift list.",
};

const TYPES = Object.keys(WORLD.profile.types);
const LIVE = WORLD.live;
const SPEC = WORLD.spec;

/** A drift is one (parameter, type) cell where Revit disagrees with the authored profile. */
interface Drift {
  key: string;
  param: string;
  typeName: string;
  live: string;
}

const DRIFTS: Drift[] = LIVE
  ? Object.entries(LIVE.values).flatMap(([param, byType]) =>
      Object.entries(byType)
        .filter(([, cell]) => cell.drift)
        .map(([typeName, cell]) => ({
          key: `${param}::${typeName}`,
          param,
          typeName,
          live: cell.value,
        })),
    )
  : [];

// ── draft (the local profile copy every verb writes into) ────────────────────────────────────────

interface Draft {
  /** paramName → family-level value */
  family: Record<string, string>;
  /** typeName → paramName → override */
  types: Record<string, Record<string, string>>;
}

function initialDraft(): Draft {
  const family: Record<string, string> = {};
  for (const param of WORLD.profile.params) family[param.name] = param.value;
  const types: Record<string, Record<string, string>> = {};
  for (const [name, overrides] of Object.entries(WORLD.profile.types))
    types[name] = { ...overrides };
  return { family, types };
}

/** What a type column actually resolves to: its own override, else the family-level value. */
function effective(draft: Draft, param: string, typeName: string) {
  const own = draft.types[typeName]?.[param];
  return { value: own ?? draft.family[param] ?? "", inherited: own === undefined };
}

// ── small shared parts ──────────────────────────────────────────────────────────────────────────

function Verb({
  label,
  onClick,
  reason,
  tone,
  small,
}: {
  label: string;
  onClick: () => void;
  /** Say what the verb MEANS and what pressing it DOES — every element explains itself. */
  reason: string;
  /** "commit" is a verb that writes outside the profile: it wears the one pe-blue. */
  tone?: "commit";
  small?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={reason}
      className={cn(
        "tele shrink-0 rounded-[2px] border",
        small ? "h-5 px-1.5" : "h-6 px-2",
        tone === "commit"
          ? "border-[var(--pe-blue)] text-[var(--pe-blue)] hover:bg-[var(--pe-blue)]/10"
          : "border-[var(--line-2)] text-foreground hover:border-[var(--pe-blue)]",
      )}
    >
      {label}
    </button>
  );
}

/** The stage tag every pane header wears, foreground-lit while that stage holds the room. */
function StageTag({ stage, detail, focused }: { stage: Stage; detail: string; focused: boolean }) {
  return (
    <span title={STAGE_BLURB[stage]} style={{ color: focused ? "var(--foreground)" : undefined }}>
      {stage.toUpperCase()} · {detail}
    </span>
  );
}

type Tone = "ok" | "attention" | "empty";

const TONE_COLOR: Record<Tone, string> = {
  ok: "var(--cat-green)",
  attention: "var(--kiln)",
  empty: "var(--muted-foreground)",
};

function Station({
  stage,
  fact,
  tone,
  focused,
  onFocus,
}: {
  stage: Stage;
  fact: string;
  tone: Tone;
  focused: boolean;
  onFocus: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onFocus}
      title={`${STAGE_BLURB[stage]} Click to give this stage's pane the room — nothing is locked, and no other stage is disabled.`}
      className="flex min-w-0 flex-1 flex-col items-start gap-0.5 border-r border-[var(--line-soft)] px-2 py-1 text-left last:border-r-0 hover:bg-[var(--paper-2)]"
      style={{ background: focused ? "var(--paper-2)" : undefined }}
    >
      <span
        className="tele-label"
        style={{ color: focused ? "var(--foreground)" : "var(--muted-foreground)" }}
      >
        {stage}
      </span>
      <span className="tele min-w-0 truncate" style={{ color: TONE_COLOR[tone] }}>
        {fact}
      </span>
    </button>
  );
}

function Fact({ children, tone = "empty" }: { children: string; tone?: Tone }) {
  return (
    <div className="tele" style={{ color: TONE_COLOR[tone] }}>
      {children}
    </div>
  );
}

// ── the page ────────────────────────────────────────────────────────────────────────────────────

interface MatrixRow {
  name: string;
  dataType: string;
  group: string;
  isInstance: boolean;
}

export function VariantB() {
  const [draft, setDraft] = useState<Draft>(initialDraft);
  const [verdicts, setVerdicts] = useState<Record<string, ProposalVerdict>>({});
  const [settled, setSettled] = useState<Record<string, "applied" | "captured">>({});
  const [evidence, setEvidence] = useState<{ serial: number; note: string } | null>(null);
  const [parses, setParses] = useState(0);
  const [links, setLinks] = useState(WORLD.proposals.length);
  const [stage, setStage] = useState<Stage>("author");
  const [hoverBlock, setHoverBlock] = useState<string | null>(null);
  const [hoverDrift, setHoverDrift] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [editCell, setEditCell] = useState<string | null>(null);
  const [activeType, setActiveType] = useState<string>(TYPES[1] ?? "");
  const [target, setTarget] = useState("");

  const openProposals = WORLD.proposals.filter((p) => (verdicts[p.id] ?? "open") === "open");
  const liveDrifts = DRIFTS.filter((d) => settled[d.key] === undefined);

  /** proposal lookup by the cell it targets — `param::typeName` ("" for the family-level cell). */
  const proposalByCell = useMemo(() => {
    const map = new Map<string, (typeof WORLD.proposals)[number]>();
    for (const proposal of WORLD.proposals)
      map.set(`${proposal.param}::${proposal.typeName ?? ""}`, proposal);
    return map;
  }, []);

  const accept = (id: string) => {
    const proposal = WORLD.proposals.find((p) => p.id === id);
    if (!proposal) return;
    setDraft((current) => {
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
      return { ...current, family: { ...current.family, [proposal.param]: proposal.proposed } };
    });
    setVerdicts((current) => ({ ...current, [id]: "accepted" }));
  };

  const deny = (id: string) => setVerdicts((current) => ({ ...current, [id]: "denied" }));

  const applyDrift = (drift: Drift) =>
    setSettled((current) => ({ ...current, [drift.key]: "applied" }));

  const captureDrift = (drift: Drift) => {
    setDraft((current) => ({
      ...current,
      types: {
        ...current.types,
        [drift.typeName]: { ...current.types[drift.typeName], [drift.param]: drift.live },
      },
    }));
    setSettled((current) => ({ ...current, [drift.key]: "captured" }));
  };

  const setCell = (param: string, typeName: string | null, value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return;
    setDraft((current) =>
      typeName
        ? {
            ...current,
            types: {
              ...current.types,
              [typeName]: { ...current.types[typeName], [param]: trimmed },
            },
          }
        : { ...current, family: { ...current.family, [param]: trimmed } },
    );
  };

  // Stage focus is layout, not permission: the chosen stage's pane simply gets the room.
  const visualSpec = useMemo<PaneSizeSpec>(
    () =>
      stage === "prove" || stage === "apply"
        ? { defaultSize: 260, minSize: 200, maxSize: 460 }
        : { defaultSize: 104, minSize: 84, maxSize: 150 },
    [stage],
  );
  const inspectorSpec = useMemo<PaneSizeSpec>(
    () =>
      stage === "ground"
        ? { defaultSize: 520, minSize: 420, maxSize: 760 }
        : { defaultSize: 300, minSize: 240, maxSize: 360 },
    [stage],
  );

  const slots: SlotSpec[] = [
    {
      key: "family",
      joiner: "—",
      text: WORLD.profile.familyName,
      placeholder: "no family",
      options: null,
      title:
        "The family this profile describes. It is the profile's own identity, so there is nothing to pick — rebinding the document is what changes it.",
    },
    {
      key: "type",
      joiner: "· type",
      text: activeType,
      placeholder: "pick a type",
      options: TYPES.map((name) => ({
        id: name,
        label: name,
        sub: `${Object.keys(draft.types[name] ?? {}).length} overrides`,
      })),
      onPick: setActiveType,
      title:
        "The type the surfaces speak about first — the matrix tints its column and the apply strip counts its drifts.",
    },
    {
      key: "live",
      joiner: "· against live",
      text: LIVE?.worldLabel ?? null,
      placeholder: "nothing live",
      options: null,
      title:
        "The Revit document carrying the live family this profile is measured against. Drift is the difference between the two.",
    },
  ];

  const columns: Column<MatrixRow>[] = [
    {
      key: "param",
      label: "parameter",
      title: "The authored parameter name — the profile's stable key for this row.",
      lock: true,
      width: "w-52",
      sort: (row) => row.name,
      search: (row) => row.name,
      facet: (row) => row.group,
      all: "every group",
      cell: (row) => (
        <span
          className="tele"
          title={`${row.name} · ${row.group}${row.isInstance ? " · instance" : ""}`}
        >
          {row.name}
        </span>
      ),
    },
    {
      key: "dataType",
      label: "data type",
      title: "The parameter's storage type — what values the cell is allowed to hold.",
      width: "w-32",
      facet: (row) => row.dataType,
      all: "every data type",
      cell: (row) => (
        <span className="tele text-muted-foreground" title={`Stored as ${row.dataType}.`}>
          {row.dataType}
        </span>
      ),
    },
    {
      key: "family",
      label: "family value",
      title:
        "The family-level value every type inherits unless it overrides it. Formulas start with '='.",
      width: "w-40",
      cell: (row) => (
        <ValueCell
          value={draft.family[row.name] ?? ""}
          inherited={false}
          editing={editing}
          cellKey={`${row.name}::`}
          editCell={editCell}
          setEditCell={setEditCell}
          commit={(next) => setCell(row.name, null, next)}
          proposal={proposalByCell.get(`${row.name}::`)}
          verdicts={verdicts}
          accept={accept}
          deny={deny}
          hoverBlock={hoverBlock}
          setHoverBlock={setHoverBlock}
          driftKey={null}
          hoverDrift={hoverDrift}
          label={`${row.name}, family level`}
        />
      ),
    },
    ...TYPES.map<Column<MatrixRow>>((typeName) => ({
      key: `type:${typeName}`,
      label: typeName,
      title: `Type ${typeName} — its own override where it has one, otherwise the family value it inherits.`,
      width: "w-36",
      headerClassName: typeName === activeType ? "bg-[var(--paper-2)]" : undefined,
      cell: (row) => {
        const resolved = effective(draft, row.name, typeName);
        const driftKey = `${row.name}::${typeName}`;
        return (
          <ValueCell
            value={resolved.value}
            inherited={resolved.inherited}
            editing={editing}
            cellKey={driftKey}
            editCell={editCell}
            setEditCell={setEditCell}
            commit={(next) => setCell(row.name, typeName, next)}
            proposal={proposalByCell.get(driftKey)}
            verdicts={verdicts}
            accept={accept}
            deny={deny}
            hoverBlock={hoverBlock}
            setHoverBlock={setHoverBlock}
            driftKey={settled[driftKey] === undefined ? driftKey : null}
            hoverDrift={hoverDrift}
            label={`${row.name}, type ${typeName}`}
          />
        );
      },
    })),
  ];

  const rows: MatrixRow[] = WORLD.profile.params.map((param) => ({
    name: param.name,
    dataType: param.dataType,
    group: param.group ?? "other",
    isInstance: param.isInstance === true,
  }));

  return (
    <div className="flex h-screen min-h-0 flex-col bg-[var(--paper)]">
      {/* Identity: the sentence and nothing else. Verbs belong to stages, and no stage lives here. */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-[var(--line-2)] px-2 py-1.5">
        <Sentence
          prefix="editing"
          documentLabel={WORLD.profile.path}
          documents={[WORLD.profile.path, "mechanical/vav-box-v21.family.json"]}
          documentsEmpty="No authored profiles yet — capture a live family to make the first one."
          slots={slots}
          target={target}
          onBind={(selector) => setTarget(selector ?? "")}
        />
      </div>

      {/* JOURNEY BAR — the four stages with their live facts. A map, never a gate. */}
      <div
        className="flex shrink-0 items-stretch border-b border-[var(--line-2)]"
        title="The four stages this family passes through. Every station is always clickable; clicking one gives that stage's pane the room below."
      >
        <Station
          stage="ground"
          fact={
            SPEC
              ? `${SPEC.fileName} · ${SPEC.blocks.length} blocks · ${links} links${parses > 0 ? " · parsed just now" : ""}`
              : "no spec bound"
          }
          tone={SPEC ? (links > 0 ? "ok" : "attention") : "empty"}
          focused={stage === "ground"}
          onFocus={() => setStage("ground")}
        />
        <Station
          stage="author"
          fact={`${WORLD.profile.params.length} params · ${TYPES.length} types · ${openProposals.length === 0 ? "no open proposals" : `${openProposals.length} open proposals`}`}
          tone={openProposals.length > 0 ? "attention" : "ok"}
          focused={stage === "author"}
          onFocus={() => setStage("author")}
        />
        <Station
          stage="prove"
          fact={evidence ? `build #${evidence.serial} · 0s ago · fresh` : "none built"}
          tone={evidence ? "ok" : "empty"}
          focused={stage === "prove"}
          onFocus={() => setStage("prove")}
        />
        <Station
          stage="apply"
          fact={
            LIVE
              ? `bound to ${LIVE.worldLabel} · ${liveDrifts.length === 0 ? "no drift" : `${liveDrifts.length} drifts`}`
              : "nothing live"
          }
          tone={LIVE ? (liveDrifts.length > 0 ? "attention" : "ok") : "empty"}
          focused={stage === "apply"}
          onFocus={() => setStage("apply")}
        />
      </div>

      <div className="min-h-0 flex-1">
        <PaneWorkspace
          inspectorSpan="full"
          resize={{ visual: visualSpec, inspector: inspectorSpec }}
          // PROVE and APPLY share one band: both are crossings OUT of the profile.
          visual={
            <PaneSplit
              axis="horizontal"
              resize={{ target: "start", defaultSize: 320, minSize: 220, minOtherSize: 280 }}
              start={
                <Pane
                  kind="visual"
                  scroll="auto"
                  title={<StageTag stage="prove" detail="evidence" focused={stage === "prove"} />}
                  meta={evidence ? `build #${evidence.serial} · fresh` : "never built"}
                  actions={
                    <Verb
                      label="build"
                      tone="commit"
                      reason="Compile the profile into a real .rfa and stamp the evidence with the moment it was proven. Nothing else in this page proves the profile is buildable."
                      onClick={() =>
                        setEvidence((current) => ({
                          serial: (current?.serial ?? 0) + 1,
                          note: `${WORLD.profile.familyName}.rfa · ${TYPES.length} types · ${WORLD.profile.params.length} params`,
                        }))
                      }
                    />
                  }
                >
                  <div className="flex flex-col gap-1 p-2">
                    {evidence ? (
                      <>
                        <Fact tone="ok">{`built 0s ago · fresh · build #${evidence.serial}`}</Fact>
                        <Fact>{evidence.note}</Fact>
                        <Fact>
                          {`${Object.keys(WORLD.profile.solids).length} solids · ${Object.keys(WORLD.profile.connectors).length} connectors compiled`}
                        </Fact>
                      </>
                    ) : (
                      <Fact>
                        no build yet — nothing here has proven this profile compiles to an .rfa
                      </Fact>
                    )}
                  </div>
                </Pane>
              }
              end={
                <Pane
                  kind="visual"
                  scroll="auto"
                  title={<StageTag stage="apply" detail="live" focused={stage === "apply"} />}
                  meta={LIVE ? `${LIVE.worldLabel} · read ${LIVE.readAgo}` : "nothing live"}
                  actions={
                    LIVE ? (
                      <>
                        <Verb
                          label="capture all"
                          reason="Pull every drifted live value back into the profile, making the profile agree with Revit. The profile changes; Revit does not."
                          onClick={() => liveDrifts.forEach(captureDrift)}
                        />
                        <Verb
                          label="apply"
                          tone="commit"
                          reason="Push every authored value into the live family, clearing all drift. This is the write that reaches Revit."
                          onClick={() => liveDrifts.forEach(applyDrift)}
                        />
                      </>
                    ) : null
                  }
                >
                  <div className="flex flex-col p-2">
                    {liveDrifts.length === 0 ? (
                      <Fact tone="ok">
                        {LIVE
                          ? "no drift — every live value agrees with the profile"
                          : "nothing live — bind a world to measure drift"}
                      </Fact>
                    ) : (
                      liveDrifts.map((drift) => (
                        <div
                          key={drift.key}
                          onMouseEnter={() => setHoverDrift(drift.key)}
                          onMouseLeave={() => setHoverDrift(null)}
                          title={`Revit carries ${drift.live} for ${drift.param} on type ${drift.typeName}; the profile authors ${effective(draft, drift.param, drift.typeName).value}. Apply overwrites Revit; capture overwrites the profile.`}
                          className="flex items-center gap-2 border-b border-[var(--line-soft)] py-1"
                        >
                          <span
                            className="tele min-w-0 flex-1 truncate"
                            style={{ color: "var(--clay-ink)" }}
                          >
                            {drift.param} · {drift.typeName} — live {drift.live} vs authored{" "}
                            {effective(draft, drift.param, drift.typeName).value}
                          </span>
                          <Verb
                            small
                            label="capture"
                            reason={`Take Revit's ${drift.live} into the profile as the authored value for ${drift.typeName}.`}
                            onClick={() => captureDrift(drift)}
                          />
                          <Verb
                            small
                            tone="commit"
                            label="apply"
                            reason={`Write the authored value into the live family, clearing this drift.`}
                            onClick={() => applyDrift(drift)}
                          />
                        </div>
                      ))
                    )}
                    {LIVE ? (
                      <div className="pt-1">
                        <Fact>{`${LIVE.extraParams.length} params exist only in Revit: ${LIVE.extraParams.join(", ")}`}</Fact>
                        <Fact>{`${LIVE.missingParams.length} authored params Revit does not carry: ${LIVE.missingParams.join(", ")}`}</Fact>
                      </div>
                    ) : null}
                  </div>
                </Pane>
              }
            />
          }
          content={
            <Pane
              kind="content"
              scroll="clip"
              title={<StageTag stage="author" detail="type matrix" focused={stage === "author"} />}
              meta={`${WORLD.profile.path} · ${openProposals.length} open proposals`}
              actions={
                <>
                  <Verb
                    label={editing ? "editing" : "edit"}
                    reason={
                      editing
                        ? "Editing is on — click any value cell to retype it. Click here to put the matrix back to read-only."
                        : "Turn the matrix's value cells into editable fields. Edits land in the profile draft only; nothing reaches Revit until apply."
                    }
                    onClick={() => {
                      setEditing((current) => !current);
                      setEditCell(null);
                    }}
                  />
                  <Verb
                    label="accept all"
                    reason="Take every open proposal's value into the profile at once. Pea's proposals are page-scoped; accepting is what makes one real."
                    onClick={() => openProposals.forEach((proposal) => accept(proposal.id))}
                  />
                  <Verb
                    label="deny all"
                    reason="Dismiss every open proposal without changing the profile. They are ephemeral; denying just clears the page."
                    onClick={() => openProposals.forEach((proposal) => deny(proposal.id))}
                  />
                </>
              }
            >
              <MasterTable
                rows={rows}
                columns={columns}
                rowKey={(row) => row.name}
                scopeLabel="parameters in this profile"
                searchPlaceholder="find a parameter"
                summary={
                  <span
                    className="tele text-muted-foreground"
                    title="What the AUTHOR stage currently carries: authored parameters, types, and proposals still awaiting a verdict."
                  >
                    {rows.length} params · {TYPES.length} types · {openProposals.length} open
                  </span>
                }
                empty="No parameter matches this filter — widen the group or clear the search."
              />
            </Pane>
          }
          inspector={
            <Pane
              kind="inspector"
              title={<StageTag stage="ground" detail="spec" focused={stage === "ground"} />}
              meta={SPEC ? `${SPEC.fileName} · ${SPEC.blocks.length} blocks` : "no spec"}
              actions={
                <>
                  <Verb
                    label="parse"
                    reason="Re-read the bound spec document into blocks. Nothing about the profile changes — this only refreshes what the spec is understood to say."
                    onClick={() => setParses((current) => current + 1)}
                  />
                  <Verb
                    label="relink"
                    reason="Recompute which profile cells each spec block justifies. Links are what let a proposal cite its source."
                    onClick={() => setLinks(WORLD.proposals.length)}
                  />
                </>
              }
            >
              {SPEC ? (
                <div className="flex flex-col gap-1">
                  {SPEC.blocks.map((block) => {
                    const linked = WORLD.proposals.filter((p) => p.sourceBlockId === block.id);
                    const lit = hoverBlock === block.id;
                    return (
                      <div
                        key={block.id}
                        onMouseEnter={() => setHoverBlock(block.id)}
                        onMouseLeave={() => setHoverBlock(null)}
                        title={`Block ${block.id}, page ${block.page}, ${block.kind}. ${linked.length === 0 ? "No profile cell cites it yet." : `Cited by ${linked.length} proposal(s) — hover to light the cells it justifies.`}`}
                        className="rounded-[2px] border p-1.5"
                        style={{
                          borderColor: lit ? "var(--pe-blue)" : "var(--line-soft)",
                          background: lit
                            ? "color-mix(in srgb, var(--pe-blue) 6%, transparent)"
                            : undefined,
                        }}
                      >
                        <div className="tele-label text-muted-foreground">
                          p{block.page} · {block.kind}
                          {linked.length > 0 ? ` · ${linked.length} linked` : ""}
                        </div>
                        <pre
                          className="tele mt-1 whitespace-pre-wrap break-words text-foreground"
                          style={{ fontSize: 10 }}
                        >
                          {block.md}
                        </pre>
                      </div>
                    );
                  })}
                  <Fact>{`${parses === 0 ? "parsed before this session" : `re-parsed ${parses}× just now`} · ${links} links to profile cells`}</Fact>
                </div>
              ) : (
                <Fact>no spec bound — nothing grounds these values yet</Fact>
              )}
            </Pane>
          }
        />
      </div>
    </div>
  );
}

// ── the AUTHOR cell ─────────────────────────────────────────────────────────────────────────────

/**
 * One value cell. It carries three orthogonal states without ever mixing their colors: a pe-blue
 * tint when a page-scoped proposal wants this cell, a clay outline while its live drift is
 * hovered in the APPLY pane, and muted text when the value is merely inherited.
 */
function ValueCell({
  value,
  inherited,
  editing,
  cellKey,
  editCell,
  setEditCell,
  commit,
  proposal,
  verdicts,
  accept,
  deny,
  hoverBlock,
  setHoverBlock,
  driftKey,
  hoverDrift,
  label,
}: {
  value: string;
  inherited: boolean;
  editing: boolean;
  cellKey: string;
  editCell: string | null;
  setEditCell: (key: string | null) => void;
  commit: (next: string) => void;
  proposal: (typeof WORLD.proposals)[number] | undefined;
  verdicts: Record<string, ProposalVerdict>;
  accept: (id: string) => void;
  deny: (id: string) => void;
  hoverBlock: string | null;
  setHoverBlock: (id: string | null) => void;
  driftKey: string | null;
  hoverDrift: string | null;
  label: string;
}) {
  const verdict = proposal ? (verdicts[proposal.id] ?? "open") : null;
  const open = verdict === "open";
  const litByBlock = proposal != null && hoverBlock === proposal.sourceBlockId;
  const litByDrift = driftKey != null && hoverDrift === driftKey;

  if (editing && editCell === cellKey) {
    return (
      <input
        autoFocus
        defaultValue={value}
        title={`Retype ${label}. Enter commits into the profile draft; Escape leaves it alone.`}
        onBlur={(event) => {
          commit(event.target.value);
          setEditCell(null);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            commit(event.currentTarget.value);
            setEditCell(null);
          }
          if (event.key === "Escape") setEditCell(null);
        }}
        className="tele w-full rounded-[2px] border border-[var(--pe-blue)] bg-transparent px-1 outline-none"
      />
    );
  }

  return (
    <div
      onMouseEnter={() => proposal && setHoverBlock(proposal.sourceBlockId)}
      onMouseLeave={() => proposal && setHoverBlock(null)}
      onClick={() => editing && setEditCell(cellKey)}
      title={
        open && proposal
          ? `Pea proposes ${proposal.proposed} here, cited from spec block ${proposal.sourceBlockId}. ${proposal.note} Accepting writes it into the profile; the proposal itself is never persisted.`
          : `${label} — ${value}${inherited ? ", inherited from the family value" : ", authored on this type"}.${editing ? " Click to retype it." : ""}`
      }
      className={cn(
        "flex items-center gap-1 rounded-[2px] px-1",
        editing && "cursor-text",
        litByBlock && "outline outline-1 outline-[var(--pe-blue)]",
        litByDrift && "outline outline-1 outline-[var(--clay-ink)]",
      )}
      style={{
        background: open ? "color-mix(in srgb, var(--pe-blue) 8%, transparent)" : undefined,
      }}
    >
      <span
        className="tele min-w-0 flex-1 truncate"
        style={{ color: inherited ? "var(--muted-foreground)" : "var(--foreground)" }}
      >
        {open && proposal ? proposal.proposed : value}
      </span>
      {open && proposal ? (
        <>
          <button
            type="button"
            title={`Accept: write ${proposal.proposed} into the profile as the value for ${label}.`}
            onClick={(event) => {
              event.stopPropagation();
              accept(proposal.id);
            }}
            className="tele rounded-[2px] border border-[var(--pe-blue)] px-1 text-[var(--pe-blue)] hover:bg-[var(--pe-blue)]/10"
          >
            ok
          </button>
          <button
            type="button"
            title="Deny: drop this proposal. The profile keeps the value it already has."
            onClick={(event) => {
              event.stopPropagation();
              deny(proposal.id);
            }}
            className="tele rounded-[2px] border border-[var(--line-2)] px-1 text-muted-foreground hover:border-[var(--line-2)]"
          >
            no
          </button>
        </>
      ) : null}
      {verdict === "accepted" ? (
        <span
          className="tele-label"
          style={{ color: "var(--cat-green)" }}
          title="This value came from an accepted proposal, cited from the spec."
        >
          grounded
        </span>
      ) : null}
    </div>
  );
}
