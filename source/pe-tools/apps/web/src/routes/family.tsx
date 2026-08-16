/**
 * /family — THE surface for ONE family, in one of two lanes.
 *
 * LANE LAW: binding IS the choice. The sentence's document slot lists the authored
 * family.json documents AND, whenever the bound session has a family open, one live entry
 * ("the open family editor"). Picking one binds its lane; there is no toggle, and the lane is
 * only ever DISPLAYED — as a chip beside the sentence.
 *
 *   AUTHORED — a family.json. route:settings owns the document (snapshot, field trichotomy,
 *     validate/save lifecycle); route:family owns the sibling context: spec doc (OCR blocks +
 *     image ids) and Revit evidence (resolved per-type values, provenance-stamped for
 *     staleness). Anatomy pane + type matrix + geometry table + grounded doc pane.
 *   LIVE — the family open in the bound session's family editor, via family.editor.snapshot.
 *     Same matrix, formula column, review/staging machinery, doc pane, and inspector; NO
 *     anatomy (a live family has no authored constituents to draw), no build/evidence lane,
 *     no validate command. Save is family.editor.apply, where per-edit failure is real.
 *
 * CAPTURE IS THE BRIDGE: in the live lane the capture verb promotes the live family to an
 * authored document (capture_evidence → settings create → bind), landing the user in the
 * authored lane of the same family. That is the ONLY crossing between the lanes.
 *
 * PANE COMPOSITION (mirrors /takeoffs): an IDENTITY row (what is bound, in which lane, and
 * nothing else), one slim status strip carrying the machine-measured facts on the left and the
 * verbs that act on them on the right — review · evidence · create, hairline-separated and
 * stage-aware — and a trouble line that exists only when a refusal, a receipt, or a hint has
 * something to say.
 *
 * Then the workspace. The anatomy is the VISUAL pane (collapsible, its chrome survives
 * collapse — the collapsed state is what the old "parameters only" mode used to be); the matrix over the
 * geometry table is the CONTENT pane; the grounded cut sheet is a full-height INSPECTOR
 * column, always rendered, with the parameter inspector as a strip beneath it when a
 * parameter is pinned. In the live lane there is no anatomy at all, so the layout drops to a
 * two-pane split rather than reserving an empty visual row.
 *
 * PROVENANCE LAW: one focus, four surfaces — see `#/family/focus`. Hovering a shape, a card,
 * a chip, a matrix cell, or a geometry row lights the same set everywhere and points the doc
 * pane's camera at that value's citations. Hover asks; pinning commits. Esc steps back out
 * one commitment at a time: pinned citation → pinned parameter → hover.
 */
import { createFileRoute } from "@tanstack/react-router";
import { Suspense, lazy, useEffect, useMemo, useRef, useState } from "react";

import {
  type SettingsProposalSource,
  settingsFieldPointer,
  settingsFieldSegments,
} from "@pe/agent-contracts";

import { ThemeToggle } from "#/components/ThemeToggle";
import { RfaChip, RvtChip } from "#/components/document-chips";
import { Sentence, type SlotSpec } from "#/components/sentence";
import { Pane, PaneSplit, PaneWorkspace } from "#/components/ui/pane";
import { AnatomyPane } from "#/family/anatomy";
import {
  type CitationTarget,
  FamilyDocPane,
  buildGrounding,
  resolveCitations,
  useFamilyGrounding,
} from "#/family/doc-pane";
import { focusParamNames, mergeFocus, type Focus } from "#/family/focus";
import { authoredFormulaParams, formulaAncestry } from "#/family/formula";
import { FamilyInspector } from "#/family/inspector";
import {
  LIVE_DOCUMENT_ENTRY,
  type LiveApplyFailure,
  type LiveLaneApi,
  readAgo,
  useFamilyEditorLane,
} from "#/family/live";
import { GeometryTable, TypeMatrix, type CiteContext, type ReviewMarkState } from "#/family/matrix";
import { paramAssociations, paramSpec, type FamilyModel } from "#/family/model";
import {
  FAMILY_MODULE,
  type EvidenceSlice,
  type FamilyStore,
  type FieldState,
  useLiveFamilyStore,
  useMockFamilyStore,
} from "#/family/store";
import { SAMPLE_DOC } from "#/grounded-doc/sample";
import { cn } from "#/lib/utils";

export const Route = createFileRoute("/family")({
  /** Every param is optional, so every `<Link to="/family">` stays search-free. */
  validateSearch: (
    search: Record<string, unknown>,
  ): { mock?: true; family?: string; thread?: string; variant?: string } => ({
    mock: search.mock != null && search.mock !== false ? true : undefined,
    /** PROTOTYPE — `?variant=<key>` mounts the clean-room mock variants (family/proto). */
    variant:
      typeof search.variant === "string" && search.variant.trim()
        ? search.variant.trim()
        : undefined,
    /** `?family=<elementId>` — /families row navigation. The URL is the only state. */
    family:
      typeof search.family === "string" && search.family.trim() ? search.family.trim() : undefined,
    /** `?thread=<id>` — the chat side pane iframes this route with a thread id, and
     * `#/workbench/route-state` reads it straight off the URL to scope route state to that
     * conversation. Declared here so the router KEEPS it: an undeclared param is dropped on
     * the first navigation, and the pane silently falls back to workspace scope. */
    thread:
      typeof search.thread === "string" && search.thread.trim() ? search.thread.trim() : undefined,
  }),
  component: FamilyRoute,
});

/** PROTOTYPE — lazy so the throwaway variant costs nothing on the real route. */
const FamilyProto = lazy(() =>
  import("#/family/proto/variants").then((m) => ({ default: m.FamilyProto })),
);

/** The store seam is chosen once, here: `?mock` mounts a self-contained fixture. */
function FamilyRoute() {
  const { mock, variant } = Route.useSearch();
  if (variant)
    return (
      <Suspense fallback={null}>
        <FamilyProto />
      </Suspense>
    );
  return mock ? <MockFamily /> : <LiveFamily />;
}

function MockFamily() {
  return <Page store={useMockFamilyStore()} lane={AUTHORED_LANE} />;
}

// ── the two lanes ───────────────────────────────────────────────────────────────────────────────

/** What the route knows about the lane it is in. `live` is present only in the live lane. */
interface Lane {
  kind: "authored" | "live";
  /** Chip text beside the sentence — the lane is DISPLAYED, never toggled. */
  chip: string;
  live: LiveLaneApi | null;
}

const AUTHORED_LANE: Lane = { kind: "authored", chip: "authored · family.json", live: null };

/**
 * The lane chooser. It holds one piece of state — which document slot entry is bound — and
 * everything else follows from it. A live entry appears only while the bound session's
 * ACTIVE document is a family document; if that stops being true, the lane falls back to
 * authored rather than rendering a stale snapshot.
 */
function LiveFamily() {
  const { family: requestedFamily } = Route.useSearch();
  const authored = useLiveFamilyStore();
  const [wantsLive, setWantsLive] = useState(false);
  const { store: liveStore, api } = useFamilyEditorLane(authored, wantsLive);

  /* `?family=<id>` — /families row navigation. Opening it in the family editor is what
     MAKES the live lane available, so this does not wait for availability; it waits only
     for a bound world. Once per id, then out of the way: the URL is the only state. */
  const apiRef = useRef(api);
  apiRef.current = api;
  const requested = useRef<string | null>(null);
  useEffect(() => {
    if (!requestedFamily || !authored.boundTarget || requested.current === requestedFamily) return;
    requested.current = requestedFamily;
    setWantsLive(true);
    void apiRef.current.openFamily(requestedFamily);
  }, [requestedFamily, authored.boundTarget]);

  const live = wantsLive && api.available;
  const lane: Lane = live
    ? { kind: "live", chip: `live · ${api.world ?? "bound world"}`, live: api }
    : AUTHORED_LANE;

  return (
    <Page
      store={live ? liveStore : authored}
      lane={lane}
      liveEntry={api.available ? LIVE_DOCUMENT_ENTRY : null}
      onPickLane={setWantsLive}
    />
  );
}

// ── header verbs ────────────────────────────────────────────────────────────────────────────────

/* ponytail: second copy of the /families `Verb` — promote both into components/ui the day a
   third route needs one. Two copies is not yet an abstraction. */
function Verb({
  label,
  onClick,
  disabled,
  reason,
  busy,
  tone,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  /** Say what the verb MEANS and what pressing it DOES — or, when disabled, why it will not. */
  reason: string;
  busy?: boolean;
  /** "commit" is the one verb that writes: it wears the pe-blue border, nothing else does. */
  tone?: "commit";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || busy}
      title={reason}
      className={cn(
        "tele h-6 shrink-0 rounded-[2px] border px-2",
        disabled || busy
          ? "cursor-not-allowed border-[var(--line-soft)] text-muted-foreground"
          : tone === "commit"
            ? "border-[var(--pe-blue)] text-[var(--pe-blue)] hover:bg-[var(--pe-blue)]/10"
            : "border-[var(--line-2)] text-foreground hover:border-[var(--pe-blue)]",
      )}
    >
      {busy ? `${label}…` : label}
    </button>
  );
}

// ── document plumbing ───────────────────────────────────────────────────────────────────────────

const MINIMAL_TEMPLATE = (name: string) =>
  JSON.stringify(
    {
      family: {
        name,
        category: "Generic Models",
        template: "Generic Model",
        placement: "Unhosted",
      },
      familyParameters: {
        Width: { dataType: "Length (Common)", value: "24in" },
        Depth: { dataType: "Length (Common)", value: "18in" },
        Height: { dataType: "Length (Common)", value: "30in" },
      },
      types: { Standard: {} },
      solids: {
        body: {
          kind: "Prism",
          frame: "frame:family",
          width: "param:Width",
          depth: "param:Depth",
          height: "param:Height",
        },
      },
    },
    null,
    2,
  );

function parseModel(
  rawContent: string | undefined,
  fields: Record<string, FieldState>,
): FamilyModel | null {
  if (!rawContent) return null;
  try {
    const parsed = JSON.parse(rawContent) as Record<string, unknown>;
    delete parsed.$schema;
    // A schema-invalid or partial document (mid-authoring, agent proposal) must render,
    // not crash the route — default the collections the render tree iterates.
    parsed.family ??= { name: "", category: "", template: "", placement: "" };
    parsed.familyParameters ??= {};
    parsed.types ??= {};
    for (const [pointer, field] of Object.entries(fields)) {
      if (field.staged != null) {
        applyJsonEdit(parsed, settingsFieldSegments(pointer), field.staged);
      }
    }
    return parsed as unknown as FamilyModel;
  } catch {
    return null;
  }
}

function applyJsonEdit(
  root: Record<string, unknown>,
  segments: string[],
  edit: { value?: unknown; delete?: true },
) {
  let cursor = root;
  for (const segment of segments.slice(0, -1)) {
    const child = cursor[segment];
    if (child == null || typeof child !== "object" || Array.isArray(child)) cursor[segment] = {};
    cursor = cursor[segment] as Record<string, unknown>;
  }
  if (segments.length === 0) return;
  const leaf = segments.at(-1)!;
  if (edit.delete === true) delete cursor[leaf];
  else cursor[leaf] = edit.value;
}

type JsonEdit = { value: unknown } | { delete: true };

function changedLeaves(
  before: unknown,
  after: unknown,
  prefix: string[] = [],
): Array<[string[], JsonEdit]> {
  if (Object.is(before, after)) return [];
  if (
    before != null &&
    after != null &&
    typeof before === "object" &&
    typeof after === "object" &&
    !Array.isArray(before) &&
    !Array.isArray(after)
  ) {
    const keys = new Set([
      ...Object.keys(before as Record<string, unknown>),
      ...Object.keys(after as Record<string, unknown>),
    ]);
    return [...keys].flatMap((key) =>
      changedLeaves(
        (before as Record<string, unknown>)[key],
        (after as Record<string, unknown>)[key],
        [...prefix, key],
      ),
    );
  }
  if (prefix.length === 0) return [];
  return [[prefix, after === undefined ? { delete: true } : { value: after }]];
}

/** Inject formula resolved values from evidence into the model for the drawing. */
function withEvidence(model: FamilyModel, evidence: EvidenceSlice | null): FamilyModel {
  if (!evidence) return model;
  const next = structuredClone(model);
  for (const parameter of evidence.parameters) {
    const spec = next.familyParameters[parameter.name] ?? next.sharedParameters?.[parameter.name];
    if (!spec?.formula) continue;
    spec.resolvedValues = {};
    for (const [typeName, resolved] of Object.entries(parameter.valuesPerType)) {
      if (resolved.value != null) spec.resolvedValues[typeName] = resolved.value;
    }
  }
  return next;
}

// ── pane geometry ───────────────────────────────────────────────────────────────────────────────

/** Chrome the anatomy pane keeps when collapsed: its toolbar, and nothing else. */
const ANATOMY_CHROME_PX = 34;
const ANATOMY_DEFAULT_PX = 380;
const ANATOMY_MIN_PX = 180;
const DOC_DEFAULT_PX = 480;
const DOC_MIN_PX = 320;
const GEOMETRY_DEFAULT_PX = 220;
const GEOMETRY_CHROME_PX = 32;

// ═══════════════════════════════════════════ PAGE ═══════════════════════════════════════════════

function Page({
  store,
  lane,
  liveEntry,
  onPickLane,
}: {
  store: FamilyStore;
  lane: Lane;
  /** The synthetic doc-slot entry that binds the live lane, or null when none is offered. */
  liveEntry?: string | null;
  onPickLane?: (live: boolean) => void;
}) {
  const live = lane.live;
  const [selectedType, setSelectedType] = useState<string>("");
  /** The hover half of the focus law. A pinned parameter outranks it — see `mergeFocus`. */
  const [hovered, setHovered] = useState<Focus>(null);
  const [selectedParam, setSelectedParam] = useState<string | null>(null);
  /** A constituent can also be PINNED, from the geometry table's constituent button. */
  const [pinnedConstituent, setPinnedConstituent] = useState<string | null>(null);
  const [cite, setCite] = useState<CiteContext | null>(null);
  /** A PINNED citation outranks hover, and survives the pointer leaving the cell. */
  const [pinnedCite, setPinnedCite] = useState<CiteContext | null>(null);
  const [anatomyCollapsed, setAnatomyCollapsed] = useState(false);
  const [liveFailures, setLiveFailures] = useState<LiveApplyFailure[]>([]);
  /** A commit-level refusal is staged nowhere; only per-edit failures are "still staged". */
  const commitFailure = liveFailures.find((failure) => failure.pointer === "commit") ?? null;
  const stagedLiveFailures = liveFailures.filter((failure) => failure.pointer !== "commit");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<{ text: string; atMs: number } | null>(null);
  const [lastSave, setLastSave] = useState<{ saved: number; failed: number } | null>(null);
  const [parsing, setParsing] = useState(false);

  const snapshot = store.snapshot;
  const isFamilyDocument = snapshot != null;
  const fields = store.fields;
  const model = useMemo(
    () => parseModel(snapshot?.rawContent, fields),
    [snapshot?.rawContent, fields],
  );

  const evidence: EvidenceSlice | null = store.evidence;
  /** Freshness is a TRI-state. A missing token is not freshness — it is the absence of the
   * fact freshness is judged by, and it must say so rather than borrow "fresh". */
  const evidenceFreshness: "fresh" | "stale" | "unverified" | null =
    evidence == null
      ? null
      : evidence.from.documentVersionToken == null
        ? "unverified"
        : evidence.from.documentVersionToken === snapshot?.versionToken
          ? "fresh"
          : "stale";
  /** The model every exhibit renders: authored truth with evidence's resolved values folded in. */
  const shown = useMemo(() => (model ? withEvidence(model, evidence) : null), [model, evidence]);

  const typeName =
    model && Object.hasOwn(model.types, selectedType)
      ? selectedType
      : (Object.keys(model?.types ?? {})[0] ?? "");

  // ── target: bound selector; resolution lives inside the sentence's world slot ──
  const boundTarget = store.boundTarget;
  /** The doc slot lists the authored documents AND, when offered, the live entry.
   * Picking one IS picking the lane — there is no separate control. */
  const documents = useMemo(
    () => (liveEntry ? [liveEntry, ...store.documents] : store.documents),
    [liveEntry, store.documents],
  );

  /** Every dispatcher write settles the same way: error text and the `hint` teaching
   * channel are distinct, and both are surfaced verbatim. */
  const settle = (result: { ok: boolean; error?: string; hint?: string }, fallback: string) => {
    setError(result.ok ? null : (result.error ?? fallback));
    setHint(result.ok ? null : (result.hint ?? null));
    return result.ok;
  };

  /** Binding IS the lane choice: the live entry binds the live lane, a path binds authored. */
  const pickDocument = async (relativePath: string) => {
    if (liveEntry && relativePath === liveEntry) {
      onPickLane?.(true);
      return;
    }
    onPickLane?.(false);
    setBusy("open");
    settle(
      await store.settingsCommand("open", {
        documentId: { ...FAMILY_MODULE, relativePath },
        target: boundTarget || undefined,
      }),
      "Could not open document.",
    );
    setBusy(null);
  };

  const createDocument = async (name: string) => {
    const relativePath = name.trim().replace(/\s+/g, "-").toLowerCase();
    if (!relativePath) return;
    setBusy("create");
    const ok = settle(
      await store.settingsCommand("create", {
        documentId: { ...FAMILY_MODULE, relativePath },
        rawContent: MINIMAL_TEMPLATE(name.trim()),
        target: boundTarget || undefined,
      }),
      "Could not create document.",
    );
    if (ok) store.refreshDocuments();
    setBusy(null);
  };

  // ── edits: diff → JSON Pointer patches into route:settings fields ─────────
  const update = (fn: (current: FamilyModel) => FamilyModel) => {
    if (!model) return;
    const next = fn(model);
    const patches = changedLeaves(model, next).flatMap(([segments, edit]) => {
      const pointer = settingsFieldPointer(segments);
      return [
        { path: ["fields", pointer, "staged"], value: edit },
        { path: ["fields", pointer, "review"], value: "good" },
      ];
    });
    if (patches.length > 0) void store.applyFields(patches);
  };

  const review = (pointer: string, action: "approve" | "deny") => {
    const field = fields[pointer];
    if (action === "approve" && field?.proposal != null) {
      const edit =
        field.proposal.delete === true ? { delete: true } : { value: field.proposal.value };
      void store.applyFields([
        { path: ["fields", pointer, "staged"], value: edit },
        { path: ["fields", pointer, "review"], value: "good" },
      ]);
    } else {
      void store.applyFields([
        { path: ["fields", pointer, "proposal"] },
        { path: ["fields", pointer, "review"], value: "none" },
      ]);
    }
  };

  /** acceptAll — stage every OPEN proposal in one write; already-staged fields are skipped
   * so a human's own edit is never overwritten by a batch accept. */
  const acceptAll = () => {
    const patches = Object.entries(fields)
      .filter(([, field]) => field.staged == null && field.proposal != null)
      .flatMap(([pointer, field]) => [
        {
          path: ["fields", pointer, "staged"],
          value:
            field.proposal!.delete === true ? { delete: true } : { value: field.proposal!.value },
        },
        { path: ["fields", pointer, "review"], value: "good" },
      ]);
    if (patches.length > 0) void store.applyFields(patches);
  };

  /** The tri-state review toggle writes a review patch BESIDE the staged edit. */
  const markReview = (pointer: string, next: ReviewMarkState) => {
    void store.applyFields([{ path: ["fields", pointer, "review"], value: next }]);
  };

  const run = async (name: "validate" | "save") => {
    setBusy(name);
    const result = await store.settingsCommand(
      name,
      name === "validate"
        ? { includeProposals: false, target: boundTarget || undefined }
        : { target: boundTarget || undefined },
    );
    const ok = settle(result, `${name} failed.`);
    if (name === "save") {
      const outcome = (result.result ?? {}) as {
        saved?: number;
        failures?: Array<{ key: string; error: string }>;
      };
      const saved = ok ? (outcome.saved ?? 0) : 0;
      const failed = outcome.failures?.length ?? (ok ? 0 : stagedCount);
      setLastSave({ saved, failed });
      if (ok && saved > 0) {
        setReceipt({
          text: `saved ${saved} field${saved === 1 ? "" : "s"} to ${snapshot?.documentId.relativePath ?? "the document"}`,
          atMs: Date.now(),
        });
      }
    }
    setBusy(null);
  };

  /** LIVE save: family.editor.apply. Per-edit failure is REAL here — the receipt reports
   * per-edit outcomes and every failed edit stays staged, so it can be fixed and retried. */
  const runLiveSave = async () => {
    if (!live) return;
    setBusy("save");
    setError(null);
    setHint(null);
    const outcome = await live.save();
    setLastSave({ saved: outcome.saved, failed: outcome.failed });
    setLiveFailures(outcome.failures);
    if (outcome.saved > 0)
      setReceipt({
        text: `applied ${outcome.saved} edit${outcome.saved === 1 ? "" : "s"} to ${live.familyName ?? "the family"}`,
        atMs: Date.now(),
      });
    if (live.error) setError(live.error);
    setBusy(null);
  };

  const discardStaged = async () => {
    const patches = Object.keys(fields).flatMap((pointer) => [
      { path: ["fields", pointer, "staged"] },
      { path: ["fields", pointer, "review"], value: "none" },
    ]);
    if (patches.length > 0) await store.applyFields(patches);
    setLiveFailures([]);
    if (live) live.refresh();
    else await store.settingsCommand("refresh", { target: boundTarget || undefined });
  };

  const captureEvidence = async () => {
    setBusy("capture");
    settle(await store.familyCommand("capture_evidence", {}), "Capture failed.");
    setBusy(null);
  };

  /**
   * CAPTURE IS THE BRIDGE. In the live lane the capture verb PROMOTES: read the live
   * family (revit.detail.family-model, via capture_evidence's modelJson), write it as a
   * new authored document, and let `create`'s own open bind it — so the user lands in the
   * authored lane of the same family, with one receipt on the sentence.
   */
  const captureToDocument = async () => {
    setBusy("capture");
    const captured = await store.familyCommand("capture_evidence", {
      target: boundTarget || undefined,
    });
    if (!settle(captured, "Capture failed.")) return setBusy(null);
    const result = (captured.result ?? {}) as { familyName?: string; modelJson?: string };
    if (!result.modelJson) {
      setError("Capture returned no model — nothing to promote.");
      return setBusy(null);
    }
    const name = result.familyName ?? live?.familyName ?? "captured-family";
    const relativePath = `captured/${name.trim().replace(/\s+/g, "-").toLowerCase()}.family.json`;
    const created = await store.settingsCommand("create", {
      documentId: { ...FAMILY_MODULE, relativePath },
      rawContent: result.modelJson,
      target: boundTarget || undefined,
    });
    if (settle(created, "Could not write the captured document.")) {
      store.refreshDocuments();
      onPickLane?.(false); // `create` opens what it wrote — follow it into the authored lane.
      setReceipt({ text: `captured ${name} to ${relativePath}`, atMs: Date.now() });
    }
    setBusy(null);
  };

  const buildEvidence = async () => {
    if (!snapshot) return;
    setBusy("build");
    settle(
      await store.familyCommand("build_evidence", { documentId: snapshot.documentId }),
      "Build failed.",
    );
    setBusy(null);
  };

  const parseSpec = async (input: { url?: string; file?: File }) => {
    setParsing(true);
    setError(null);
    try {
      if (input.file || input.url) {
        // Client-side parse: the endpoint lives on this origin, so both file uploads and
        // URLs go direct — the host-side parse_spec command can't reach the web server.
        const form = new FormData();
        if (input.file) form.append("file", input.file);
        else form.append("url", input.url!);
        const response = await fetch("/api/pdf-audit/parse", { method: "POST", body: form });
        const payload = (await response.json()) as {
          error?: string;
          jobId?: string;
          fileName?: string;
          blocks?: Array<{ id: string; page: number; kind: string; md: string }>;
          images?: Array<{ id: string; page: number; category: string }>;
        };
        if (!response.ok || payload.error) throw new Error(payload.error ?? "parse failed");
        await store.setSpecDoc({
          parseId: payload.jobId,
          fileName: payload.fileName,
          blocks: (payload.blocks ?? []).map(({ id, page, kind, md }) => ({ id, page, kind, md })),
          images: (payload.images ?? []).map(({ id, page, category }) => ({ id, page, category })),
        });
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setParsing(false);
    }
  };

  // ── focus: pinned outranks hovered, and one answer feeds all four surfaces ─────────────────
  const focus: Focus = mergeFocus(
    selectedParam
      ? { kind: "param", name: selectedParam }
      : pinnedConstituent
        ? { kind: "constituent", id: pinnedConstituent }
        : null,
    hovered,
  );

  const pinConstituent = (id: string) => {
    setSelectedParam(null);
    setPinnedConstituent((current) => (current === id ? null : id));
  };

  /* Esc is ONE ladder, one rung per press, most-committed first: a pinned citation, then a
     pinned subject, then the hover. Nothing else falls out of the page on a keystroke. */
  useEffect(() => {
    if (!pinnedCite && !selectedParam && !pinnedConstituent && !hovered) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input,select,textarea,[contenteditable=true]")) return;
      if (pinnedCite) setPinnedCite(null);
      else if (selectedParam) setSelectedParam(null);
      else if (pinnedConstituent) setPinnedConstituent(null);
      else setHovered(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pinnedCite, selectedParam, pinnedConstituent, hovered]);

  // ── grounding: the focus's citations, or a hovered cell's own ─────────────
  const { grounding: parsedGrounding } = useFamilyGrounding(store.doc?.parseId);
  /* SHIM — `?mock` has no parser and no spec doc, so the mock lane grounds against the
     synthetic sample sheet. This keeps the 70% story (cut sheet beside the matrix, hover a
     proposed cell, watch the camera land on the region it was read from) judgeable with no
     host. It is a fixture standing in for a parse; delete it when the mock store can carry a
     real parse id. */
  const grounding = useMemo(
    () => parsedGrounding ?? (store.isMock ? buildGrounding(SAMPLE_DOC) : null),
    [parsedGrounding, store.isMock],
  );

  /** The focus's own citations: for every parameter the focus lights, the sources staged or
   * proposed at its family pointer and — when the focus names a type — that type's override
   * pointer. This is what makes hovering a SHAPE move the doc pane's camera. */
  const focusCite = useMemo<CiteContext | null>(() => {
    if (!shown || !focus) return null;
    const names = focusParamNames(focus, shown);
    const focusType = focus.kind === "param" ? focus.typeName : undefined;
    for (const name of names) {
      const section = shown.familyParameters[name] ? "familyParameters" : "sharedParameters";
      const pointers = [
        [section, name, "value"],
        ...(focusType ? [["types", focusType, name]] : []),
        ["types", typeName, name],
      ];
      for (const segments of pointers) {
        const pointer = settingsFieldPointer(segments);
        const sources = (fields[pointer]?.proposal?.sources ?? []) as SettingsProposalSource[];
        if (sources.length > 0)
          return {
            label: focus.kind === "constituent" ? `${name} (via ${focus.id})` : name,
            sources,
          };
      }
    }
    return null;
  }, [shown, focus, typeName, fields]);

  /** GROUNDING FOCUS: a pin outranks a hovered cell, which outranks the shared focus. */
  const activeCite = pinnedCite ?? cite ?? focusCite;
  const citations: CitationTarget[] = useMemo(
    () => resolveCitations(grounding, activeCite?.sources).resolved,
    [grounding, activeCite],
  );
  const unresolvedCitations = useMemo(
    () => resolveCitations(grounding, activeCite?.sources).unresolved,
    [grounding, activeCite],
  );

  const stagedFields = Object.values(fields).filter((field) => field.staged != null);
  const stagedCount = stagedFields.length;
  const attentionCount = stagedFields.filter((field) => field.review === "attention").length;
  const proposalCount = Object.values(fields).filter(
    (field) => field.staged == null && field.proposal != null,
  ).length;

  /* ── client-side save gate. The server stays the enforcer (route:settings `save`
     refuses any staged field marked "attention"); this only makes the refusal legible
     BEFORE the round trip, with the reason on the button. ── */
  const saveBlockedReason = !isFamilyDocument
    ? "no family document open"
    : stagedCount === 0
      ? "nothing staged"
      : attentionCount > 0
        ? `${attentionCount} field${attentionCount === 1 ? " needs" : "s need"} attention`
        : null;

  /* ── inspector: everything derived from the AUTHORED model, no host round trip ── */
  const formulaParams = useMemo(
    () => authoredFormulaParams(model?.familyParameters, model?.sharedParameters),
    [model?.familyParameters, model?.sharedParameters],
  );
  const inspected = useMemo(() => {
    if (!model || !selectedParam) return null;
    const spec = paramSpec(model, selectedParam);
    if (!spec) return null;
    return {
      spec,
      origin: (model.familyParameters[selectedParam] ? "family" : "shared") as "family" | "shared",
      ...formulaAncestry(selectedParam, formulaParams),
      associations: paramAssociations(model, selectedParam),
    };
  }, [model, selectedParam, formulaParams]);

  /* ── the sentence's family slot: LIVE lane only, because only there is "which family"
     a targeting choice the surface can make. Picking one opens it in the family editor. ── */
  const sentenceSlots: SlotSpec[] | undefined = useMemo(() => {
    if (!live) return undefined;
    return [
      {
        key: "family",
        joiner: "—",
        text: live.familyName,
        placeholder: "pick a family",
        options: live.families,
        onPick: (id) => void live.openFamily(id),
        title:
          "Which family is open in the bound session's family editor. Picking one here actually opens it in Revit and re-reads the snapshot — this is a targeting choice with a side effect, not a filter.",
        empty:
          "No loaded families reported by the bound world. Load a family into the open project in Revit, or bind a world that has one.",
      },
    ];
  }, [live]);

  // The anatomy draws AUTHORED constituents; a live family has none, so the pane is absent —
  // not empty. Absence of the pane is the honest rendering of "there is nothing to draw".
  const anatomy = lane.kind === "authored" ? shown : null;

  const contentPane = (
    <Pane kind="content" scroll="clip">
      {shown ? (
        /* Matrix over geometry. The split (rather than one scrolling column) is what lets
           each table keep its own sticky header and its own filter strip. */
        <PaneSplit
          axis="vertical"
          resize={{
            target: "end",
            defaultSize: GEOMETRY_DEFAULT_PX,
            minSize: GEOMETRY_CHROME_PX,
            /* The matrix is THE table — it is never the squeezed one. */
            minOtherSize: 280,
            persist: "pe.family.geometry-height",
            collapse: { collapsedSize: GEOMETRY_CHROME_PX, collapseBelow: 90 },
          }}
          start={
            <TypeMatrix
              model={shown}
              typeName={typeName}
              onType={setSelectedType}
              update={update}
              fields={fields}
              laneKind={lane.kind}
              advisory={(name) => live?.advisory(name) ?? null}
              onFormulaCheck={(name, formula) => live?.check(name, formula)}
              onCite={setCite}
              onPin={setPinnedCite}
              onReview={review}
              onReviewMark={markReview}
              selectedParam={selectedParam}
              onSelectParam={(name) => {
                setPinnedConstituent(null);
                setSelectedParam(name);
              }}
              focus={focus}
              onFocus={setHovered}
            />
          }
          end={
            <GeometryTable
              model={shown}
              typeName={typeName}
              focus={focus}
              onFocus={setHovered}
              onPinConstituent={pinConstituent}
            />
          }
        />
      ) : (
        <div className="grid h-full place-items-center px-6 text-center">
          <div className="max-w-md space-y-1">
            <p className="text-sm text-muted-foreground">
              {live
                ? live.reading
                  ? "Reading the family open in Revit…"
                  : "Nothing read from the family editor yet."
                : "No family document bound yet."}
            </p>
            <p className="text-xs leading-relaxed text-muted-foreground">
              {live
                ? "Pick a family in the sentence above to open it in the family editor, or press refresh if one is already open there."
                : "Pick one in the sentence above, or press “+ new” in the strip to create one from a minimal template. Pea shares whatever you bind, so you can also ask it to capture the family open in Revit or draft one from a spec sheet."}
            </p>
          </div>
        </div>
      )}
    </Pane>
  );

  /* The grounded cut sheet is CO-PRIMARY with the matrix: it is never conditional, and with
     no document attached it shows its own upload surface, which is a first-class empty state
     rather than an absence. The parameter inspector is a strip beneath it, present exactly
     while a parameter is pinned. */
  const docColumn = (
    <div className="flex size-full min-h-0 flex-col">
      <div className="min-h-0 flex-1">
        <FamilyDocPane
          grounding={grounding}
          citations={citations}
          unresolved={unresolvedCitations}
          caption={activeCite?.label ?? null}
          pinned={pinnedCite != null}
          onUnpin={() => setPinnedCite(null)}
          onParse={(input) => void parseSpec(input)}
          parsing={parsing}
        />
      </div>
      {inspected && selectedParam && (
        <div className="h-[38%] min-h-0 shrink-0 border-t border-[var(--line)]">
          <FamilyInspector
            paramName={selectedParam}
            origin={inspected.origin}
            dataType={inspected.spec.dataType}
            formula={inspected.spec.formula}
            isInstance={inspected.spec.isInstance}
            dependsOn={inspected.dependsOn}
            dependents={inspected.dependents}
            associations={inspected.associations}
            onSelect={setSelectedParam}
            onClose={() => setSelectedParam(null)}
          />
        </div>
      )}
    </div>
  );

  return (
    <main className="flex h-screen min-h-0 flex-col bg-[var(--paper)] text-[var(--foreground)]">
      {/* ── header row 1: IDENTITY ONLY. What is bound, in which lane — no verbs. The verbs
             live one row down, beside the facts they act on. ───────────────────────────── */}
      <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-[var(--line)] px-4 py-2">
        <span className="tele-label text-[10px] tracking-[0.3em] text-[var(--clay-ink)]">
          FAMILY
        </span>
        <Sentence
          prefix={
            proposalCount > 0
              ? `reviewing ${proposalCount} proposal${proposalCount === 1 ? "" : "s"} on`
              : "editing"
          }
          prefixTone={proposalCount > 0 ? "awaiting" : "rest"}
          documentLabel={
            lane.kind === "live" ? (liveEntry ?? null) : (snapshot?.documentId.relativePath ?? null)
          }
          documents={documents}
          onPickDocument={(path) => void pickDocument(path)}
          documentsEmpty="No family.json documents in this world yet — press “+ new” in the strip below to create your first one from a minimal template."
          slots={sentenceSlots}
          target={boundTarget}
          onBind={(selector) => {
            // The settings slice runs the document commands; it needs the same session
            // binding as the family slice or FamilyFoundry module discovery fails.
            void store.familyCommand("bind", { target: selector });
            void store.settingsCommand("bind", { target: selector });
          }}
          busy={busy != null}
          receipt={receipt}
        />
        {/* The lane is DISPLAYED, never toggled — binding is the choice. */}
        <span
          className="tele-label shrink-0 text-[9px] text-[var(--slate)]"
          title={
            lane.kind === "live"
              ? "LIVE lane. You are editing the family currently open in Revit's family editor, so apply writes straight into that session — there is no file behind it and nothing to validate. This is not a mode you chose: binding the live entry in the document slot is what put you here, and picking a family.json takes you back. Staged edits are local to this browser tab, so pea cannot propose into this lane; use capture → doc to promote the family and let pea work on it there."
              : "AUTHORED lane. You are editing a family.json document, and save writes that file. This is not a mode you chose: binding a document in the sentence is what put you here. Pea shares this exact document, so its proposals land in the same cells you are editing."
          }
        >
          {lane.chip}
        </span>
        {store.isMock && (
          <span
            className="tele shrink-0 rounded-[2px] border border-dashed border-[var(--line-2)] px-1 text-[10px] text-muted-foreground"
            title="?mock — this page is running on a built-in fixture: a checked-in family.json, a few fake pea proposals, and a synthetic spec sheet standing in for a parse. No Revit host, no pea, no dispatcher, and every host verb refuses. Drop ?mock from the URL to talk to a real world."
          >
            fixture · no host
          </span>
        )}
        <span className="ml-auto flex items-center">
          <ThemeToggle />
        </span>
      </header>

      {/* ── header row 2: the status strip. Machine-measured facts on the left, the verbs
             that act on them on the right, in three clusters separated by hairlines:
             REVIEW (what is waiting on a human), EVIDENCE (what proves the numbers), CREATE.
             A verb that cannot apply in this lane or at this stage is absent, not disabled —
             the exception is save, which is always present so its refusal can be READ. ── */}
      <div className="tele flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-[var(--line-soft)] px-4 py-1 text-[10px] text-[var(--slate)]">
        {live ? (
          <>
            <span title="The family currently open in the bound session's family editor. Edits here go to Revit, not to a file — pick a different family in the sentence to move.">
              family:{" "}
              <strong className="text-[var(--clay-ink)]">
                {live.familyName ?? (live.reading ? "reading…" : "none read")}
              </strong>
            </span>
            <span title="How long ago this snapshot was read out of the family editor. Revit is free to have moved on since — press refresh if anything looks wrong.">
              read {readAgo(live.readAtMs) ?? "—"}
            </span>
          </>
        ) : (
          <>
            <span title="The authored family.json this surface is editing. Pea shares this exact document, so it can propose into the same cells you are editing.">
              document:{" "}
              <strong className="text-[var(--clay-ink)]">
                {isFamilyDocument ? snapshot?.documentId.relativePath : "none open"}
              </strong>
            </span>
            <span title="The document revision this view was built from. Save writes against it, so a token that changed underneath is how a conflicting write gets caught.">
              version: {snapshot?.versionToken ?? "—"}
            </span>
            <span title="Result of the last schema check on the document. “Not run” is not a pass — press validate to actually ask.">
              validation:{" "}
              {snapshot?.validation
                ? snapshot.validation.isValid
                  ? "valid"
                  : `${snapshot.validation.issues.length} issue(s)`
                : "not run"}
            </span>
          </>
        )}
        {/* Freshness is the normal case and gets no ink; STALE and unverified earn a colour. */}
        {evidence && !live && (
          <span
            className={evidenceFreshness === "fresh" ? undefined : "text-[var(--kiln)]"}
            title={
              evidenceFreshness === "fresh"
                ? `Real values read back out of ${evidence.from.origin} for ${evidence.from.familyName} at ${evidence.from.capturedAt}. They match the revision on screen, so the resolved numbers below are trustworthy.`
                : evidenceFreshness === "stale"
                  ? "These resolved values were read from an OLDER revision of this document, so they describe a family you have since changed. Save, then build again to refresh them."
                  : `This ${evidence.from.origin} carries no document revision — it was read out of Revit, not out of this document — so freshness cannot be judged either way. Build to get evidence that is pinned to a revision.`
            }
          >
            evidence: {evidence.from.origin} · {evidence.parameters.length} params ·{" "}
            {evidenceFreshness === "fresh"
              ? "fresh"
              : evidenceFreshness === "stale"
                ? "STALE"
                : "unverified"}
          </span>
        )}

        <span className="ml-auto flex flex-wrap items-center gap-1.5">
          {proposalCount > 0 && (
            <Verb
              label={`accept all ${proposalCount}`}
              onClick={acceptAll}
              reason="Stage every open proposal at once. Cells you have already edited yourself are skipped, so a batch accept can never overwrite your own work — and staging is still not saving."
            />
          )}
          {stagedCount > 0 && (
            <Verb
              label={`discard ${stagedCount}`}
              onClick={() => void discardStaged()}
              reason={`Throw away all ${stagedCount} staged edit${stagedCount === 1 ? "" : "s"} and re-read the ${live ? "family editor" : "document"} from scratch. Nothing saved is affected — only the unsaved staging is lost, and it cannot be recovered.`}
            />
          )}
          {/* validate is the DOCUMENT's schema check — a live family has no document. */}
          {lane.kind === "authored" && (
            <Verb
              label="validate"
              onClick={() => void run("validate")}
              busy={busy === "validate"}
              disabled={!isFamilyDocument || busy != null}
              reason={
                isFamilyDocument
                  ? "Check the document against the family schema and report the issues. It writes nothing — it validates the candidate the document WOULD BE after saving what is staged (saved content with your staged edits spliced in). Proposals you have not accepted are excluded."
                  : "Nothing to validate — open a family document in the sentence first."
              }
            />
          )}
          <Verb
            label={`${live ? "apply" : "save"}${stagedCount ? ` ${stagedCount}` : ""}`}
            tone="commit"
            onClick={() => void (live ? runLiveSave() : run("save"))}
            busy={busy === "save"}
            disabled={saveBlockedReason != null || busy != null}
            reason={
              saveBlockedReason
                ? `${saveBlockedReason}. The server refuses on the same rule, so this is the refusal you would get anyway, just sooner.`
                : live
                  ? `Write ${stagedCount} staged edit${stagedCount === 1 ? "" : "s"} into the family open in Revit. Each edit succeeds or fails on its own — anything Revit refuses stays staged and is named in the strip below, so you can fix just that one and press apply again.`
                  : `Write ${stagedCount} staged field${stagedCount === 1 ? "" : "s"} to the document. The document is re-opened afterwards, so what you see next is the file as it actually landed, not what was hoped for.`
            }
          />
          {/* ── evidence cluster: what makes the numbers believable ── */}
          <span className="ml-2 flex flex-wrap items-center gap-1.5 border-l border-[var(--line-soft)] pl-2">
            {/* CAPTURE IS THE BRIDGE: evidence in the authored lane, promotion in the live one. */}
            <Verb
              label={live ? "capture → doc" : "capture"}
              onClick={() => void (live ? captureToDocument() : captureEvidence())}
              busy={busy === "capture"}
              disabled={busy != null}
              reason={
                live
                  ? "The bridge between the two lanes, and the only crossing there is. This reads the live family out of Revit, writes it as a new family.json under captured/, and opens it — so you end up in the authored lane on the same family, where the document can be versioned and pea can propose into it. Revit itself is not modified."
                  : "Read the family currently open in the bound Revit session and fold its real, resolved values into this document as EVIDENCE. It changes no authored value — it is how the numbers on screen earn the right to be believed."
              }
            />
            {/* build proves a SAVED authored revision; there is none in the live lane. */}
            {lane.kind === "authored" && (
              <Verb
                label="build"
                onClick={() => void buildEvidence()}
                busy={busy === "build"}
                disabled={!isFamilyDocument || busy != null || stagedCount > 0}
                reason={
                  !isFamilyDocument
                    ? "Nothing to build — open a family document in the sentence first."
                    : stagedCount > 0
                      ? `Save your ${stagedCount} staged edit${stagedCount === 1 ? "" : "s"} first. A build proves the SAVED revision, so building now would prove a family you have already moved past.`
                      : "Build this saved document into a real .rfa in Revit and read the result back as evidence. This is the proof lane: it is what turns the authored numbers on screen into numbers Revit actually produced."
                }
              />
            )}
            {live && (
              <Verb
                label={live.reading ? "reading" : "refresh"}
                onClick={() => live.refresh()}
                busy={live.reading}
                reason="Re-read the family from Revit's family editor. Staged edits survive — this only replaces the snapshot underneath them, so use it when someone has changed the family in Revit since you started."
              />
            )}
            <RvtChip target={boundTarget} />
            <RfaChip target={boundTarget} />
          </span>

          {/* ── create cluster: one collapsed verb until it is actually wanted ── */}
          {lane.kind === "authored" && (
            <span className="ml-2 flex items-center border-l border-[var(--line-soft)] pl-2">
              <NewDocument onCreate={createDocument} busy={busy != null} />
            </span>
          )}
        </span>
      </div>

      {/* ── trouble line: refusals, receipts, and the dispatcher's own words. It exists only
             when there is something to say, so an ordinary session shows two rows, not three. */}
      {(error ||
        hint ||
        (saveBlockedReason && stagedCount > 0) ||
        (busy == null && (lastSave || liveFailures.length > 0))) && (
        <div className="tele flex shrink-0 flex-wrap items-center gap-3 border-b border-[var(--line-soft)] px-4 py-1 text-[10px] text-[var(--clay)]">
          {saveBlockedReason && stagedCount > 0 && (
            <span
              className="text-[var(--clay)]"
              title="The save verb is refusing before the round trip. The server enforces the same rule, so clearing this is the only way through."
            >
              Save blocked · {saveBlockedReason}
            </span>
          )}
          {lastSave && busy == null && (
            <span
              className={lastSave.failed > 0 ? "text-[var(--clay)]" : "text-cat-green"}
              title={
                lastSave.failed > 0
                  ? "Some edits landed and some did not. The failed ones are still staged, named beside this, so they can be fixed and retried without redoing the rest."
                  : "Every staged edit landed. Green means done — nothing on this page is still waiting to be written."
              }
            >
              Saved {lastSave.saved}
              {lastSave.failed > 0 ? ` · ${lastSave.failed} failed` : ""}
            </span>
          )}
          {/* A live apply fails PER EDIT — name each one; those edits are still staged.
              A COMMIT failure belongs to no edit and is staged nowhere, so it is said apart. */}
          {stagedLiveFailures.length > 0 && busy == null && (
            <span
              className="text-[var(--clay)]"
              title={`Revit refused these edits individually; the rest of the apply went through. They are still staged, so fix the value and press apply again:\n\n${stagedLiveFailures.map((failure) => `· ${failure.label}: ${failure.error}`).join("\n")}`}
            >
              still staged: {stagedLiveFailures.map((failure) => failure.label).join(" · ")}
            </span>
          )}
          {commitFailure && busy == null && (
            <span
              className="text-[var(--clay)]"
              title={`Revit refused the transaction as a whole, not any one edit — so there is nothing staged to fix. Revit's own words:\n\n${commitFailure.error}`}
            >
              commit refused
            </span>
          )}
          {error && (
            <span
              className="text-[var(--clay)]"
              title="The last command failed and nothing was written. This is the dispatcher's own words, verbatim."
            >
              {error}
            </span>
          )}
          {/* The dispatcher's `hint` is a teaching channel, distinct from the error text. */}
          {hint && (
            <span
              className="text-[var(--kiln)]"
              title="A hint from the command itself about how to get past the error — advice, not a second failure."
            >
              hint: {hint}
            </span>
          )}
        </div>
      )}

      {/* ── the workspace ────────────────────────────────────────────────────────────────── */}
      {anatomy ? (
        <PaneWorkspace
          className="min-h-0 flex-1"
          resize={{
            visual: {
              defaultSize: ANATOMY_DEFAULT_PX + ANATOMY_CHROME_PX,
              minSize: ANATOMY_MIN_PX + ANATOMY_CHROME_PX,
              maxSize: 720,
              /* Room below the drawing for the matrix's chrome plus real rows. */
              minOtherSize: 320,
              persist: "pe.family.anatomy-height",
              collapse: {
                collapsed: anatomyCollapsed,
                onCollapsedChange: setAnatomyCollapsed,
                collapsedSize: ANATOMY_CHROME_PX,
                collapseBelow: ANATOMY_MIN_PX,
              },
            },
            inspector: {
              defaultSize: DOC_DEFAULT_PX,
              minSize: DOC_MIN_PX,
              maxSize: 900,
              minOtherSize: 420,
              persist: "pe.family.doc-width",
            },
          }}
          visual={
            <AnatomyPane
              model={anatomy}
              typeName={typeName}
              onType={setSelectedType}
              update={update}
              focus={focus}
              onFocus={setHovered}
              collapsed={anatomyCollapsed}
              onCollapsedChange={setAnatomyCollapsed}
            />
          }
          content={contentPane}
          inspectorSpan="full"
          inspector={docColumn}
        />
      ) : (
        /* No authored anatomy to draw (live lane, or nothing bound): two panes, not an
           empty visual row pretending there is a drawing behind it. */
        <PaneSplit
          className="min-h-0 flex-1"
          axis="horizontal"
          resize={{
            target: "end",
            defaultSize: DOC_DEFAULT_PX,
            minSize: DOC_MIN_PX,
            maxSize: 900,
            minOtherSize: 420,
            persist: "pe.family.doc-width",
          }}
          start={contentPane}
          end={docColumn}
        />
      )}
    </main>
  );
}

/**
 * Creating a family is a RARE act, so it costs one collapsed verb until it is wanted: `+ new`
 * expands into the name field and its confirm, and collapses again on Esc or on leaving it
 * empty. Nothing is lost by collapsing — a typed name keeps the field open.
 */
function NewDocument({ onCreate, busy }: { onCreate: (name: string) => void; busy: boolean }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");

  const create = () => {
    onCreate(name.trim());
    setName("");
    setOpen(false);
  };

  if (!open)
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Start a new family.json. Clicking opens a name field here — the file is written from a minimal template (one prism, three length parameters, one type) and opened immediately, so you land in it rather than having to go find it."
        className="tele h-6 shrink-0 rounded-[2px] border border-[var(--line-2)] px-2 text-muted-foreground hover:border-[var(--pe-blue)]"
      >
        + new
      </button>
    );

  return (
    <span
      className="inline-flex shrink-0 items-center gap-1"
      onBlur={(event) => {
        if (!name.trim() && !event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
    >
      <input
        autoFocus
        value={name}
        onChange={(event) => setName(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && name.trim()) create();
          if (event.key === "Escape") {
            setName("");
            setOpen(false);
          }
        }}
        placeholder="new family name…"
        title="Name a new family.json. It is written from a minimal template — one prism, three length parameters, one type — and opened immediately, so you land in it rather than having to go find it."
        className="tele h-6 w-36 rounded-[2px] border border-[var(--line)] bg-transparent px-1.5 outline-none focus:border-[var(--pe-blue)]"
      />
      <Verb
        label="create"
        onClick={create}
        busy={busy}
        disabled={!name.trim()}
        reason={
          name.trim()
            ? `Write a new document from the minimal template and open it. The file lands at "${name.trim().replace(/\s+/g, "-").toLowerCase()}".`
            : "Type a family name first — the name becomes the document's path."
        }
      />
    </span>
  );
}
