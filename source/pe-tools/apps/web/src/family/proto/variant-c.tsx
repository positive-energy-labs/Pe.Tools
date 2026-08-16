/**
 * PROTOTYPE — throwaway, variant C of the /family clean room.
 *
 * THE LEDGER. The thesis: the pipeline is not a set of panes, it is the X-AXIS of one table.
 * A family is a list of parameters (the rows) crossed with the STATIONS a value passes through,
 * left to right, in data-flow order:
 *
 *   SPEC ▸ PROPOSED ▸ PROFILE ▸ TYPES ▸ EVIDENCE ▸ LIVE
 *
 * Read a row left to right and you read the whole life of one number: what the cut sheet says,
 * what pea wants to do about it, what the profile authors, what each type overrides, what the
 * last build produced, and what Revit actually carries right now.
 *
 * The crossing verbs are therefore COLUMN verbs, and they live in the station headers — accept
 * over PROPOSED, capture ← over PROFILE, build over EVIDENCE, apply over LIVE. Every verb moves
 * data exactly one column, visibly: accept empties a PROPOSED cell into PROFILE or TYPES, build
 * fills EVIDENCE, apply flips LIVE and clears its drift. Nothing here talks to a network; every
 * verb rewrites a local draft of the fixture.
 *
 * Row click pins a parameter into the inspector on the right — formula, per-type resolution,
 * the constituents that mention it, and its spec block rendered in full.
 */
import { useMemo, useState } from "react";

import { ReadCell, TextCell, stateColumn, type StateMeta } from "#/components/master-table/cells";
import { MasterTable } from "#/components/master-table/master-table";
import type { Column } from "#/components/master-table/model";
import { Sentence } from "#/components/sentence";
import { Pane, PaneSplit } from "#/components/ui/pane";
import { WORLD, type ProtoLiveValue, type ProtoProposal } from "#/family/proto/world";
import { cn } from "#/lib/utils";

const TYPE_NAMES = Object.keys(WORLD.profile.types);

/**
 * FIXTURE GAP, made explicit rather than guessed at: the fixture grounds a parameter in a spec
 * block only THROUGH a proposal, so an accepted proposal would take its citation with it. A real
 * profile carries the grounding itself. This map stands in for that field — it is the only
 * hand-authored data in the variant, and the SPEC column reads it, not the proposals.
 */
const GROUNDING: Record<string, string> = {
  "Body Width": "b2",
  "Body Depth": "b2",
  "Body Height": "b2",
  "Return Elevation": "b3",
  Airflow: "b4",
  "Round Duct Diameter": "b4",
  Voltage: "b5",
};

// ── draft world ─────────────────────────────────────────────────────────────────────────────────

interface Draft {
  /** paramName → family-level authored value (or "= formula"). */
  authored: Record<string, string>;
  /** typeName → paramName → override. Absent ⇒ the type inherits the authored value. */
  types: Record<string, Record<string, string>>;
  /** paramName → typeName → what Revit carries. */
  live: Record<string, Record<string, ProtoLiveValue>>;
  /** Proposals still awaiting a verdict — accept/deny removes one from this list. */
  open: ProtoProposal[];
  /** proposalId → what happened to it, so a resolved cell can say so instead of going blank. */
  verdicts: Record<string, "accepted" | "denied">;
  /** typeName → paramName → the value the last build produced. null ⇒ never built. */
  built: Record<string, Record<string, string>> | null;
  /** The profile moved since the build, so EVIDENCE describes an older profile. */
  builtStale: boolean;
}

function initialDraft(): Draft {
  return {
    authored: Object.fromEntries(WORLD.profile.params.map((param) => [param.name, param.value])),
    types: structuredClone(WORLD.profile.types),
    live: structuredClone(WORLD.live?.values ?? {}),
    open: [...WORLD.proposals],
    verdicts: {},
    built: null,
    builtStale: false,
  };
}

/** What a type actually resolves to: its own override, else the family-level authored value. */
function effective(draft: Draft, param: string, typeName: string): string {
  return draft.types[typeName]?.[param] ?? draft.authored[param] ?? "";
}

function isFormula(value: string): boolean {
  return value.trimStart().startsWith("=");
}

/**
 * Drift is COMPUTED, not remembered — so editing the profile visibly creates drift the same way
 * Revit moving underneath would. Two exclusions, both real:
 *   · read-only live values are formula results; there is no authored value to disagree with.
 *   · an INSTANCE parameter's live value belongs to a placed instance, not to the type, so it
 *     cannot disagree with a family default. (This is what keeps Airflow out of the drift count.)
 */
function isDrifted(draft: Draft, param: string, typeName: string, isInstance: boolean): boolean {
  const live = draft.live[param]?.[typeName];
  if (!live || live.readOnly || isInstance) return false;
  return live.value !== effective(draft, param, typeName);
}

// ── rows ────────────────────────────────────────────────────────────────────────────────────────

interface LedgerRow {
  key: string;
  name: string;
  dataType: string;
  group: string;
  isInstance: boolean;
  /** "live-only" rows exist in Revit and nowhere else — they carry a LIVE cell and nothing else. */
  kind: "profile" | "live-only";
}

const ROWS: LedgerRow[] = [
  ...WORLD.profile.params.map((param) => ({
    key: param.name,
    name: param.name,
    dataType: param.dataType,
    group: param.group ?? "other",
    isInstance: param.isInstance ?? false,
    kind: "profile" as const,
  })),
  ...(WORLD.live?.extraParams ?? []).map((name) => ({
    key: `live:${name}`,
    name,
    dataType: "unknown",
    group: "live only",
    isInstance: false,
    kind: "live-only" as const,
  })),
];

const MISSING_IN_REVIT = new Set(WORLD.live?.missingParams ?? []);

// ── small parts ─────────────────────────────────────────────────────────────────────────────────

/** A station's crossing verb, sitting in that station's own header. Column-wide by construction. */
function StationVerb({
  label,
  onClick,
  disabled,
  title,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  title: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={cn(
        "tele mt-0.5 block rounded-[2px] border px-1 py-px normal-case",
        disabled
          ? "cursor-not-allowed border-[var(--line-soft)] text-muted-foreground/60"
          : "border-[var(--line-2)] text-foreground hover:border-[var(--pe-blue)]",
      )}
    >
      {label}
    </button>
  );
}

/** The per-type triple, in the same order as the TYPES columns, so stations read across. */
function Triple({
  segments,
}: {
  segments: { type: string; text: string; className?: string; title: string }[];
}) {
  return (
    <span className="tele block truncate px-1.5 tabular-nums">
      {segments.map((segment, index) => (
        <span key={segment.type}>
          {index > 0 && <span className="text-muted-foreground/40"> · </span>}
          <span className={segment.className} title={segment.title}>
            {segment.text}
          </span>
        </span>
      ))}
    </span>
  );
}

function blockSnippet(md: string): string {
  const line = md
    .split("\n")
    .map((entry) => entry.replaceAll("|", " ").replaceAll("#", "").trim())
    .find((entry) => entry.length > 0 && !/^[-\s]+$/.test(entry));
  return line ?? md;
}

// ── the page ────────────────────────────────────────────────────────────────────────────────────

export function VariantC() {
  const [draft, setDraft] = useState<Draft>(initialDraft);
  const [pinned, setPinned] = useState<string | null>(null);
  const [target, setTarget] = useState("");
  const [note, setNote] = useState<string | null>(null);

  const live = WORLD.live;
  const spec = WORLD.spec;
  const blockById = useMemo(
    () => new Map((spec?.blocks ?? []).map((block) => [block.id, block])),
    [spec],
  );

  /** paramName + typeName → the proposal aimed at exactly that cell. */
  const proposalFor = (row: LedgerRow): ProtoProposal | undefined =>
    draft.open.find((proposal) => proposal.param === row.name);

  const driftCells = useMemo(() => {
    const cells: { param: string; typeName: string }[] = [];
    for (const row of ROWS) {
      if (row.kind !== "profile") continue;
      for (const typeName of TYPE_NAMES) {
        if (isDrifted(draft, row.name, typeName, row.isInstance))
          cells.push({ param: row.name, typeName });
      }
    }
    return cells;
  }, [draft]);

  // ── verbs: each one moves data exactly one column ─────────────────────────────────────────────

  const acceptOne = (proposal: ProtoProposal) =>
    setDraft((previous) => {
      const next = structuredClone(previous);
      if (proposal.typeName) {
        next.types[proposal.typeName] = {
          ...(next.types[proposal.typeName] ?? {}),
          [proposal.param]: proposal.proposed,
        };
      } else {
        next.authored[proposal.param] = proposal.proposed;
      }
      next.open = next.open.filter((entry) => entry.id !== proposal.id);
      next.verdicts[proposal.id] = "accepted";
      next.builtStale = next.built !== null;
      return next;
    });

  const denyOne = (proposal: ProtoProposal) =>
    setDraft((previous) => ({
      ...previous,
      open: previous.open.filter((entry) => entry.id !== proposal.id),
      verdicts: { ...previous.verdicts, [proposal.id]: "denied" },
    }));

  const acceptAll = () => {
    const count = draft.open.length;
    for (const proposal of [...draft.open]) acceptOne(proposal);
    setNote(`accepted ${count} proposal${count === 1 ? "" : "s"} into the profile`);
  };

  /** capture ← : Revit's values pulled leftwards into the profile as per-type overrides. */
  const capture = () => {
    const next = structuredClone(draft);
    let moved = 0;
    for (const row of ROWS) {
      if (row.kind !== "profile" || row.isInstance) continue;
      for (const typeName of TYPE_NAMES) {
        const liveValue = next.live[row.name]?.[typeName];
        if (!liveValue || liveValue.readOnly) continue;
        if (liveValue.value === next.authored[row.name]) {
          if (next.types[typeName]?.[row.name] !== undefined) {
            delete next.types[typeName]?.[row.name];
            moved += 1;
          }
          continue;
        }
        if (next.types[typeName]?.[row.name] === liveValue.value) continue;
        next.types[typeName] = { ...(next.types[typeName] ?? {}), [row.name]: liveValue.value };
        moved += 1;
      }
    }
    next.builtStale = next.built !== null && moved > 0;
    setDraft(next);
    setNote(`captured ${moved} value${moved === 1 ? "" : "s"} out of Revit into the profile`);
  };

  /** build: the profile resolved per type, frozen as evidence. */
  const build = () => {
    const built: Record<string, Record<string, string>> = {};
    for (const typeName of TYPE_NAMES) {
      const bucket: Record<string, string> = {};
      for (const row of ROWS) {
        if (row.kind !== "profile") continue;
        bucket[row.name] = effective(draft, row.name, typeName);
      }
      built[typeName] = bucket;
    }
    setDraft({ ...draft, built, builtStale: false });
    setNote(`built ${TYPE_NAMES.length} types — evidence is fresh`);
  };

  /** apply: the profile pushed rightwards into Revit; every drift cell flips and clears. */
  const apply = () => {
    const next = structuredClone(draft);
    for (const cell of driftCells) {
      const entry = next.live[cell.param]?.[cell.typeName];
      if (!entry) continue;
      entry.value = effective(next, cell.param, cell.typeName);
      entry.drift = false;
    }
    setDraft(next);
    setNote(
      `applied ${driftCells.length} value${driftCells.length === 1 ? "" : "s"} to Revit — parameters Revit lacks are not created by apply`,
    );
  };

  // ── row verdict ───────────────────────────────────────────────────────────────────────────────

  const stateOf = (row: LedgerRow): StateMeta => {
    if (row.kind === "live-only") {
      return {
        label: "live only",
        tone: "var(--muted-foreground)",
        dim: true,
        note: "Revit carries this parameter and the profile does not claim it. Capture would be the crossing that adopts it — nothing in the profile columns applies.",
      };
    }
    if (proposalFor(row)) {
      return {
        label: "proposed",
        tone: "var(--pe-blue)",
        note: "Pea has an open proposal on this row. It is page-scoped and never persisted — accept moves it one column left into the profile, deny drops it.",
      };
    }
    const drifted = TYPE_NAMES.filter((typeName) =>
      isDrifted(draft, row.name, typeName, row.isInstance),
    );
    if (drifted.length > 0) {
      return {
        label: "drift",
        tone: "var(--cat-clay)",
        alarm: true,
        note: `Revit disagrees with the profile on ${drifted.join(", ")}. Apply pushes the profile out; capture pulls Revit in. Doing neither leaves the two truths apart.`,
      };
    }
    if (MISSING_IN_REVIT.has(row.name)) {
      return {
        label: "not in revit",
        tone: "var(--cat-kiln)",
        note: "The profile authors this parameter but Revit has no such parameter on the family. Apply writes values; it does not create parameters, so this stays until the family gains one.",
      };
    }
    if (draft.live[row.name]) {
      return {
        label: "in sync",
        tone: "var(--cat-green)",
        note: "Every type Revit reports for this parameter matches what the profile resolves to. This is the only state that needs nothing from you.",
      };
    }
    return {
      label: "unread",
      tone: "var(--muted-foreground)",
      dim: true,
      note: "Revit reported no value for this parameter in the last read, so there is nothing to compare against. Absence of evidence, not evidence of agreement.",
    };
  };

  // ── columns: the stations, in data-flow order ─────────────────────────────────────────────────

  const columns = useMemo<Column<LedgerRow>[]>(() => {
    const openCount = draft.open.length;

    const typeColumns: Column<LedgerRow>[] = TYPE_NAMES.map((typeName) => ({
      key: `type:${typeName}`,
      label: typeName,
      group: "TYPES",
      width: "w-24",
      title: `What type "${typeName}" overrides. An empty cell inherits the profile value shown behind it in grey — typing here creates the override, clearing it hands the type back to the family value.`,
      cell: (row) => {
        if (row.kind === "live-only")
          return <ReadCell value="" reason="No profile row, so no type override to author." />;
        const override = draft.types[typeName]?.[row.name];
        const inherited = draft.authored[row.name] ?? "";
        if (isFormula(inherited)) {
          return (
            <ReadCell
              value={<span className="text-muted-foreground/50">formula</span>}
              reason={`This parameter is driven by ${inherited} at the family level. A type cannot override a formula's result — edit the formula in the PROFILE column instead.`}
            />
          );
        }
        return (
          <TextCell
            value={override ?? ""}
            placeholder={inherited}
            title={
              override === undefined
                ? `"${typeName}" inherits ${inherited || "nothing"} from the family. Type a value to make this type differ.`
                : `"${typeName}" overrides the family value ${inherited} with ${override}. Clear the cell to go back to inheriting.`
            }
            className={override === undefined ? "placeholder:text-muted-foreground/35" : undefined}
            onCommit={(value) =>
              setDraft((previous) => {
                const next = structuredClone(previous);
                const bucket = { ...(next.types[typeName] ?? {}) };
                if (value.trim() === "") delete bucket[row.name];
                else bucket[row.name] = value.trim();
                next.types[typeName] = bucket;
                next.builtStale = next.built !== null;
                return next;
              })
            }
          />
        );
      },
    }));

    return [
      {
        key: "param",
        label: "parameter",
        lock: true,
        width: "w-52",
        sort: (row) => row.name,
        search: (row) => `${row.name} ${row.dataType} ${row.group}`,
        title:
          "One row per parameter — the ledger's unit. Rows below the profile's own parameters are the ones Revit carries and the profile does not.",
        cell: (row) => (
          <ReadCell
            value={
              <span className={row.kind === "live-only" ? "text-muted-foreground" : undefined}>
                {row.name}
                <span className="ml-1 text-muted-foreground/60">
                  {row.isInstance ? "inst" : ""}
                </span>
              </span>
            }
            reason={`${row.name} — ${row.dataType}, bound per ${row.isInstance ? "instance" : "type"}. Click the row to pin it in the inspector.`}
          />
        ),
      },
      {
        key: "group",
        label: "group",
        width: "w-24",
        facet: (row) => row.group,
        sort: (row) => row.group,
        all: "any group",
        title:
          "The profile's own grouping of its parameters. It is authored metadata, not a Revit fact, so it filters the ledger without meaning anything to Revit.",
        cell: (row) => (
          <ReadCell
            value={<span className="text-muted-foreground">{row.group}</span>}
            reason={`Grouped as "${row.group}" in the profile document.`}
          />
        ),
      },
      stateColumn<LedgerRow>({
        key: "verdict",
        label: "state",
        title:
          "One word for the whole row, read across every station: what this parameter is currently asking of you. Filter it to work one kind of trouble at a time.",
        of: stateOf,
      }),

      // ── SPEC ────────────────────────────────────────────────────────────────────────────────
      {
        key: "citation",
        label: "citation",
        group: "SPEC",
        width: "w-64",
        header: (
          <span title={`Grounded in ${spec?.fileName ?? "no spec bound"}.`}>
            citation
            <span className="ml-1 normal-case text-muted-foreground/70">
              {spec?.fileName ?? "none"}
            </span>
          </span>
        ),
        facet: (row) => (GROUNDING[row.name] ? "grounded" : "ungrounded"),
        all: "any grounding",
        title:
          "The spec block that grounds this parameter. An empty cell means nothing in the cut sheet claims this value — the profile is asserting it on its own authority.",
        cell: (row) => {
          const block = blockById.get(GROUNDING[row.name] ?? "");
          if (!block)
            return (
              <ReadCell
                value={<span className="text-muted-foreground/40">ungrounded</span>}
                reason="No spec block grounds this parameter. Whatever the profile authors here came from somewhere the document cannot show you."
              />
            );
          return (
            <ReadCell
              value={
                <>
                  <span className="text-muted-foreground">p{block.page}</span>{" "}
                  <span>{blockSnippet(block.md)}</span>
                </>
              }
              reason={`${spec?.fileName} page ${block.page} · ${block.kind}\n\n${block.md}`}
            />
          );
        },
      },

      // ── PROPOSED ────────────────────────────────────────────────────────────────────────────
      {
        key: "proposed",
        label: "pea proposes",
        group: "PROPOSED",
        width: "w-56",
        headerClassName: "bg-[color-mix(in_srgb,var(--pe-blue)_7%,var(--muted))]",
        header: (
          <span title="Pea's proposals. They are EPHEMERAL — page-scoped, never written to the profile, gone when you leave. The only way one becomes real is accept, which moves it one column left.">
            pea proposes
            <StationVerb
              label={openCount > 0 ? `accept all ${openCount}` : "nothing open"}
              disabled={openCount === 0}
              onClick={acceptAll}
              title={
                openCount === 0
                  ? "No open proposals. Pea has nothing to say about this profile right now."
                  : `Write all ${openCount} proposed values into the profile at once. Each one empties its cell here and appears in PROFILE or TYPES — nothing reaches Revit until apply.`
              }
            />
          </span>
        ),
        facet: (row) => (proposalFor(row) ? "open" : ""),
        all: "any",
        cell: (row) => {
          const proposal = proposalFor(row);
          if (!proposal) {
            const resolved = Object.entries(draft.verdicts).find(
              ([id]) => WORLD.proposals.find((entry) => entry.id === id)?.param === row.name,
            );
            if (!resolved) return null;
            return (
              <ReadCell
                value={<span className="text-muted-foreground/50">{resolved[1]}</span>}
                reason={`Pea's proposal on this row was ${resolved[1]}. Proposals are page-scoped, so this record disappears on reload — the profile itself is the only thing that keeps.`}
              />
            );
          }
          return (
            <span className="flex h-7 items-center gap-1 bg-[color-mix(in_srgb,var(--pe-blue)_6%,transparent)] px-1.5">
              <span className="tele min-w-0 flex-1 truncate" title={proposal.note}>
                {proposal.typeName && (
                  <span className="text-muted-foreground">{proposal.typeName} </span>
                )}
                <span className="text-muted-foreground/60">
                  {proposal.current ?? "—"} →{" "}
                </span>
                <span className="text-[var(--pe-blue)]">{proposal.proposed}</span>
              </span>
              <button
                type="button"
                onClick={() => acceptOne(proposal)}
                title={`Write ${proposal.proposed} into ${proposal.typeName ? `type "${proposal.typeName}"` : "the family-level value"}. This cell empties and the value appears one column left.`}
                className="tele rounded-[2px] border border-[var(--line-2)] px-1 hover:border-[var(--pe-blue)]"
              >
                ✓
              </button>
              <button
                type="button"
                onClick={() => denyOne(proposal)}
                title="Drop this proposal. Nothing changes anywhere — the profile keeps what it already authored."
                className="tele rounded-[2px] border border-[var(--line-2)] px-1 text-muted-foreground hover:border-[var(--cat-clay)]"
              >
                ✕
              </button>
            </span>
          );
        },
      },

      // ── PROFILE ─────────────────────────────────────────────────────────────────────────────
      {
        key: "authored",
        label: "authored",
        group: "PROFILE",
        width: "w-32",
        header: (
          <span title="The portable family.json value — the family-level number every type inherits until it overrides. This column is the profile; everything left of it is an argument about it and everything right of it is a consequence.">
            authored
            <StationVerb
              label="capture ←"
              disabled={live === null}
              onClick={capture}
              title={
                live === null
                  ? "Nothing live is bound, so there is nothing to capture from."
                  : "Pull Revit's values leftwards into the profile: each type's live value becomes that type's override, and an override equal to the family value is dropped instead of written. Read-only (formula-driven) values are skipped — they have no authored form."
              }
            />
          </span>
        ),
        cell: (row) => {
          if (row.kind === "live-only")
            return (
              <ReadCell
                value={<span className="text-muted-foreground/40">not in profile</span>}
                reason="Revit carries this parameter; the profile does not author it. Capture is what would adopt it — nothing else here can."
              />
            );
          const value = draft.authored[row.name] ?? "";
          return (
            <TextCell
              value={value}
              title={
                isFormula(value)
                  ? `Driven by a formula: ${value}. The types below inherit its result, and no type can override it.`
                  : `The family-level authored value. Every type inherits it unless that type overrides it in the TYPES columns.`
              }
              className={isFormula(value) ? "text-cat-lichen" : undefined}
              onCommit={(next) =>
                setDraft((previous) => ({
                  ...previous,
                  authored: { ...previous.authored, [row.name]: next },
                  builtStale: previous.built !== null,
                }))
              }
            />
          );
        },
      },

      // ── TYPES ───────────────────────────────────────────────────────────────────────────────
      ...typeColumns,

      // ── EVIDENCE ────────────────────────────────────────────────────────────────────────────
      {
        key: "built",
        label: "built",
        group: "EVIDENCE",
        width: "w-40",
        header: (
          <span title="What the last build actually produced, per type, in the same order as the TYPES columns. Evidence is a fact about a build, not a promise about the profile — edit the profile and it goes stale.">
            built
            <StationVerb
              label={draft.built === null ? "build" : draft.builtStale ? "rebuild" : "fresh"}
              disabled={draft.built !== null && !draft.builtStale}
              onClick={build}
              title={
                draft.built !== null && !draft.builtStale
                  ? "The evidence already describes the profile as it stands. Change something to the left and this becomes rebuild."
                  : "Resolve the profile for every type and freeze the result here. Nothing in Revit moves — build proves what the profile MEANS, apply is what makes Revit agree."
              }
            />
          </span>
        ),
        cell: (row) => {
          if (row.kind === "live-only")
            return (
              <ReadCell
                value=""
                reason="Not in the profile, so no build could ever produce it."
              />
            );
          if (draft.built === null)
            return (
              <ReadCell
                value={<span className="text-muted-foreground/40">not built</span>}
                reason="This profile has never been built here, so there is no evidence for what it produces. The values to the left are intent; only a build turns them into a fact."
              />
            );
          if (isFormula(draft.authored[row.name] ?? ""))
            return (
              <ReadCell
                value={<span className="text-muted-foreground/40">formula · not evaluated</span>}
                reason="This prototype freezes authored text; it does not evaluate formulas. A real build would report the resolved number per type — that gap is the honest one here."
              />
            );
          return (
            <Triple
              segments={TYPE_NAMES.map((typeName) => ({
                type: typeName,
                text: draft.built?.[typeName]?.[row.name] || "—",
                className: draft.builtStale ? "text-cat-kiln" : "text-muted-foreground",
                title: `${typeName} built as ${draft.built?.[typeName]?.[row.name] || "nothing"}${draft.builtStale ? " — STALE: the profile has moved since this build" : " — fresh against the current profile"}.`,
              }))}
            />
          );
        },
      },

      // ── LIVE ────────────────────────────────────────────────────────────────────────────────
      {
        key: "live",
        label: "revit",
        group: "LIVE",
        width: "w-48",
        header: (
          <span title="What Revit carries right now, per type, read from the live family. This is the only column that is not the profile's opinion — it is the proof.">
            revit
            <StationVerb
              label={driftCells.length > 0 ? `apply ${driftCells.length} drifts` : "no drift"}
              disabled={driftCells.length === 0}
              onClick={apply}
              title={
                driftCells.length === 0
                  ? "Revit already agrees with the profile everywhere it can be compared. Nothing to push."
                  : `Write the profile's value into Revit for the ${driftCells.length} cell(s) that disagree. Parameters Revit does not have are NOT created — apply moves values, not schema.`
              }
            />
          </span>
        ),
        cell: (row) => {
          if (row.kind === "live-only")
            return (
              <ReadCell
                value={<span className="text-muted-foreground">in Revit only · no value read</span>}
                reason={`Revit reports "${row.name}" on this family, but the fixture records no value for it. FIXTURE GAP: extraParams is a name list with no values attached.`}
              />
            );
          if (MISSING_IN_REVIT.has(row.name))
            return (
              <ReadCell
                value={<span className="italic text-cat-kiln">missing in Revit</span>}
                reason="The profile authors this parameter but the live family has no parameter by that name. Apply will not invent it — the family needs the parameter added first."
              />
            );
          const values = draft.live[row.name];
          if (!values)
            return (
              <ReadCell
                value={<span className="text-muted-foreground/40">not read</span>}
                reason="The last read of the live family reported nothing for this parameter. Silence is not agreement."
              />
            );
          return (
            <Triple
              segments={TYPE_NAMES.map((typeName) => {
                const entry = values[typeName];
                const drifted = isDrifted(draft, row.name, typeName, row.isInstance);
                return {
                  type: typeName,
                  text: entry?.value ?? "—",
                  className: drifted
                    ? "text-cat-clay"
                    : entry?.readOnly
                      ? "text-muted-foreground/60 italic"
                      : undefined,
                  title: !entry
                    ? `Revit reported no value for ${typeName}.`
                    : drifted
                      ? `DRIFT — Revit carries ${entry.value} for ${typeName}; the profile resolves to ${effective(draft, row.name, typeName)}. Apply pushes the profile out, capture pulls Revit in.`
                      : entry.readOnly
                        ? `${typeName} is ${entry.value}, computed by Revit from a formula. There is no authored value it could disagree with.`
                        : row.isInstance
                          ? `${typeName} instances read ${entry.value}. Instance values belong to placed elements, not to the type, so this is never counted as drift.`
                          : `${typeName} agrees with the profile at ${entry.value}.`,
                };
              })}
            />
          );
        },
      },
    ];
  }, [draft, driftCells, blockById, live, spec]);

  // ── facts strip: one line, counted per station ────────────────────────────────────────────────

  const grounded = ROWS.filter((row) => GROUNDING[row.name]).length;
  const builtCells = draft.built
    ? TYPE_NAMES.length * WORLD.profile.params.filter((param) => !isFormula(param.value)).length
    : 0;
  const liveParams = ROWS.filter((row) => draft.live[row.name]).length;

  const pinnedRow = ROWS.find((row) => row.key === pinned) ?? null;

  const ledger = (
    <MasterTable
      rows={ROWS}
      columns={columns}
      rowKey={(row) => row.key}
      scopeLabel="parameters"
      searchPlaceholder="parameter"
      activeKey={pinned}
      onRowClick={(row) => setPinned((current) => (current === row.key ? null : row.key))}
      summary={
        <span title="One count per station, left to right in the same order as the columns. Read it as the profile's health: what is grounded, what pea wants, what is authored, what has been proven, and what Revit actually carries.">
          {grounded} grounded · {draft.open.length} proposals · {WORLD.profile.params.length}{" "}
          authored · {TYPE_NAMES.length} types · {builtCells} built
          {draft.built && draft.builtStale ? " (stale)" : ""} · {liveParams} live ·{" "}
          <span className={driftCells.length > 0 ? "text-cat-clay" : undefined}>
            {driftCells.length} drift
          </span>
        </span>
      }
      empty="Nothing in this profile — a family.json with no parameters has no ledger to keep."
    />
  );

  return (
    <main className="flex h-screen flex-col bg-[var(--paper)] text-[var(--foreground)]">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-[var(--line)] px-4 py-2">
        <span className="tele-label text-[10px] tracking-[0.3em] text-[var(--clay-ink)]">
          LEDGER
        </span>
        <Sentence
          prefix="keeping"
          slots={[
            {
              key: "profile",
              text: WORLD.profile.path,
              placeholder: "pick a profile",
              options: [
                { id: WORLD.profile.path, label: WORLD.profile.path, sub: WORLD.profile.category },
              ],
              title:
                "The portable family.json this ledger keeps. It is the PROFILE column and everything that feeds it — binding a different one replaces every row.",
            },
            {
              key: "family",
              joiner: "against",
              text: live ? `${live.familyName} in ${live.worldLabel}` : null,
              placeholder: "nothing live",
              options: live
                ? [
                    {
                      id: "live",
                      label: `${live.familyName} in ${live.worldLabel}`,
                      sub: `read ${live.readAgo}`,
                    },
                  ]
                : [],
              title:
                "The live family the LIVE column reads and the apply verb writes. Without it the ledger still keeps the profile — it just cannot prove anything about Revit.",
              empty:
                "No family open in the bound world. Open one in Revit and the LIVE column fills in.",
            },
          ]}
          target={target}
          onBind={(selector) => setTarget(selector ?? "")}
        />
        {live && (
          <span
            className="tele text-[10px] text-muted-foreground"
            title="How long ago the LIVE column was read. Everything right of PROFILE is only as true as this number."
          >
            live read {live.readAgo}
          </span>
        )}
        {note && (
          <span
            className="tele text-[10px] text-[var(--pe-blue)]"
            title="What the last verb did. Every verb here moves data exactly one column — nothing leaves this page."
          >
            {note}
          </span>
        )}
      </div>

      <div className="min-h-0 flex-1">
        {pinnedRow ? (
          <PaneSplit
            axis="horizontal"
            start={<div className="flex size-full min-h-0 flex-col">{ledger}</div>}
            end={
              <Inspector
                row={pinnedRow}
                draft={draft}
                blockMd={blockById.get(GROUNDING[pinnedRow.name] ?? "")?.md ?? null}
                blockPage={blockById.get(GROUNDING[pinnedRow.name] ?? "")?.page ?? null}
                onClose={() => setPinned(null)}
              />
            }
            resize={{ target: "end", defaultSize: 340, minSize: 260, minOtherSize: 520 }}
          />
        ) : (
          <div className="flex size-full min-h-0 flex-col">{ledger}</div>
        )}
      </div>
    </main>
  );
}

// ── inspector ───────────────────────────────────────────────────────────────────────────────────

/** Constituents whose description names this parameter — the geometry the number actually drives. */
function associationsOf(name: string): { slug: string; kind: string; text: string }[] {
  const entries: { slug: string; kind: string; text: string }[] = [];
  for (const [slug, text] of Object.entries(WORLD.profile.solids)) {
    if (text.includes(name)) entries.push({ slug, kind: "solid", text });
  }
  for (const [slug, text] of Object.entries(WORLD.profile.connectors)) {
    if (text.includes(name)) entries.push({ slug, kind: "connector", text });
  }
  return entries;
}

function InspectorSection({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-[var(--line-soft)] px-2 py-1.5 first:border-t-0">
      <span className="tele-label block text-muted-foreground">{label}</span>
      <div className="mt-1">{children}</div>
    </section>
  );
}

function Inspector({
  row,
  draft,
  blockMd,
  blockPage,
  onClose,
}: {
  row: LedgerRow;
  draft: Draft;
  blockMd: string | null;
  blockPage: number | null;
  onClose: () => void;
}) {
  const authored = draft.authored[row.name] ?? "";
  const associations = associationsOf(row.name);
  const proposal = draft.open.find((entry) => entry.param === row.name);

  return (
    <Pane
      kind="inspector"
      title={row.name}
      meta={`${row.dataType} · per ${row.isInstance ? "instance" : "type"}`}
      bodyClassName="p-0"
      actions={
        <button
          type="button"
          onClick={onClose}
          title="Unpin this parameter. The ledger keeps every row visible either way — the inspector is a magnifier, never a filter."
          className="tele rounded-[2px] border border-[var(--line-2)] px-1 text-muted-foreground hover:text-foreground"
        >
          unpin
        </button>
      }
    >
      {row.kind === "live-only" ? (
        <InspectorSection label="live only">
          <p className="tele text-[11px] text-muted-foreground">
            Revit carries this parameter and the profile does not claim it. There is no authored
            value, no type override, and no evidence — only the fact that it exists over there.
          </p>
        </InspectorSection>
      ) : (
        <>
          <InspectorSection label={isFormula(authored) ? "formula" : "authored"}>
            <p
              className={cn(
                "tele text-[11px]",
                isFormula(authored) ? "text-cat-lichen" : "text-foreground",
              )}
              title={
                isFormula(authored)
                  ? "The family-level value is computed. Every type inherits the result and none can override it."
                  : "The family-level value every type inherits until it overrides."
              }
            >
              {authored || "—"}
            </p>
          </InspectorSection>

          <InspectorSection label="resolution per type">
            <table className="w-full border-collapse">
              <tbody>
                {TYPE_NAMES.map((typeName) => {
                  const override = draft.types[typeName]?.[row.name];
                  const liveEntry = draft.live[row.name]?.[typeName];
                  const drifted = isDrifted(draft, row.name, typeName, row.isInstance);
                  return (
                    <tr key={typeName} className="border-b border-[var(--line-soft)]">
                      <td className="tele w-20 py-0.5 text-[11px] text-muted-foreground">
                        {typeName}
                      </td>
                      <td
                        className="tele py-0.5 text-[11px] tabular-nums"
                        title={
                          override === undefined
                            ? `Inherited from the family value ${authored}.`
                            : `Overridden by this type as ${override}.`
                        }
                      >
                        {effective(draft, row.name, typeName) || "—"}
                        {override === undefined && (
                          <span className="ml-1 text-muted-foreground/50">inherited</span>
                        )}
                      </td>
                      <td
                        className={cn(
                          "tele py-0.5 text-right text-[11px] tabular-nums",
                          drifted ? "text-cat-clay" : "text-muted-foreground",
                        )}
                        title={
                          drifted
                            ? "Revit disagrees with the profile for this type."
                            : "What Revit carries for this type."
                        }
                      >
                        {liveEntry?.value ?? "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </InspectorSection>

          {proposal && (
            <InspectorSection label="pea proposes">
              <p className="tele text-[11px] text-[var(--pe-blue)]">
                {proposal.typeName ? `${proposal.typeName}: ` : ""}
                {proposal.current ?? "—"} → {proposal.proposed}
              </p>
              <p className="tele mt-1 text-[11px] text-muted-foreground">{proposal.note}</p>
            </InspectorSection>
          )}

          <InspectorSection label="associations">
            {associations.length === 0 ? (
              <p className="tele text-[11px] text-muted-foreground">
                No solid or connector in the profile names this parameter, so nothing in the
                geometry visibly depends on it. That is worth a second look, not a shrug.
              </p>
            ) : (
              <ul className="space-y-0.5">
                {associations.map((entry) => (
                  <li key={entry.slug} className="tele text-[11px]">
                    <span className="text-muted-foreground">{entry.kind} </span>
                    {entry.slug}
                    <span className="block text-[10px] text-muted-foreground">{entry.text}</span>
                  </li>
                ))}
              </ul>
            )}
          </InspectorSection>
        </>
      )}

      <InspectorSection label={blockMd ? `citation · page ${blockPage}` : "citation"}>
        {blockMd ? (
          <pre className="tele overflow-x-auto whitespace-pre-wrap text-[10px] text-muted-foreground">
            {blockMd}
          </pre>
        ) : (
          <p className="tele text-[11px] text-muted-foreground">
            Ungrounded — no block of {WORLD.spec?.fileName ?? "the spec"} claims this parameter.
            Whatever the profile authors here is asserted on its own authority.
          </p>
        )}
      </InspectorSection>
    </Pane>
  );
}
