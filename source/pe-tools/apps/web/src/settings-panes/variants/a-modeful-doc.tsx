/**
 * PROTOTYPE — settings-panes round 1, VARIANT A: "modeful document" (throwaway with the round;
 * see docs/features/settings/PRODUCT.md). Reached at /settings?variant=a.
 *
 * THE FRAME: the conservative composition, executed on the letter of the law —
 * - The head keeps the form-route ruling (2026-08-16): the pickers ARE the sentence. No tree,
 *   no AddressingBar; workspace ▸ module ▸ root ▸ file chain the address, driven entirely from
 *   the shared fixture (no host queries anywhere on this surface).
 * - ONE document pane in the one ArtifactFrame, with a [form ⇄ raw] mode Switcher in the frame
 *   head. The generated form and the raw JSON are two readings of the same coordinates —
 *   SURFACE-PHILOSOPHY §2: "columns that are readings of the same coordinates are one column
 *   and a mode switch". Two panes would mint a pseudo-dimension; this variant refuses to.
 * - The frame FOOT carries the document's counts and its ONE commit verb (save) — the artifact
 *   owns its own commit; outcome lines stay plain content BELOW the frame (border budget:
 *   an outcomes lane reports on the machine-operated object, it is not one).
 *
 * THE RAW WRITE MODEL — PARSE-DIFF → STAGED FIELDS:
 * "stage edits" parses the draft text (a parse failure REFUSES visibly on the outcome lane —
 * §3: a silent refusal reads as an edit that vanished), diffs leaf JSON Pointers against the
 * snapshot's parsed rawContent, and turns every change into a staged `{value}` (or
 * `{delete:true}` for a removed property) in the SAME pointer-keyed `fields` map the form
 * stages into. One save gate; one substrate. A raw edit that touches a pointer holding an open
 * pea proposal SEVERS the proposal (R6: typing beats proposing; no trace is left on the cell).
 *
 * OPEN PEA PROPOSALS WHILE IN RAW MODE (the decision this variant was asked to make):
 * the raw text shows the SAVED document only — proposals are NEVER spliced into the text.
 * Splicing would launder pea's words into what reads as disk truth (an §3 honesty violation)
 * and would make every raw edit sever every proposal wholesale. Instead the open proposals
 * render as a plain PROPOSAL LANE below the frame — pointer + proposed value through the same
 * StateCell grammar, approve/deny in place — so the trichotomy stays reviewable without leaving
 * raw mode. The chat-plugin lane stays the substrate BY CONSTRUCTION: proposals live only as
 * pointer-keyed entries in `fields` (exactly what arrives over SSE and what SettingsChatPlugin
 * renders); raw mode is just one more projection of that map, never a competing store.
 *
 * FIXTURE LANE: everything below acts on local useState copies of the shared fixture. The
 * dashed FactChip in the head declares it (dashed = seam, the reserved meaning). Nothing here
 * can write through — the fixture snapshot's versionToken is null by construction.
 */
import { useMemo, useState } from "react";

import {
  type SettingsFieldState,
  settingsFieldPointer,
  settingsFieldSegments,
} from "@pe/agent-contracts";

import { ArtifactFrame } from "#/components/lang/artifact-frame";
import { StateCell } from "#/components/lang/cell";
import { FactChip } from "#/components/lang/chip";
import { EmptyState } from "#/components/lang/empty";
import { OutcomeLine } from "#/components/lang/outcome";
import { Switcher } from "#/components/lang/switcher";
import { Verb } from "#/components/lang/verb";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "#/components/ui/select";
import { useVerb } from "#/lib/use-verb";

import { JsonEditor } from "../json-editor";
import { fixtureDocument, fixtureFiles, fixtureRawFor, fixtureWorkspaces } from "../fixture";

/* PROTOTYPE PORT: the worktree branch predates the design-sweep token/tier layer, so the
   variant imports it directly — design-lang.css (canon, copied byte-for-byte from main) and
   the plain-class tier shim. Both die when the worktree catches up. */
import "#/design-lang.css";
import "../proto-tiers.css";

const FIXTURE_FILE = "mechanical/vav-boxes.json";

/** A staged/proposed edit, matching `settingsFieldEditSchema`: set a value or delete the key. */
type FieldEdit = { value?: unknown; delete?: true };

export function VariantA() {
  /* ── the sentence — pickers chained off the fixture world ── */
  const [workspaceKey, setWorkspaceKey] = useState<string | undefined>("office");
  const [moduleKey, setModuleKey] = useState<string | undefined>("pe.schedules");
  const [rootKey, setRootKey] = useState<string | undefined>("profiles");
  const [fileRel, setFileRel] = useState<string | undefined>(FIXTURE_FILE);

  /* ── the document — local copies of the fixture (the "route state" of this prototype) ── */
  const [raw, setRaw] = useState<string>(() => fixtureRawFor(FIXTURE_FILE));
  const [fields, setFields] = useState<Record<string, SettingsFieldState>>(() => ({
    ...fixtureDocument.fields,
  }));
  const [mode, setMode] = useState<"form" | "raw">("form");
  const [draft, setDraft] = useState<string>(() => fixtureRawFor(FIXTURE_FILE));
  const verb = useVerb();

  const workspace = fixtureWorkspaces.find((w) => w.workspaceKey === workspaceKey);
  const modules = workspace?.modules ?? [];
  const module = modules.find((m) => m.moduleKey === moduleKey);
  const roots = module?.roots ?? [];
  // The fixture tree only exists under pe.schedules/profiles; every other address is honestly
  // empty (the pickers say where options come from via the EmptyState below).
  const files = moduleKey === "pe.schedules" && rootKey === "profiles" ? fixtureFiles : [];

  const openFile = (rel: string | undefined) => {
    setFileRel(rel);
    verb.fail("error", null);
    if (rel == null) return;
    const nextRaw = fixtureRawFor(rel);
    setRaw(nextRaw);
    setDraft(nextRaw);
    // Switching files clears field states; returning to the fixture doc re-seeds them so the
    // demo world survives a round-trip (the seeded states ARE that file's route state).
    setFields(rel === FIXTURE_FILE ? { ...fixtureDocument.fields } : {});
  };

  const parsed = useMemo(() => safeParse(raw), [raw]);
  const rows = useMemo(() => buildFieldRows(parsed, fields), [parsed, fields]);
  const stagedCount = rows.filter((row) => row.field?.staged != null).length;
  const attentionCount = rows.filter((row) => row.field?.review === "attention").length;
  const openProposals = rows.filter((row) => row.field?.proposal && row.field.staged == null);
  const canSave = stagedCount > 0 && attentionCount === 0;
  const dirty = draft !== raw;

  // Validation is a SNAPSHOT fact from the fixture; with no host there is nothing to re-run it,
  // so it only stands while the fixture document is open and untouched by save.
  // GAP: validation freshness has no home in the local model — a real surface gets it from
  // route-state on open/refresh/save; here it silently goes stale after the stub save.
  const validation = fileRel === FIXTURE_FILE ? fixtureDocument.snapshot?.validation : null;

  /* ── field verbs (form rows AND the raw-mode proposal lane share these) ── */
  const patchField = (path: string, next: SettingsFieldState) =>
    setFields((prev) => ({ ...prev, [path]: next }));

  const approve = (path: string, value: unknown) => {
    const prev = fields[path];
    patchField(path, { proposal: prev?.proposal ?? null, staged: { value }, review: "good" });
  };
  const deny = (path: string) => {
    const prev = fields[path];
    patchField(path, { proposal: null, staged: prev?.staged ?? null, review: "none" });
  };
  const unstage = (path: string) => {
    const prev = fields[path];
    patchField(path, { proposal: prev?.proposal ?? null, staged: null, review: "none" });
  };

  /* ── the raw write model: parse-diff → staged fields ── */
  const stageRawEdits = () =>
    void verb.run("stage edits", async () => {
      let parsedDraft: Record<string, unknown>;
      try {
        const value: unknown = JSON.parse(draft);
        if (value == null || typeof value !== "object" || Array.isArray(value))
          throw new Error("a settings document is a JSON object at its root");
        parsedDraft = value as Record<string, unknown>;
      } catch (cause) {
        // §3: the refusal is VISIBLE and the draft stays in the editor untouched — nothing
        // vanished, nothing staged. GAP: the outcome vocabulary has no kind for "the page
        // refused your input" — `refused` is reserved for the model disagreeing (alarm), so
        // this rides `error` (caution) and says "refused" in prose.
        throw new Error(
          `refused — ${cause instanceof Error ? cause.message : String(cause)}; nothing staged`,
        );
      }
      if (parsed == null) throw new Error("the saved document did not parse — nothing to diff");

      const edits = new Map<string, FieldEdit>();
      diffPointers(parsed, parsedDraft, [], edits);
      if (edits.size === 0) {
        verb.fail("advisory", "raw text matches the saved document — nothing staged");
        return;
      }

      // Counted against the render-time snapshot, NOT inside the setFields updater — the
      // updater runs on React's schedule, after the receipt string below is already built.
      const severed = [...edits.keys()].filter(
        (path) => fields[path]?.proposal != null && fields[path]?.staged == null,
      ).length;
      setFields((prev) => {
        const next = { ...prev };
        for (const [path, edit] of edits) {
          // R6 — typing beats proposing: a raw edit landing on a pointer with an open pea
          // proposal severs it outright. No trace on the field; the (future) proposal ledger
          // is where the history lives.
          next[path] = { proposal: null, staged: edit, review: "good" };
        }
        return next;
      });
      return `staged ${edits.size} edit${edits.size === 1 ? "" : "s"} from raw${
        severed > 0 ? ` · severed ${severed} pea proposal${severed === 1 ? "" : "s"}` : ""
      }`;
    });

  /* ── the save stub — counts staged, refuses on attention, splices locally ── */
  const save = () =>
    void verb.run("save", async () => {
      // canSave already gates the verb; this is the stub of the host's own refusal path.
      if (!canSave || parsed == null) throw new Error("nothing saveable");
      const next = structuredClone(parsed);
      let count = 0;
      for (const [path, field] of Object.entries(fields)) {
        if (field.staged == null) continue;
        const segments = settingsFieldSegments(path);
        if (field.staged.delete === true) deleteAtPath(next, segments);
        else setAtPath(next, segments, field.staged.value);
        count += 1;
      }
      const nextRaw = JSON.stringify(next, null, 2);
      setRaw(nextRaw);
      setDraft(nextRaw);
      // A consumed staged field leaves the map entirely (its proposal, if it had one, landed);
      // untouched open proposals survive the save — same shape as the host's save contract.
      setFields((prev) =>
        Object.fromEntries(Object.entries(prev).filter(([, field]) => field.staged == null)),
      );
      return `saved ${count} field${count === 1 ? "" : "s"} — fixture, nothing left this page`;
    });

  const saveReason =
    stagedCount === 0
      ? "Nothing is staged — approve a proposal, stage a raw edit, or both. Save splices staged values into the document."
      : attentionCount > 0
        ? `${attentionCount} staged field${attentionCount === 1 ? "" : "s"} need attention before anything is written.`
        : `Splice ${stagedCount} staged value${stagedCount === 1 ? "" : "s"} into the document. (Fixture: the write stays on this page.)`;

  return (
    <main className="flex h-screen flex-col overflow-hidden bg-[var(--r-page)] text-[var(--r-ink)]">
      {/* ── THE HEAD — pickers ARE the sentence (form-route head ruling) ── */}
      <header className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-[var(--r-line)] px-3 py-1.5">
        <h1 className="t-label t-upper text-[var(--r-ink-2)]">settings</h1>
        <div className="flex flex-wrap items-center gap-1.5">
          <Picker
            id="workspace"
            label="workspace"
            value={workspaceKey}
            placeholder="workspace…"
            onChange={(v) => {
              setWorkspaceKey(v);
              setModuleKey(undefined);
              setRootKey(undefined);
              setFileRel(undefined);
            }}
            options={fixtureWorkspaces.map((w) => ({
              value: w.workspaceKey,
              label: w.displayName || w.workspaceKey,
            }))}
          />
          <Picker
            id="module"
            label="module"
            value={moduleKey}
            placeholder="module…"
            disabled={modules.length === 0}
            onChange={(v) => {
              setModuleKey(v);
              const nextModule = modules.find((m) => m.moduleKey === v);
              const defaultRoot =
                nextModule?.roots.find((r) => r.rootKey === nextModule.defaultRootKey) ??
                nextModule?.roots[0];
              setRootKey(defaultRoot?.rootKey);
              setFileRel(undefined);
            }}
            options={modules.map((m) => ({ value: m.moduleKey, label: m.moduleKey }))}
          />
          <Picker
            id="root"
            label="root"
            value={rootKey}
            placeholder="root…"
            disabled={roots.length === 0}
            onChange={(v) => {
              setRootKey(v);
              setFileRel(undefined);
            }}
            options={roots.map((r) => ({ value: r.rootKey, label: r.displayName || r.rootKey }))}
          />
          <Picker
            id="file"
            label="authoring file"
            value={fileRel}
            placeholder="file…"
            disabled={files.length === 0}
            onChange={openFile}
            options={files.map((f) => ({ value: f.relativePath, label: f.relativePath }))}
          />
        </div>
        {/* the declared fixture lane — dashed is the reserved seam meaning */}
        <FactChip
          dashed
          title="This surface is a design fixture — nothing here writes; live route-state wiring (open/refresh/save over the settings document) replaces this."
        >
          fixture — nothing writes
        </FactChip>
        {fileRel != null ? (
          <>
            <FactChip
              tone={openProposals.length > 0 ? "pea" : "meta"}
              title="Open pea proposals awaiting review — approving stages the value. In raw mode they render on the proposal lane below the document."
            >
              {openProposals.length} proposed
            </FactChip>
            <FactChip
              tone={stagedCount > 0 ? "caution" : "meta"}
              title="Values staged for the next save — from approved proposals and staged raw edits alike; one gate."
            >
              {stagedCount} staged
            </FactChip>
            {attentionCount > 0 ? (
              <FactChip
                tone="caution"
                title="Fields whose review flag is 'attention' — save refuses while any remain."
              >
                {attentionCount} need attention
              </FactChip>
            ) : null}
            {validation != null && !validation.isValid ? (
              <FactChip
                tone="caution"
                title={`The fixture snapshot's validate run reported: ${validation.issues
                  .map((issue) => issue.message)
                  .join(" · ")}`}
              >
                {validation.issues.length} validation issue
                {validation.issues.length === 1 ? "" : "s"}
              </FactChip>
            ) : null}
          </>
        ) : null}
      </header>

      {/* ── THE ONE DOCUMENT PANE ── */}
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-3">
        <div className="mx-auto max-w-3xl">
          {fileRel == null ? (
            <EmptyState
              story="scope"
              exit="choose a workspace, module, root, and authoring file above — the fixture's files live under pe.schedules / profiles"
            >
              no document open
            </EmptyState>
          ) : (
            <>
              <ArtifactFrame
                head={
                  <>
                    <span className="face-mono t-label min-w-0 truncate text-[var(--r-ink)]">
                      {module?.moduleKey ?? "pe.schedules"} · {fileRel}
                    </span>
                    {dirty && mode === "raw" ? (
                      <FactChip
                        tone="caution"
                        title="The raw text differs from the saved document. 'stage edits' turns the differences into staged fields; 'discard draft' returns to the saved text."
                      >
                        draft differs
                      </FactChip>
                    ) : null}
                    <span className="ml-auto">
                      <Switcher
                        ariaLabel="document mode"
                        value={mode}
                        onChange={setMode}
                        options={[
                          {
                            value: "form",
                            label: "form",
                            title:
                              "Read the document as generated field rows — review, approve, and stage per pointer.",
                          },
                          {
                            value: "raw",
                            label: "raw",
                            title:
                              "Read the document as its raw JSON text — edit freely, then stage the diff as fields.",
                          },
                        ]}
                      />
                    </span>
                  </>
                }
                foot={
                  <>
                    <span className="flex items-center gap-1.5">
                      {mode === "raw" ? (
                        <>
                          <Verb
                            label="stage edits"
                            busy={verb.busy === "stage edits"}
                            disabled={!dirty || verb.busy != null}
                            reason={
                              dirty
                                ? "Parse the raw text and stage every changed pointer as a field edit — additions and changes as values, removed keys as deletes. A pointer with an open pea proposal is severed by your edit."
                                : "The raw text matches the saved document — nothing to stage."
                            }
                            onClick={stageRawEdits}
                          />
                          <Verb
                            label="discard draft"
                            disabled={!dirty || verb.busy != null}
                            reason={
                              dirty
                                ? "Throw the raw draft away and return to the saved text. Staged fields are untouched."
                                : "The raw text already matches the saved document."
                            }
                            onClick={() => setDraft(raw)}
                          />
                        </>
                      ) : (
                        <span className="face-mono t-caption text-[var(--r-ink-2)]">
                          {rows.length} fields
                        </span>
                      )}
                    </span>
                    <span className="flex items-center gap-2">
                      <Verb
                        tone="commit"
                        label={`save ${stagedCount}`}
                        busy={verb.busy === "save"}
                        disabled={!canSave || verb.busy != null}
                        reason={saveReason}
                        onClick={save}
                      />
                    </span>
                  </>
                }
              >
                {mode === "form" ? (
                  rows.length > 0 ? (
                    <div className="divide-y divide-[var(--r-line)]">
                      {rows.map((row) => (
                        <FieldRow
                          key={row.path}
                          row={row}
                          busy={verb.busy != null}
                          onApprove={(value) => approve(row.path, value)}
                          onDeny={() => deny(row.path)}
                          onUndo={() => unstage(row.path)}
                        />
                      ))}
                    </div>
                  ) : (
                    <div className="px-3 py-4">
                      <EmptyState
                        story="scope"
                        exit="add keys in raw mode and stage them, or let pea propose fields into it"
                      >
                        this document has no fields
                      </EmptyState>
                    </div>
                  )
                ) : (
                  /* the SAME coordinates, read as text. The editor shows the SAVED document
                     plus your keystrokes — staged fields and proposals are NOT spliced in
                     (they are unsaved state, and the text claims to be the file). */
                  <JsonEditor value={draft} onChange={setDraft} className="h-[26rem]" />
                )}
              </ArtifactFrame>

              {/* ── outcome lane — plain content, never enclosed ── */}
              <div className="flex flex-wrap items-center gap-2 pt-2">
                {verb.busy != null ? (
                  <OutcomeLine kind="busy" label={`${verb.busy} — ${verb.seconds}s`} />
                ) : null}
                {verb.outcome != null ? (
                  <OutcomeLine kind={verb.outcome.kind} label={verb.outcome.text} />
                ) : verb.receipt != null ? (
                  <OutcomeLine kind="receipt" label={verb.receipt.text} />
                ) : null}
              </div>

              {/* ── raw mode's proposal lane — the open trichotomy, still reviewable without
                    leaving the text. Plain content: it reports on the document, it is not the
                    document. Form mode renders the same proposals inline, so the lane would be
                    a second home there (one home at a time — §4). ── */}
              {mode === "raw" && openProposals.length > 0 ? (
                <div className="pt-3">
                  <div className="t-label t-upper border-b border-[var(--r-line)] pb-1 text-[var(--r-ink-2)]">
                    open proposals
                  </div>
                  {openProposals.map((row) => (
                    <div key={row.path} className="flex items-center gap-3 py-1.5">
                      <div className="min-w-0 flex-1">
                        <div className="face-mono t-label truncate text-[var(--r-ink-2)]">
                          {row.path}
                        </div>
                        <StateCell
                          className="face-mono t-value"
                          value={display(row.field?.proposal?.value)}
                          stage="proposed"
                          note={proposalNote(row.field, row.current)}
                        />
                      </div>
                      <span className="flex shrink-0 gap-1.5">
                        <Verb
                          label="deny"
                          disabled={verb.busy != null}
                          reason="Clear pea's proposal for this pointer — the saved value stands."
                          onClick={() => deny(row.path)}
                        />
                        <Verb
                          label="approve"
                          disabled={verb.busy != null}
                          reason={`Approve and stage "${display(row.field?.proposal?.value)}" for the next save.`}
                          onClick={() => approve(row.path, row.field?.proposal?.value)}
                        />
                      </span>
                    </div>
                  ))}
                </div>
              ) : null}
            </>
          )}
        </div>
      </div>
    </main>
  );
}

/* ── field rows (the form reading) — the shipping surface's row, on local state ──────────── */

interface FieldRowData {
  path: string;
  current: unknown;
  field?: SettingsFieldState;
}

function buildFieldRows(
  parsed: Record<string, unknown> | null,
  fields: Record<string, SettingsFieldState>,
): FieldRowData[] {
  const leafPaths = parsed ? flattenLeafPaths(parsed) : [];
  const paths = new Set<string>([...leafPaths, ...Object.keys(fields)]);
  return [...paths]
    .sort((a, b) => a.localeCompare(b))
    .map((path) => {
      const field = fields[path];
      return {
        path,
        current: parsed ? valueAtPath(parsed, settingsFieldSegments(path)) : undefined,
        ...(field != null ? { field } : {}),
      };
    });
}

function proposalNote(field: SettingsFieldState | undefined, current: unknown): string {
  const proposal = field?.proposal;
  return (
    [
      `was ${display(current)}`,
      proposal?.confidence ? `pea confidence: ${proposal.confidence}` : null,
      proposal?.note ?? null,
    ]
      .filter(Boolean)
      .join(" · ") || "pea proposed this value"
  );
}

function FieldRow({
  row,
  busy,
  onApprove,
  onDeny,
  onUndo,
}: {
  row: FieldRowData;
  busy: boolean;
  onApprove: (value: unknown) => void;
  onDeny: () => void;
  onUndo: () => void;
}) {
  const field = row.field;
  const staged = field?.staged != null;
  const proposal = !staged ? field?.proposal : undefined;
  const attention = field?.review === "attention";
  const stagedDisplay =
    field?.staged?.delete === true ? "(deleted)" : display(field?.staged?.value);
  const shown = staged ? stagedDisplay : proposal ? display(proposal.value) : display(row.current);

  // One footline, ranked: the save-blocking flag leads, then the prior value, then pea's words.
  // GAP (carried from the shipping surface's audit #2): review "attention" has no cell-grammar
  // axis of its own — it rides the note and the owed-marker gutter.
  const note =
    [
      attention
        ? "needs attention — review flagged this value; save refuses while it stands"
        : null,
      staged || proposal ? `was ${display(row.current)}` : null,
      proposal?.confidence ? `pea confidence: ${proposal.confidence}` : null,
      proposal?.note ?? null,
    ]
      .filter(Boolean)
      .join(" · ") || undefined;

  return (
    <div className="flex min-h-12 items-center gap-3 px-3 py-2">
      {/* the owed marker, hand-carried (this grid is not a MasterTable): a count in caution
          ink when a review decision is owed here, blank otherwise. Locate-only. */}
      <span
        className="face-mono t-caption w-3 shrink-0 text-center text-[var(--r-caution)]"
        title={
          attention
            ? `${row.path} was flagged for attention — a review decision is owed here; save refuses while it stands`
            : undefined
        }
      >
        {attention ? 1 : null}
      </span>
      <div className="min-w-0 flex-1">
        <div className="face-mono t-label truncate text-[var(--r-ink-2)]">{row.path}</div>
        <StateCell
          className="face-mono t-value"
          value={shown}
          stage={staged ? "staged" : proposal ? "proposed" : "clean"}
          stagedBy="you"
          {...(note != null ? { note } : {})}
        />
      </div>

      {staged ? (
        <Verb
          label="unstage"
          disabled={busy}
          reason="Return this field to its saved value. A proposal it came from is restored to the open list."
          onClick={onUndo}
        />
      ) : proposal ? (
        <span className="flex shrink-0 gap-1.5">
          <Verb
            label="deny"
            disabled={busy}
            reason="Clear pea's proposal for this field — the saved value stands."
            onClick={onDeny}
          />
          <Verb
            label="approve"
            disabled={busy}
            reason={`Approve and stage "${display(proposal.value)}" for the next save.`}
            onClick={() => onApprove(proposal.value)}
          />
        </span>
      ) : null}
    </div>
  );
}

/* ── the picker (head-inline, as the shipping surface ruled it) ──────────────────────────── */

function Picker({
  id,
  label,
  value,
  placeholder,
  disabled,
  options,
  onChange,
}: {
  id: string;
  label: string;
  value: string | undefined;
  placeholder: string;
  disabled?: boolean;
  options: { value: string; label: string }[];
  onChange: (value: string | undefined) => void;
}) {
  return (
    <Select
      items={[{ value: "__none", label: placeholder }, ...options]}
      value={value ?? "__none"}
      onValueChange={(v: string | null) => onChange(v === "__none" || !v ? undefined : v)}
      disabled={disabled}
    >
      <SelectTrigger id={id} aria-label={label} title={label} className="h-6 max-w-52">
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="__none">{placeholder}</SelectItem>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/* ── json plumbing ───────────────────────────────────────────────────────────────────────── */

function safeParse(rawContent: string | null | undefined): Record<string, unknown> | null {
  if (!rawContent?.trim()) return null;
  try {
    const value: unknown = JSON.parse(rawContent);
    return value != null && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** Every leaf JSON Pointer, for the FORM reading. Objects recurse; arrays and primitives are
 * leaves — the same shape the shipping surface renders (deeper array pointers still appear as
 * rows when a field state addresses them, via the union in buildFieldRows). */
function flattenLeafPaths(value: Record<string, unknown>, prefix: string[] = []): string[] {
  const out: string[] = [];
  for (const [key, child] of Object.entries(value)) {
    const segments = [...prefix, key];
    if (child != null && typeof child === "object" && !Array.isArray(child)) {
      out.push(...flattenLeafPaths(child as Record<string, unknown>, segments));
    } else {
      out.push(settingsFieldPointer(segments));
    }
  }
  return out;
}

function valueAtPath(root: Record<string, unknown>, segments: string[]): unknown {
  let cursor: unknown = root;
  for (const segment of segments) {
    if (cursor == null || typeof cursor !== "object") return undefined;
    cursor = (cursor as Record<string, unknown>)[segment];
  }
  return cursor;
}

/** Set through objects AND array indices (staged pointers like /fields/2/columnHeader are in
 * the fixture); missing intermediate containers are created as objects (prototype-lazy). */
function setAtPath(root: Record<string, unknown>, segments: string[], value: unknown): void {
  let cursor: Record<string, unknown> = root;
  for (let i = 0; i < segments.length - 1; i += 1) {
    const key = segments[i]!;
    const next = cursor[key];
    if (next == null || typeof next !== "object") cursor[key] = {};
    cursor = cursor[key] as Record<string, unknown>;
  }
  cursor[segments.at(-1)!] = value;
}

function deleteAtPath(root: Record<string, unknown>, segments: string[]): void {
  let cursor: unknown = root;
  for (let i = 0; i < segments.length - 1; i += 1) {
    if (cursor == null || typeof cursor !== "object") return;
    cursor = (cursor as Record<string, unknown>)[segments[i]!];
  }
  if (cursor != null && typeof cursor === "object")
    delete (cursor as Record<string, unknown>)[segments.at(-1)!];
}

/**
 * THE PARSE-DIFF. Walks base (the snapshot's parsed rawContent) and next (the parsed draft)
 * together and emits one FieldEdit per changed leaf pointer:
 * - both plain objects → recurse over the key union; a key missing from the draft emits
 *   `{delete:true}` at that pointer (one delete for the subtree — the pointer-keyed grammar
 *   deletes properties, not leaves).
 * - both arrays of EQUAL length → recurse per index, so an in-place element edit stages the
 *   precise pointer (/fields/2/columnHeader) instead of the whole array.
 * - anything else that differs → `{value}` at the pointer. An array that changed length is
 *   deliberately staged WHOLE: after an insert/remove every later index would "change", and a
 *   storm of index-shifted edits is noise, not review material.
 *   GAP: this makes array reordering coarse — a real diff needs identity-aware array keys
 *   (e.g. parameterName) or the host's own diff; recorded for the round verdict.
 * - equality is JSON.stringify equality, so a pure KEY-REORDER inside a nested object reads
 *   as a change. GAP: cheap structural deep-equal would fix it; accepted for the prototype.
 */
function diffPointers(
  base: unknown,
  next: unknown,
  prefix: string[],
  out: Map<string, FieldEdit>,
): void {
  if (isPlainObject(base) && isPlainObject(next)) {
    for (const key of new Set([...Object.keys(base), ...Object.keys(next)])) {
      const pointer = [...prefix, key];
      if (!(key in next)) out.set(settingsFieldPointer(pointer), { delete: true });
      else if (!(key in base)) out.set(settingsFieldPointer(pointer), { value: next[key] });
      else diffPointers(base[key], next[key], pointer, out);
    }
    return;
  }
  if (Array.isArray(base) && Array.isArray(next) && base.length === next.length) {
    for (let i = 0; i < base.length; i += 1)
      diffPointers(base[i], next[i], [...prefix, String(i)], out);
    return;
  }
  if (JSON.stringify(base) !== JSON.stringify(next))
    out.set(settingsFieldPointer(prefix), { value: next });
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function display(value: unknown): string {
  if (value === undefined) return "—";
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}
