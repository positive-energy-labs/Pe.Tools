/** PROTOTYPE — variant "inbox": decision inbox. */
/**
 * The whole product is one queue of human calls.
 *
 * Every pipeline step contributes rows to the same inbox — registry asks, partition flags,
 * orphaned regions, materialize failures, data holds, drift blocks, sync staleness — and the
 * page never asks the human to navigate to a step or a zone to find work. The facet rail is the
 * only progress view there is: progress IS queue emptiness, rendered as a burn-down per step and
 * per zone. Everything on the right flank is context for the row under the cursor.
 *
 * Two verbs, per the review law: accept takes the recalculation's proposal, dismiss keeps the
 * designer's state. Data-conflict holds are the only multi-choice rows. Every row names the HOME
 * its verb writes to; a row with no home is disabled, because there is nothing to write through
 * to. Nothing here is live — the world comes from mock.ts.
 */
import { useEffect, useMemo, useRef, useState } from "react";

import { Button } from "#/components/ui/button";
import { cn } from "#/lib/utils";
import { fmtNum } from "#/rhvac/cells";
import { FLAG_MEANING, type DetectedRoom, type PartitionRun } from "#/takeoff/model";
import {
  SENSIBLE_CAP_BTUH,
  mockWorld,
  type MockDecision,
  type MockWorld,
  type MockZone,
} from "#/takeoff/proto/mock";
import { Live, Seam } from "#/takeoff/seam";
import { ZonePlan, ZoneThumb } from "#/takeoff/zone-plan";

// ── Vocabulary ──────────────────────────────────────────────────────────────
//
// Color is budgeted by PIPELINE STEP, not by kind: four hues total, so a glance at the queue
// reads "which half of the pipeline is holding me up". The kind word carries the finer grain.

type StepKey = "register" | "review" | "data" | "export";

const STEP_META: Record<
  StepKey,
  { n: string; label: string; text: string; tint: string; line: string; fill: string; rest: string; unblocks: string }
> = {
  register: {
    n: "2",
    label: "validate + register",
    text: "text-cat-lichen",
    tint: "bg-cat-lichen/12",
    line: "border-cat-lichen/25",
    fill: "bg-cat-lichen",
    rest: "bg-cat-lichen/20",
    unblocks: "zones can be partitioned once every tag resolves to one System",
  },
  review: {
    n: "3",
    label: "partition + review",
    text: "text-cat-clay",
    tint: "bg-cat-clay/12",
    line: "border-cat-clay/25",
    fill: "bg-cat-clay",
    rest: "bg-cat-clay/20",
    unblocks: "room geometry is settled — Manual J data can be entered against it",
  },
  data: {
    n: "5",
    label: "room data",
    text: "text-cat-green",
    tint: "bg-cat-green/12",
    line: "border-cat-green/25",
    fill: "bg-cat-green",
    rest: "bg-cat-green/20",
    unblocks: "every room carries confirmed Manual J values — export has nothing to refuse",
  },
  export: {
    n: "6",
    label: "export + reconcile",
    text: "text-cat-blue",
    tint: "bg-cat-blue/12",
    line: "border-cat-blue/25",
    fill: "bg-cat-blue",
    rest: "bg-cat-blue/20",
    unblocks: "the .r10 matches the model — a revision is a diff, not a redraw",
  },
};

const STEP_KEYS: StepKey[] = ["register", "review", "data", "export"];

interface Choice {
  id: string;
  label: string;
  note: string;
}

/** One human call. The row is the unit of the product; everything else renders around it. */
interface Ask {
  key: string;
  step: StepKey;
  /** Fine-grained word shown in the chip. */
  kind: string;
  subject: string;
  zoneKey: string | null;
  /** The one-line question, phrased so the row is answerable without opening anything. */
  question: string;
  /** The same thing in plain words, for the peek flank. */
  why: string;
  /** Machine-measured figures — mono, because the machine measured them. */
  figures: string;
  /** Where the verb writes. Null means there is nothing to write to, so the row is disabled. */
  home: string | null;
  homeNote?: string;
  acceptLabel: string;
  dismissLabel: string;
  /** Holds are the only multi-choice rows. */
  choices?: Choice[];
  blocksExport?: boolean;
  runId: string | null;
  sourceSqft: number | null;
  history: MockDecision[];
  /** Room id to highlight in the peek plan, when the subject is a room. */
  roomId?: string;
  priority: number;
}

interface Receipt {
  verb: string;
  at: string;
  runId: string;
}

const SESSION_RUN = "web-20260814-1147";
const SESSION_AT = "2026-08-14 11:47";

// ── Synthesis ───────────────────────────────────────────────────────────────

/** Room display ids, uniquified within a zone so the plan and the queue agree on a name. */
function roomIds(z: MockZone): string[] {
  const seen = new Map<string, number>();
  return z.rooms.map((r) => {
    const n = (seen.get(r.name) ?? 0) + 1;
    seen.set(r.name, n);
    return n === 1 ? r.name : `${r.name} ${n}`;
  });
}

/**
 * The peek plan wants polygons; the mock deliberately carries label points and areas only. A
 * square of the room's area, centered on its label, is an honest stand-in: position and size are
 * real, the boundary is not — and the peek says so.
 */
function synthRun(z: MockZone, ids: string[]): PartitionRun {
  const rooms: DetectedRoom[] = z.rooms.map((r, i) => {
    const h = Math.sqrt(Math.max(r.sqft, 24)) / 2;
    const [x, y] = r.label;
    return {
      id: ids[i]!,
      rawSqft: r.sqft,
      perimeterFt: h * 8,
      meanCeilingFt: r.ceilingFt,
      label: r.label,
      flags: r.flags,
      outer: [
        [x - h, y - h],
        [x + h, y - h],
        [x + h, y + h],
        [x - h, y + h],
      ],
    };
  });
  return {
    levelName: z.zone.lane.label,
    elevation: 0,
    created: rooms.length,
    held: z.heldSqft > 0 ? 1 : 0,
    rebound: 0,
    orphaned: 0,
    domainSqft: z.zone.declaredSqft,
    claimedWallSqft: 0,
    excludedResidueSqft: 0,
    totalSqft: rooms.reduce((s, r) => s + r.rawSqft, 0),
    profile: "mock",
    failures: [],
    rooms,
    residues: [],
    regions: [],
  };
}

/** Every open call in the project, from every step, in one list. */
function buildAsks(world: MockWorld, idsByZone: Map<string, string[]>): Ask[] {
  const asks: Ask[] = [];

  // ── Step 2: registry asks (rename vs new is a QUESTION, never a guess) ────
  const tagged = world.zones.filter((z) => z.tags.length > 0);
  const vanished = tagged[2];
  const appeared = tagged[tagged.length - 2];
  if (vanished && appeared) {
    const fromTag = vanished.tags[0]!;
    const toTag = appeared.tags[0]!;
    asks.push({
      key: `registry:${fromTag}:${toTag}`,
      step: "register",
      kind: "registry",
      subject: `${fromTag} → ${toTag}`,
      zoneKey: appeared.zone.key,
      question: `${fromTag} vanished from the drawings while ${toTag} appeared — rename, or a new System?`,
      why: `The registry knows ${fromTag} by GUID. This validate pass found no zone tagged ${fromTag} and one zone tagged ${toTag} that the registry has never seen. Exactly one vanished and exactly one appeared, so a rename is the recalculation's proposal — but only the engineer knows whether the equipment is the same box.`,
      figures: `1 vanished · 1 appeared`,
      home: "System registry blob",
      homeNote: "versioned JSON on Project Information",
      acceptLabel: `rename ${fromTag} → ${toTag}`,
      dismissLabel: `${toTag} is new`,
      runId: null,
      sourceSqft: null,
      history: [],
      priority: 20,
    });
  }
  const doubleTagged = world.zones.find((z) => z.tags.length > 1);
  if (doubleTagged) {
    const [a, b] = doubleTagged.tags;
    asks.push({
      key: `registry:merge:${doubleTagged.zone.key}`,
      step: "register",
      kind: "registry",
      subject: `${a}, ${b}`,
      zoneKey: doubleTagged.zone.key,
      question: `${doubleTagged.zone.key} carries two System tags — two Systems, or one merged legend entry?`,
      why: `A zone serves one System in the common case. Two tags on one Zoning Region usually means the legend entry was merged for the sheet, not that the zone is fed twice. Accepting registers both GUIDs and splits the zone's load between them; dismissing keeps the pair as one display label on a single System.`,
      figures: `${fmtNum(doubleTagged.zone.declaredSqft, 0)} sf declared`,
      home: "System registry blob",
      homeNote: "versioned JSON on Project Information",
      acceptLabel: "register both",
      dismissLabel: "one System, merged label",
      runId: null,
      sourceSqft: null,
      history: [],
      priority: 22,
    });
  }

  // ── Step 3: partition flags, orphans, failures ───────────────────────────
  for (const z of world.zones) {
    const ids = idsByZone.get(z.zone.key)!;
    z.rooms.forEach((room, i) => {
      // mock.ts emits a handful of `undefined` entries inside MockRoom.flags (the FLAG_POOL index
      // lands out of range; the `!` in mock.ts hides it from the type checker). A flag with no
      // name is not a decidable ask — it has no meaning to show and no verb to write — so it is
      // filtered here rather than rendered as a nameless row. Reported upstream, not fixed here.
      const named = room.flags.filter((f): f is string => typeof f === "string");
      for (const flag of named) {
        if (room.decisions.some((d) => d.flag === flag)) continue;
        asks.push({
          key: `flag:${z.zone.key}:${i}:${flag}`,
          step: "review",
          kind: flag,
          subject: ids[i]!,
          zoneKey: z.zone.key,
          question: FLAG_MEANING[flag] ?? flag,
          why: `The detector refused to guess here. ${FLAG_MEANING[flag] ?? flag}. Accepting takes the partition's room as drawn; dismissing keeps whatever the designer already has in the model — geometry never changes from this page either way.`,
          figures: `${fmtNum(room.sqft, 0)} sf · ${fmtNum(room.ceilingFt, 1)} ft clg`,
          home: `Room Region blob · ${room.guid.slice(0, 8)}`,
          homeNote: "provenance blob on the Room Region FR",
          acceptLabel: "accept the partition",
          dismissLabel: "keep the designer's",
          runId: room.provenance.runId,
          sourceSqft: room.provenance.sourceSqft,
          history: room.decisions,
          roomId: ids[i]!,
          priority: 40,
        });
      }
    });
  }

  // Orphans and failures: the mock has no rerun, so two of each are invented against real zones.
  const settled = world.zones.filter((z) => z.rooms.length >= 3);
  settled.slice(0, 2).forEach((z, n) => {
    const room = z.rooms[z.rooms.length - 1]!;
    asks.push({
      key: `orphan:${z.zone.key}`,
      step: "review",
      kind: "orphaned-region",
      subject: room.guid.slice(0, 8),
      zoneKey: z.zone.key,
      question: FLAG_MEANING["orphaned-region"]!,
      why: `This rerun's partition claimed no room at this location, but a Room Region FR is still sitting there carrying accepted decisions. The designer's region stands until someone accepts its removal — a rerun never deletes a human's geometry on its own.`,
      figures: `${fmtNum(room.sqft, 0)} sf · no claimant`,
      home: `Room Region FR · ${room.guid.slice(0, 8)}`,
      homeNote: "the region's own provenance blob",
      acceptLabel: "retire the region",
      dismissLabel: "keep the region",
      runId: room.provenance.runId,
      sourceSqft: room.provenance.sourceSqft,
      history: room.decisions,
      roomId: idsByZone.get(z.zone.key)![z.rooms.length - 1],
      priority: 42 + n,
    });
  });
  settled.slice(3, 5).forEach((z, n) => {
    asks.push({
      key: `failure:${z.zone.key}`,
      step: "review",
      kind: "materialize-failed",
      subject: `${z.zone.key} loop ${n + 2}`,
      zoneKey: z.zone.key,
      question: `${FLAG_MEANING["materialize-failed"]!} — nothing exists to decide against`,
      why: `Revit rejected the boundary loop, so no Room Region FR was created. There is no home to write a verb into: the fix is upstream, in the capture or the sketch, not in this queue. The row is here so the failure is never silently absorbed — it is visible, counted, and unanswerable.`,
      figures: "no region · dropped whole",
      home: null,
      acceptLabel: "accept",
      dismissLabel: "dismiss",
      runId: z.runs[0]?.runId ?? null,
      sourceSqft: null,
      history: [],
      priority: 90,
    });
  });

  // ── Step 5: data holds ───────────────────────────────────────────────────
  // The assist has no PE equipment-table entry for these room types, so it filled zeros. A zero
  // the engineer confirmed and a zero nobody looked at are different data.
  const NO_EQUIP = new Set(["bedroom", "primary bedroom", "great room", "hall", "mechanical"]);
  for (const z of world.zones) {
    if (z.stage !== "data") continue;
    const ids = idsByZone.get(z.zone.key)!;
    let taken = 0;
    z.rooms.forEach((room, i) => {
      if (taken >= 2 || !room.data || !NO_EQUIP.has(room.type)) return;
      taken++;
      asks.push({
        key: `data:${z.zone.key}:${i}`,
        step: "data",
        kind: "assist-zero",
        subject: ids[i]!,
        zoneKey: z.zone.key,
        question: `no PE equipment-table entry for "${room.type}" — confirm zero equipment load, or hold for manual entry?`,
        why: `The deterministic assist keyed lighting off area and people off the bedroom count, but the equipment table has no row for "${room.type}", so sensible and latent equipment came out zero. Accepting writes that zero to the .r10 as a confirmed value; dismissing leaves the field unentered, which keeps export refusing this room.`,
        figures: `${fmtNum(room.data.lightingW, 0)} W ltg · ${room.data.people} ppl · ${fmtNum(room.data.ventilationCfm, 0)} cfm OA`,
        home: `the .r10 · room "${ids[i]!}"`,
        homeNote: "Manual J data lives in the .r10, never in Revit",
        acceptLabel: "confirm zero",
        dismissLabel: "hold for entry",
        blocksExport: true,
        runId: room.provenance.runId,
        sourceSqft: room.provenance.sourceSqft,
        history: room.decisions,
        roomId: ids[i]!,
        priority: 30,
      });
    });
  }

  // Data-conflict holds — the only multi-choice rows in the product.
  world.zones
    .filter((z) => z.rooms.length >= 2 && (z.stage === "synced" || z.stage === "data"))
    .slice(0, 2)
    .forEach((z, n) => {
      const ids = idsByZone.get(z.zone.key)!;
      const a = z.rooms[0]!;
      const b = z.rooms[1]!;
      asks.push({
        key: `hold:${z.zone.key}`,
        step: "data",
        kind: "data-conflict hold",
        subject: `${ids[0]!} + ${ids[1]!}`,
        zoneKey: z.zone.key,
        question: `two rooms carrying .r10 data merged into one region — whose data survives?`,
        why: `The designer joined these two spaces in the sketch editor. Both rooms already carried confirmed Manual J values, and a merge cannot average them without inventing a number. The marker sits on the surviving Room Region and blocks export until a human names the survivor. This is the only kind of row with more than two answers.`,
        figures: `${fmtNum(a.sqft, 0)} + ${fmtNum(b.sqft, 0)} sf → ${fmtNum(a.sqft + b.sqft, 0)} sf`,
        home: `Room Region blob · ${a.guid.slice(0, 8)}`,
        homeNote: "held-conflict marker on the surviving region",
        acceptLabel: "accept",
        dismissLabel: "dismiss",
        choices: [
          { id: `keep-a`, label: `keep ${ids[0]!}`, note: `${fmtNum(a.sqft, 0)} sf of data survives` },
          { id: `keep-b`, label: `keep ${ids[1]!}`, note: `${fmtNum(b.sqft, 0)} sf of data survives` },
          { id: `re-enter`, label: "re-enter by hand", note: "clears both, export stays blocked" },
        ],
        blocksExport: true,
        runId: a.provenance.runId,
        sourceSqft: a.provenance.sourceSqft,
        history: a.decisions,
        roomId: ids[0]!,
        priority: 10 + n,
      });
    });

  // ── Step 6: drift blocks and sync staleness ──────────────────────────────
  for (const z of world.zones) {
    if (z.stage !== "drifted") continue;
    asks.push({
      key: `drift:${z.zone.key}`,
      step: "export",
      kind: "drift block",
      subject: z.zone.key,
      zoneKey: z.zone.key,
      question: `hand edits moved ${fmtNum(z.driftSqft, 0)} sf against the accepted state — export is blocked`,
      why: `Drift is always measured against the accepted state, never against the last run. Someone reshaped geometry in Revit after the last sync, so the .r10 and the model no longer describe the same house. Accepting takes the model's current shape as the new accepted state; dismissing keeps the accepted state and marks the edits as unreviewed.`,
      figures: `${fmtNum(z.driftSqft, 0)} sf drift · ${fmtNum(z.zone.declaredSqft, 0)} sf declared`,
      home: `Room Region blobs · ${z.zone.key}`,
      homeNote: "accepted-state stamp on each affected region",
      acceptLabel: "take the model",
      dismissLabel: "keep accepted",
      blocksExport: true,
      runId: z.runs[0]?.runId ?? null,
      sourceSqft: z.zone.declaredSqft,
      history: [],
      priority: 4,
    });
  }

  for (const z of world.zones) {
    const ids = idsByZone.get(z.zone.key)!;
    z.rooms.forEach((room, i) => {
      if (!room.r10 || room.r10.lastSyncedSqft === room.sqft) return;
      const delta = room.sqft - room.r10.lastSyncedSqft;
      asks.push({
        key: `sync:${z.zone.key}:${i}`,
        step: "export",
        kind: "sync stale",
        subject: ids[i]!,
        zoneKey: z.zone.key,
        question: `.r10 room ${room.r10.identifier} still holds ${fmtNum(room.r10.lastSyncedSqft, 0)} sf — the model says ${fmtNum(room.sqft, 0)} sf`,
        why: `The .r10 link is {file identity, room Identifier}, so this room is matched with certainty — only its area is stale. Accepting stages the new area for the next surgical sync; dismissing declares the .r10 value intentional, which is the right answer when RHVAC's area was hand-tuned for a reason.`,
        figures: `${delta > 0 ? "+" : ""}${fmtNum(delta, 0)} sf · synced ${room.r10.syncedAt.slice(0, 10)}`,
        home: `.r10 · room ${room.r10.identifier}`,
        homeNote: "upsert by Identifier, geometry-owned fields only",
        acceptLabel: "stage new area",
        dismissLabel: "keep the .r10",
        blocksExport: true,
        runId: room.provenance.runId,
        sourceSqft: room.provenance.sourceSqft,
        history: room.decisions,
        roomId: ids[i]!,
        priority: 6,
      });
    });
  }

  // Step 7 reconcile writes nothing — a cap violation is reportable, not answerable.
  for (const sys of world.systems) {
    if (!sys.overCap) continue;
    const zoneKey = sys.zoneKeys[0] ?? null;
    asks.push({
      key: `cap:${sys.tag}`,
      step: "export",
      kind: "sensible cap",
      subject: sys.tag,
      zoneKey,
      question: `${fmtNum(sys.sensibleBtuh - SENSIBLE_CAP_BTUH, 0)} Btu/hr over the ${fmtNum(SENSIBLE_CAP_BTUH, 0)} sensible cap — resolve in the design, not here`,
      why: `Reconcile is a report: it writes nothing, anywhere. This System's sensible load exceeds the equipment constraint, which is a design decision about zoning or equipment selection, not a call this queue can record. The row is unanswerable on purpose — it exists so the violation cannot be missed.`,
      figures: `${fmtNum(sys.sensibleBtuh, 0)} sens · ${fmtNum(sys.latentBtuh, 0)} lat · ${sys.zoneKeys.length} zones`,
      home: null,
      acceptLabel: "accept",
      dismissLabel: "dismiss",
      runId: null,
      sourceSqft: null,
      history: [],
      priority: 92,
    });
  }

  return asks.sort((a, b) => a.priority - b.priority || a.key.localeCompare(b.key));
}

// ── Page ────────────────────────────────────────────────────────────────────

type GroupMode = "none" | "step" | "zone" | "kind";

export function Variant() {
  const world = useMemo(() => mockWorld(), []);
  const idsByZone = useMemo(
    () => new Map(world.zones.map((z) => [z.zone.key, roomIds(z)])),
    [world],
  );
  const asks = useMemo(() => buildAsks(world, idsByZone), [world, idsByZone]);

  const [done, setDone] = useState<Record<string, Receipt>>({});
  const [stepFacet, setStepFacet] = useState<StepKey | null>(null);
  const [zoneFacet, setZoneFacet] = useState<string | null>(null);
  const [kindFacet, setKindFacet] = useState<string | null>(null);
  const [group, setGroup] = useState<GroupMode>("none");
  const [cursor, setCursor] = useState(0);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [showReceipts, setShowReceipts] = useState(false);

  const inScope = useMemo(
    () =>
      asks.filter(
        (a) =>
          (!stepFacet || a.step === stepFacet) &&
          (!zoneFacet || a.zoneKey === zoneFacet) &&
          (!kindFacet || a.kind === kindFacet),
      ),
    [asks, stepFacet, zoneFacet, kindFacet],
  );

  const groupKey = (a: Ask) =>
    group === "step" ? STEP_META[a.step].label : group === "zone" ? (a.zoneKey ?? "no zone") : a.kind;

  const visible = useMemo(() => {
    const open = inScope.filter((a) => !done[a.key]);
    const rows = showReceipts ? inScope : open;
    if (group === "none") return rows;
    const order = new Map<string, number>();
    for (const a of rows) if (!order.has(groupKey(a))) order.set(groupKey(a), order.size);
    return [...rows].sort(
      (a, b) => order.get(groupKey(a))! - order.get(groupKey(b))! || a.priority - b.priority,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inScope, done, group, showReceipts]);

  const cursorAsk = visible[Math.min(cursor, visible.length - 1)] ?? null;
  const openCount = inScope.filter((a) => !done[a.key]).length;

  const rowRefs = useRef(new Map<string, HTMLLIElement>());

  const resolve = (ask: Ask, verb: string) => {
    if (!ask.home) return;
    setDone((prev) => ({ ...prev, [ask.key]: { verb, at: SESSION_AT, runId: SESSION_RUN } }));
  };

  // Keyboard-first triage. Re-bound every render so the handler always sees fresh state; the
  // variant switcher owns ArrowLeft/Right, so the cursor lives on j/k and ArrowUp/Down.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      const move = (d: number) => {
        e.preventDefault();
        setCursor((c) => Math.max(0, Math.min(visible.length - 1, c + d)));
      };
      if (e.key === "j" || e.key === "ArrowDown") return move(1);
      if (e.key === "k" || e.key === "ArrowUp") return move(-1);
      if (!cursorAsk) return;
      if (e.key === "Enter") {
        e.preventDefault();
        setExpanded((x) => (x === cursorAsk.key ? null : cursorAsk.key));
      } else if (e.key === "a" && !cursorAsk.choices) {
        resolve(cursorAsk, cursorAsk.acceptLabel);
      } else if (e.key === "d" && !cursorAsk.choices) {
        resolve(cursorAsk, cursorAsk.dismissLabel);
      } else if (cursorAsk.choices && /^[1-3]$/.test(e.key)) {
        const choice = cursorAsk.choices[Number(e.key) - 1];
        if (choice) resolve(cursorAsk, choice.label);
      } else if (e.key === "u") {
        setDone((prev) => {
          const next = { ...prev };
          delete next[cursorAsk.key];
          return next;
        });
      } else if (e.key === "Escape") {
        setStepFacet(null);
        setZoneFacet(null);
        setKindFacet(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  useEffect(() => {
    if (cursorAsk) rowRefs.current.get(cursorAsk.key)?.scrollIntoView({ block: "nearest" });
  }, [cursorAsk]);

  // ── Burn-down census ──────────────────────────────────────────────────────
  const census = (subset: Ask[]) => ({
    total: subset.length,
    done: subset.filter((a) => done[a.key]).length,
  });
  const byStep = STEP_KEYS.map((s) => ({ step: s, ...census(asks.filter((a) => a.step === s)) }));
  const zoneRows = useMemo(() => {
    const keys = [...new Set(asks.map((a) => a.zoneKey).filter((k): k is string => k !== null))];
    return keys
      .map((k) => ({ key: k, ...census(asks.filter((a) => a.zoneKey === k)) }))
      .sort((a, b) => b.total - b.done - (a.total - a.done) || a.key.localeCompare(b.key));
  }, [asks, done]);
  const kindRows = useMemo(() => {
    const keys = [...new Set(asks.map((a) => a.kind))];
    return keys
      .map((k) => ({ key: k, step: asks.find((a) => a.kind === k)!.step, ...census(asks.filter((a) => a.kind === k)) }))
      .sort((a, b) => b.total - a.total);
  }, [asks, done]);

  const totalOpen = asks.filter((a) => !done[a.key]).length;
  const blocked = asks.filter((a) => a.blocksExport && !done[a.key]).length;

  const scopeLabel = zoneFacet ?? (stepFacet ? STEP_META[stepFacet].label : (kindFacet ?? "everything"));

  return (
    <main className="min-h-screen bg-background">
      <header className="sticky top-0 z-20 flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border bg-background/95 px-3 py-1.5 backdrop-blur">
        <h1 className="font-pe-display text-lg font-semibold tracking-tight">Inbox</h1>
        <span className="tele text-muted-foreground">every call the pipeline needs a human for</span>
        <Live>{world.docName}</Live>
        <span className="tele text-muted-foreground">{world.r10Path}</span>
        <div className="ml-auto flex items-center gap-2">
          <span className="tele">
            <span className={cn(totalOpen === 0 && "text-cat-green")}>{totalOpen}</span>{" "}
            <span className="text-muted-foreground">open</span>
          </span>
          <span className="tele text-muted-foreground">
            <span className={cn(blocked > 0 && "text-cat-blue")}>{blocked}</span> blocking export
          </span>
          <span className="tele text-muted-foreground">
            {Object.keys(done).length} decided this session
          </span>
        </div>
      </header>

      <div className="grid min-h-[calc(100vh-2.25rem)] grid-cols-[13.5rem_minmax(0,1fr)_25rem] divide-x divide-[var(--line)]">
        {/* ── Facet rail: the only progress view. Progress = queue emptiness. ── */}
        <aside className="sticky top-9 h-[calc(100vh-2.25rem)] overflow-y-auto px-2 py-2">
          <p className="section-label mb-1">burn-down · pipeline</p>
          <ul className="mb-3 space-y-1.5">
            {byStep.map((row) => (
              <li key={row.step}>
                <FacetLine
                  label={`${STEP_META[row.step].n} ${STEP_META[row.step].label}`}
                  total={row.total}
                  done={row.done}
                  meta={STEP_META[row.step]}
                  active={stepFacet === row.step}
                  onClick={() => setStepFacet(stepFacet === row.step ? null : row.step)}
                />
              </li>
            ))}
          </ul>

          <p className="section-label mb-1">
            burn-down · zones
            <span className="tele ml-1.5 normal-case text-muted-foreground">
              {zoneRows.filter((z) => z.total > z.done).length} unclear
            </span>
          </p>
          <ul className="mb-3 space-y-1">
            {zoneRows.slice(0, 14).map((row) => {
              const z = world.zones.find((w) => w.zone.key === row.key)!;
              return (
                <li key={row.key} className="flex items-center gap-1">
                  <ZoneThumb zone={z.zone} className="size-5" />
                  <div className="min-w-0 flex-1">
                    <FacetLine
                      label={row.key}
                      total={row.total}
                      done={row.done}
                      meta={STEP_META.review}
                      active={zoneFacet === row.key}
                      onClick={() => setZoneFacet(zoneFacet === row.key ? null : row.key)}
                    />
                  </div>
                </li>
              );
            })}
          </ul>

          <p className="section-label mb-1">by kind</p>
          <ul className="space-y-px">
            {kindRows.map((row) => (
              <li key={row.key}>
                <button
                  type="button"
                  onClick={() => setKindFacet(kindFacet === row.key ? null : row.key)}
                  className={cn(
                    "tele flex w-full items-baseline gap-1.5 rounded-[var(--radius)] px-1 py-px text-left hover:bg-muted",
                    kindFacet === row.key && "bg-primary/10",
                  )}
                >
                  <span className={cn("size-1.5 shrink-0 rounded-full", STEP_META[row.step].fill)} />
                  <span className="min-w-0 flex-1 truncate normal-case">{row.key}</span>
                  <span className={cn(row.total === row.done ? "text-cat-green" : "text-muted-foreground")}>
                    {row.total - row.done}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </aside>

        {/* ── The queue: the hero ────────────────────────────────────────── */}
        <section className="min-w-0">
          <div className="sticky top-9 z-10 flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-[var(--line)] bg-background/95 px-2 py-1 backdrop-blur">
            <span className="section-label">{scopeLabel}</span>
            <span className="tele text-muted-foreground">
              {openCount} open of {inScope.length}
            </span>
            {(stepFacet || zoneFacet || kindFacet) && (
              <Button
                size="xs"
                variant="ghost"
                onClick={() => {
                  setStepFacet(null);
                  setZoneFacet(null);
                  setKindFacet(null);
                }}
              >
                clear filters (esc)
              </Button>
            )}
            <span className="ml-auto flex items-center gap-1">
              <span className="tele-label text-muted-foreground">group</span>
              {(["none", "step", "zone", "kind"] as GroupMode[]).map((g) => (
                <button
                  key={g}
                  type="button"
                  onClick={() => setGroup(g)}
                  className={cn(
                    "tele rounded-[var(--radius)] border px-1 py-px",
                    group === g
                      ? "border-foreground/25 bg-foreground/10"
                      : "border-transparent text-muted-foreground hover:bg-muted",
                  )}
                >
                  {g}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setShowReceipts((s) => !s)}
                className={cn(
                  "tele rounded-[var(--radius)] border px-1 py-px",
                  showReceipts
                    ? "border-foreground/25 bg-foreground/10"
                    : "border-transparent text-muted-foreground hover:bg-muted",
                )}
              >
                receipts
              </button>
            </span>
            <span className="tele w-full text-muted-foreground">
              <Kbd>j</Kbd>
              <Kbd>k</Kbd> move · <Kbd>a</Kbd> accept the recalc · <Kbd>d</Kbd> keep the designer's ·{" "}
              <Kbd>1-3</Kbd> holds · <Kbd>↵</Kbd> expand · <Kbd>u</Kbd> undo
            </span>
          </div>

          {openCount === 0 ? (
            <Payoff
              scope={scopeLabel}
              step={stepFacet}
              total={inScope.length}
              receipts={inScope.filter((a) => done[a.key]).length}
              blockedElsewhere={blocked}
              onShowReceipts={() => setShowReceipts(true)}
              showingReceipts={showReceipts}
            />
          ) : null}

          <ul className="min-w-[58rem] divide-y divide-[var(--line-soft)] overflow-x-auto">
            {visible.map((ask, i) => {
              const receipt = done[ask.key];
              const prev = visible[i - 1];
              const header = group !== "none" && (!prev || groupKey(prev) !== groupKey(ask));
              return (
                <li
                  key={ask.key}
                  ref={(el) => {
                    if (el) rowRefs.current.set(ask.key, el);
                  }}
                  className={cn(
                    "scroll-mt-24",
                    cursorAsk?.key === ask.key && "bg-primary/[0.06]",
                    receipt && "opacity-60",
                  )}
                >
                  {header && (
                    <p className="section-label border-y border-[var(--line-soft)] bg-muted/50 px-2 py-0.5">
                      {groupKey(ask)}
                      <span className="tele ml-1.5 normal-case text-muted-foreground">
                        {visible.filter((a) => groupKey(a) === groupKey(ask) && !done[a.key]).length} open
                      </span>
                    </p>
                  )}
                  <AskRow
                    ask={ask}
                    receipt={receipt}
                    focused={cursorAsk?.key === ask.key}
                    expanded={expanded === ask.key}
                    onFocus={() => setCursor(i)}
                    onToggle={() => setExpanded((x) => (x === ask.key ? null : ask.key))}
                    onResolve={(verb) => {
                      setCursor(i);
                      resolve(ask, verb);
                    }}
                    onUndo={() =>
                      setDone((prev2) => {
                        const next = { ...prev2 };
                        delete next[ask.key];
                        return next;
                      })
                    }
                  />
                </li>
              );
            })}
          </ul>
        </section>

        {/* ── Peek flank: context for the row under the cursor ───────────── */}
        <aside className="sticky top-9 h-[calc(100vh-2.25rem)] overflow-y-auto">
          <Peek
            ask={cursorAsk}
            world={world}
            idsByZone={idsByZone}
            receipt={cursorAsk ? done[cursorAsk.key] : undefined}
            stepFacet={stepFacet}
            zoneFacet={zoneFacet}
          />
        </aside>
      </div>
    </main>
  );
}

// ── Row ─────────────────────────────────────────────────────────────────────

function AskRow({
  ask,
  receipt,
  focused,
  expanded,
  onFocus,
  onToggle,
  onResolve,
  onUndo,
}: {
  ask: Ask;
  receipt: Receipt | undefined;
  focused: boolean;
  expanded: boolean;
  onFocus: () => void;
  onToggle: () => void;
  onResolve: (verb: string) => void;
  onUndo: () => void;
}) {
  const meta = STEP_META[ask.step];
  const homeless = ask.home === null;
  return (
    <div className={cn("px-1.5 py-0.5", homeless && !receipt && "bg-destructive/[0.04]")}>
      <div
        className="grid cursor-default grid-cols-[0.75rem_7.5rem_9rem_4.5rem_minmax(8rem,1fr)_9rem_11rem_9.5rem] items-baseline gap-x-2"
        onMouseDown={onFocus}
      >
        <span className={cn("tele", focused ? "text-primary" : "text-transparent")}>›</span>

        <span
          className={cn(
            "tele truncate rounded-[var(--radius)] border px-1 py-px",
            meta.text,
            meta.tint,
            meta.line,
            homeless && "border-destructive/30 bg-destructive/10 text-destructive",
          )}
          title={`step ${meta.n} — ${meta.label}`}
        >
          {ask.kind}
        </span>

        <button type="button" className="truncate text-left text-xs font-medium hover:underline" onClick={onToggle}>
          {ask.subject}
        </button>

        <span className="tele truncate text-muted-foreground">{ask.zoneKey ?? "—"}</span>

        <span className={cn("truncate text-xs", expanded ? "text-foreground" : "text-muted-foreground")}>
          {ask.question}
        </span>

        <span className="tele truncate text-right text-muted-foreground" title={ask.figures}>
          {ask.figures}
        </span>

        <span
          className={cn("tele truncate", homeless ? "text-destructive" : "text-muted-foreground")}
          title={ask.homeNote ?? "no home — this row cannot be written through"}
        >
          {homeless ? "no home to write to" : `→ ${ask.home}`}
        </span>

        <span className="flex items-center justify-end gap-0.5">
          {receipt ? (
            <>
              <span className="tele truncate text-cat-green" title={`${receipt.verb} · ${receipt.runId}`}>
                {receipt.verb}
              </span>
              <Button size="xs" variant="ghost" onClick={onUndo}>
                undo
              </Button>
            </>
          ) : ask.choices ? (
            <span className="tele text-muted-foreground">hold · pick below</span>
          ) : (
            <>
              <Button
                size="xs"
                variant="ghost"
                disabled={homeless}
                title={homeless ? "no home to write to" : ask.acceptLabel}
                onClick={() => onResolve(ask.acceptLabel)}
              >
                accept
              </Button>
              <Button
                size="xs"
                variant="ghost"
                disabled={homeless}
                title={homeless ? "no home to write to" : ask.dismissLabel}
                onClick={() => onResolve(ask.dismissLabel)}
              >
                dismiss
              </Button>
            </>
          )}
        </span>
      </div>

      {/* Holds are the only multi-choice rows — they get their own line, always visible. */}
      {ask.choices && !receipt && (
        <div className="mt-0.5 ml-[9.5rem] flex flex-wrap items-center gap-1">
          {ask.choices.map((choice, n) => (
            <button
              key={choice.id}
              type="button"
              onClick={() => onResolve(choice.label)}
              className="tele rounded-[var(--radius)] border border-cat-green/25 bg-cat-green/[0.08] px-1.5 py-px text-left hover:bg-cat-green/20"
              title={choice.note}
            >
              <span className="mr-1 text-muted-foreground">{n + 1}</span>
              {choice.label}
              <span className="ml-1.5 normal-case text-muted-foreground">{choice.note}</span>
            </button>
          ))}
        </div>
      )}

      {receipt && (
        <p className="tele ml-[9.5rem] truncate text-muted-foreground">
          written through · {receipt.verb} · {receipt.at} · {receipt.runId} · {ask.home}
        </p>
      )}

      {expanded && (
        <p className="ml-[9.5rem] max-w-3xl py-1 text-xs leading-relaxed text-muted-foreground">
          {ask.why}
        </p>
      )}
    </div>
  );
}

// ── Facet line + burn-down ──────────────────────────────────────────────────

function FacetLine({
  label,
  total,
  done,
  meta,
  active,
  onClick,
}: {
  label: string;
  total: number;
  done: number;
  meta: (typeof STEP_META)[StepKey];
  active: boolean;
  onClick: () => void;
}) {
  const clear = total === done;
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "w-full rounded-[var(--radius)] px-1 py-0.5 text-left hover:bg-muted",
        active && "bg-primary/10",
      )}
    >
      <span className="tele flex items-baseline gap-1">
        <span className={cn("min-w-0 flex-1 truncate normal-case", clear ? "text-muted-foreground" : meta.text)}>
          {label}
        </span>
        <span className={cn(clear ? "text-cat-green" : "text-foreground")}>
          {clear ? "clear" : total - done}
        </span>
      </span>
      <BurnBar total={total} done={done} meta={meta} />
    </button>
  );
}

/** Burn-down as ticks: one tick per call, filled as it is answered. The bar empties, not fills —
 *  that is the honest direction for a queue. Above 36 rows it degrades to a proportional bar. */
function BurnBar({ total, done, meta }: { total: number; done: number; meta: (typeof STEP_META)[StepKey] }) {
  if (total === 0) return <div className="mt-0.5 h-[3px] bg-[var(--line-soft)]" />;
  if (total > 36)
    return (
      <div className={cn("mt-0.5 h-[3px]", meta.rest)}>
        <div className={cn("h-full", meta.fill)} style={{ width: `${(done / total) * 100}%` }} />
      </div>
    );
  return (
    <div className="mt-0.5 flex h-[3px] gap-px">
      {Array.from({ length: total }, (_, i) => (
        <div key={i} className={cn("h-full flex-1", i < done ? meta.fill : meta.rest)} />
      ))}
    </div>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <span className="tele mx-px rounded-[var(--radius)] border border-[var(--line-2)] px-1 text-foreground">
      {children}
    </span>
  );
}

// ── Empty-queue payoff ──────────────────────────────────────────────────────

function Payoff({
  scope,
  step,
  total,
  receipts,
  blockedElsewhere,
  onShowReceipts,
  showingReceipts,
}: {
  scope: string;
  step: StepKey | null;
  total: number;
  receipts: number;
  blockedElsewhere: number;
  onShowReceipts: () => void;
  showingReceipts: boolean;
}) {
  const meta = step ? STEP_META[step] : STEP_META.review;
  return (
    <div className="border-b border-[var(--line)] px-6 py-8">
      <div className="mx-auto max-w-xl">
        <p className="section-label mb-1 text-cat-green">inbox zero</p>
        <h2 className="font-pe-display text-2xl leading-tight font-semibold tracking-tight">
          {scope === "everything" ? "Nothing is waiting on a human." : `${scope} is clear.`}
        </h2>
        <div className="mt-3 flex h-[3px] gap-px">
          {Array.from({ length: Math.max(total, 1) }, (_, i) => (
            <div key={i} className="h-full flex-1 bg-cat-green" />
          ))}
        </div>
        <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
          {receipts > 0
            ? `${receipts} call${receipts === 1 ? "" : "s"} answered, each written through to its home at decision time — there is no batch commit to remember and no sidecar to lose. `
            : "There was never anything here to decide. "}
          {step
            ? meta.unblocks
            : blockedElsewhere > 0
              ? `${blockedElsewhere} row${blockedElsewhere === 1 ? "" : "s"} elsewhere still block export.`
              : "The .r10 matches the model. A revision from here is a diff, not a redraw."}
        </p>
        <div className="mt-3 flex items-center gap-2">
          {receipts > 0 && !showingReceipts && (
            <Button size="sm" variant="outline" onClick={onShowReceipts}>
              show {receipts} receipt{receipts === 1 ? "" : "s"}
            </Button>
          )}
          <span className="tele text-muted-foreground">
            press <Kbd>esc</Kbd> to widen the scope
          </span>
        </div>
      </div>
    </div>
  );
}

// ── Peek flank ──────────────────────────────────────────────────────────────

function Peek({
  ask,
  world,
  idsByZone,
  receipt,
  stepFacet,
  zoneFacet,
}: {
  ask: Ask | null;
  world: MockWorld;
  idsByZone: Map<string, string[]>;
  receipt: Receipt | undefined;
  stepFacet: StepKey | null;
  zoneFacet: string | null;
}) {
  const zone = ask?.zoneKey ? (world.zones.find((z) => z.zone.key === ask.zoneKey) ?? null) : null;
  const run = useMemo(
    () => (zone ? synthRun(zone, idsByZone.get(zone.zone.key)!) : null),
    [zone, idsByZone],
  );

  if (!ask)
    return (
      <div className="p-3">
        <p className="tele text-muted-foreground">
          no row under the cursor — press <Kbd>j</Kbd> to start triage.
        </p>
      </div>
    );

  const meta = STEP_META[ask.step];
  const url = `/takeoff?q=${[
    stepFacet ? `step:${stepFacet}` : null,
    zoneFacet ? `zone:${encodeURIComponent(zoneFacet)}` : null,
  ]
    .filter(Boolean)
    .join("+")}&row=${encodeURIComponent(ask.key)}`;

  return (
    <div className="divide-y divide-[var(--line)]">
      <div className="px-2.5 py-2">
        <p className="flex items-baseline gap-1.5">
          <span className={cn("tele rounded-[var(--radius)] border px-1 py-px", meta.text, meta.tint, meta.line)}>
            step {meta.n}
          </span>
          <span className="section-label">{meta.label}</span>
        </p>
        <h2 className="mt-1 font-pe-display text-base leading-tight font-semibold tracking-tight">
          {ask.subject}
        </h2>
        <p className="mt-1 text-xs leading-relaxed">{ask.question}</p>
      </div>

      {zone && run && (
        <div>
          <div className="flex items-center gap-1.5 px-2.5 py-1">
            <ZoneThumb zone={zone.zone} className="size-5" />
            <span className="tele">{zone.zone.key}</span>
            <span className="tele truncate text-muted-foreground">
              {zone.name} · {fmtNum(zone.zone.declaredSqft, 0)} sf · {zone.stage}
            </span>
          </div>
          <div className="h-56 border-y border-[var(--line)]">
            <ZonePlan zone={zone.zone} run={run} selectedSubject={ask.roomId ?? null} onSelect={() => {}} />
          </div>
          <p className="px-2.5 py-1">
            <Seam>
              rooms drawn as area-true squares on their real label points — the mock world carries
              points and areas, not boundaries
            </Seam>
          </p>
        </div>
      )}

      <div className="space-y-1 px-2.5 py-2">
        <p className="section-label">why this is a question</p>
        <p className="text-xs leading-relaxed text-muted-foreground">{ask.why}</p>
      </div>

      <div className="space-y-0.5 px-2.5 py-2">
        <p className="section-label mb-1">provenance</p>
        <PeekLine label="home" value={ask.home ?? "none — unanswerable here"} bad={!ask.home} />
        {ask.homeNote && <PeekLine label="" value={ask.homeNote} muted />}
        <PeekLine label="run" value={ask.runId ?? "—"} />
        <PeekLine
          label="source sf"
          value={ask.sourceSqft === null ? "—" : `${fmtNum(ask.sourceSqft, 0)} sf as detected`}
        />
        <PeekLine label="figures" value={ask.figures} />
        {ask.blocksExport && <PeekLine label="blocks" value="export refuses while this is open" />}
        {ask.history.length === 0 ? (
          <PeekLine label="history" value="no prior decision on this subject" muted />
        ) : (
          ask.history.map((h, i) => (
            <PeekLine key={i} label={i === 0 ? "history" : ""} value={`${h.verb} ${h.flag} · ${h.at.slice(0, 10)} · ${h.runId}`} />
          ))
        )}
        {receipt && (
          <p className="tele mt-1 rounded-[var(--radius)] border border-cat-green/25 bg-cat-green/[0.08] px-1.5 py-1 text-cat-green">
            {receipt.verb} · {receipt.at} · {receipt.runId}
            <span className="mt-0.5 block normal-case text-muted-foreground">
              written straight into {ask.home} — no batch commit, no sidecar
            </span>
          </p>
        )}
      </div>

      <div className="space-y-1 px-2.5 py-2">
        <p className="section-label">addressable</p>
        <p className="tele rounded-[var(--radius)] border border-[var(--line)] bg-muted/60 px-1.5 py-1 break-all text-muted-foreground">
          {url}
        </p>
        <Seam>
          routing is a proposal only — facets and cursor live in React state here; the real page
          would put scope in the query string so a row is linkable in review
        </Seam>
      </div>
    </div>
  );
}

function PeekLine({
  label,
  value,
  muted,
  bad,
}: {
  label: string;
  value: string;
  muted?: boolean;
  bad?: boolean;
}) {
  return (
    <p className="tele flex gap-1.5">
      <span className="w-16 shrink-0 text-right text-muted-foreground">{label}</span>
      <span
        className={cn(
          "min-w-0 flex-1 break-words",
          muted && "text-muted-foreground",
          bad && "text-destructive",
        )}
      >
        {value}
      </span>
    </p>
  );
}
