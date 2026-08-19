/**
 * PROTOTYPE — settings-panes round 1, variant B "IDE workbench" (throwaway with the round;
 * see docs/features/settings/PRODUCT.md). Reached at /settings?variant=b.
 *
 * THE FRAME: the sentence dies; the tree IS the addressing. Three panes, always visible:
 *   LEFT   a real file tree (workspace → module → root → directories → files),
 *   CENTER the generated field form (the pointer-keyed substrate),
 *   RIGHT  the raw JSON editor (the whole-file lane).
 *
 * WRITE MODELS (the round's question):
 *   - center form = the EXISTING lane: stage per-pointer, save splices staged fields
 *     (settings.document.save — real op, simulated here against local state).
 *   - right raw  = the WHOLE-FILE lane: an explicit "save file" verb that would write
 *     rawContent as-is. NO HOST OP EXISTS for this (save splices staged fields only;
 *     create refuses existing paths) — stubbed, gap recorded at the call site.
 *
 * ARBITRATION (one rule, visible): THE RAW LANE WINS WHILE DIRTY. A dirty raw pane
 *   disables the form's "save staged" verb (reason rendered beside it, un-gagged-commit
 *   style) and suspends the raw pane's staged-splice preview. Per-row staging stays
 *   allowed — the substrate is a parallel lane, and the disabled save says so.
 *
 * FORM→RAW SYNC (choice, noted): while the raw pane is CLEAN it renders a PREVIEW —
 *   the snapshot with staged fields spliced in — so staging a field visibly rewrites
 *   the raw text. The first raw keystroke FORKS that preview into the dirty raw text
 *   (what you see is what you fork); the caution chip then names the dishonesty: raw
 *   edits bypass the pointer-keyed fields substrate and the chat/pea lane cannot see them.
 *
 * GAP(branch): the design-lang kit (`components/lang/{verb,chip,cell}.tsx`, `lib/use-verb.ts`)
 *   exists on main but not on this worktree branch — the `Verb` / `FactChip` / state-cell
 *   row and `useVerbLite` below are minimal INLINE STAND-INS mirroring the kit's API
 *   (required `reason` / `title`), styled with this branch's tokens. Adopt the real kit
 *   on rebase; do not promote these.
 */
import { useMemo, useState } from "react";
import { Check, CheckCheck, ChevronDown, ChevronRight, RotateCcw, X } from "lucide-react";

import { settingsFieldSegments, type SettingsFieldState } from "@pe/agent-contracts";
import type { SettingsFileEntry } from "@pe/host-contracts/operation-types";

import { cn } from "#/lib/utils";
import {
  fixtureDocument,
  fixtureFiles,
  fixtureRawContent,
  fixtureRawFor,
  fixtureWorkspaces,
} from "#/settings-panes/fixture";
import { JsonEditor } from "#/settings-panes/json-editor";

const SEEDED_PATH = "mechanical/vav-boxes.json";

/* ── inline lang stand-ins (see GAP(branch) in the header) ─────────────────── */

/** Verb stand-in — `reason` required (every refusal explains itself, §3); a DISABLED
 * commit verb also renders its reason visibly (the un-gagged commit). */
function Verb({
  label,
  onClick,
  reason,
  tone = "act",
  disabled,
  icon,
}: {
  label: string;
  onClick: () => void;
  reason: string;
  tone?: "act" | "commit";
  disabled?: boolean;
  icon?: React.ReactNode;
}) {
  return (
    <>
      <button
        type="button"
        title={reason}
        disabled={disabled}
        onClick={onClick}
        className={cn(
          "inline-flex h-6 items-center gap-1 rounded-[2px] px-2 text-xs",
          tone === "commit"
            ? "bg-[var(--cat-green)] text-white hover:bg-[var(--cat-green)]/85 disabled:bg-transparent disabled:text-[var(--lichen)] disabled:italic disabled:outline disabled:outline-1 disabled:outline-[var(--line)]"
            : "border border-[var(--line)] text-[var(--slate)] hover:bg-[var(--line-2)] disabled:italic disabled:text-[var(--lichen)]",
        )}
      >
        {icon}
        {label}
      </button>
      {tone === "commit" && disabled === true ? (
        <span className="text-[10px] italic text-[var(--lichen)]">{reason}</span>
      ) : null}
    </>
  );
}

/** FactChip stand-in — a state fact, not a control; `title` required; `dashed` is the
 * reserved seam/stand-in edge (§3: "a stand-in announces itself"). */
function FactChip({
  children,
  title,
  dashed,
  caution,
}: {
  children: React.ReactNode;
  title: string;
  dashed?: boolean;
  caution?: boolean;
}) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex h-5 items-center rounded-[2px] border px-1.5 font-mono text-[10px]",
        dashed ? "border-dashed" : "",
        caution
          ? "border-[var(--cat-clay)] text-[var(--cat-clay)]"
          : "border-[var(--line)] text-[var(--lichen)]",
      )}
    >
      {children}
    </span>
  );
}

/** useVerb stand-in — sync-only receipt/outcome; the real hook's serialized async
 * bracket is pointless against local state. GAP(branch): adopt `lib/use-verb.ts` on rebase. */
function useVerbLite() {
  const [receipt, setReceipt] = useState<{ text: string; atMs: number } | null>(null);
  const [outcome, setOutcome] = useState<string | null>(null);
  const run = (label: string, work: () => string | void) => {
    try {
      const text = work();
      setOutcome(null);
      if (typeof text === "string") setReceipt({ text, atMs: Date.now() });
    } catch (cause) {
      setOutcome(`${label} refused — ${cause instanceof Error ? cause.message : String(cause)}`);
    }
  };
  return { receipt, outcome, run };
}

/* ── the variant ───────────────────────────────────────────────────────────── */

export function VariantB() {
  const [selected, setSelected] = useState(SEEDED_PATH);
  const [snapshotRaw, setSnapshotRaw] = useState(fixtureRawContent);
  const [fields, setFields] = useState<Record<string, SettingsFieldState>>(() =>
    cloneFields(fixtureDocument.fields),
  );
  /** null = clean (the pane tracks snapshot/preview); a string = the dirty fork. */
  const [rawText, setRawText] = useState<string | null>(null);
  const verb = useVerbLite();

  const rows = useMemo(() => buildRows(snapshotRaw, fields), [snapshotRaw, fields]);
  const stagedCount = rows.filter((r) => r.field?.staged != null).length;
  const attentionCount = rows.filter((r) => r.field?.review === "attention").length;
  const proposalCount = rows.filter((r) => r.field?.proposal && r.field.staged == null).length;

  const rawDirty = rawText !== null;
  // SYNC CHOICE: the clean raw pane shows the staged-splice PREVIEW, so staging a field
  // visibly rewrites the raw text. Dirty suspends the preview — the fork is yours alone.
  const preview = useMemo(
    () => (stagedCount > 0 ? spliceStaged(snapshotRaw, fields) : snapshotRaw),
    [snapshotRaw, fields, stagedCount],
  );
  const editorValue = rawDirty ? rawText : preview;

  const canSaveStaged = stagedCount > 0 && attentionCount === 0 && !rawDirty;
  const saveStagedReason = rawDirty
    ? "raw pane is dirty — the raw lane owns the file; save or revert it first"
    : stagedCount === 0
      ? "nothing staged"
      : attentionCount > 0
        ? `${attentionCount} staged field${attentionCount === 1 ? "" : "s"} need attention`
        : `splice ${stagedCount} staged field${stagedCount === 1 ? "" : "s"} into the file (settings.document.save)`;

  const patchField = (path: string, patch: Partial<SettingsFieldState>) =>
    setFields((prev) => {
      const base: SettingsFieldState = prev[path] ?? {
        proposal: null,
        staged: null,
        review: "none",
      };
      return { ...prev, [path]: { ...base, ...patch } };
    });

  const openFile = (relativePath: string) => {
    setSelected(relativePath);
    setSnapshotRaw(fixtureRawFor(relativePath));
    setRawText(null);
    // Field states are per-document; swapping files clears them. The seeded file re-seeds
    // so the demo stays alive on return (prototype choice — real state rides the route doc).
    setFields(relativePath === SEEDED_PATH ? cloneFields(fixtureDocument.fields) : {});
  };

  const saveStaged = () =>
    verb.run("save staged", () => {
      // Simulates settings.document.save: splice staged fields, clear their states.
      setSnapshotRaw(spliceStaged(snapshotRaw, fields));
      setFields((prev) =>
        Object.fromEntries(Object.entries(prev).filter(([, f]) => f.staged == null)),
      );
      return `saved ${stagedCount} staged field${stagedCount === 1 ? "" : "s"}`;
    });

  const saveFile = () =>
    verb.run("save file", () => {
      // GAP(host): NO WHOLE-FILE SAVE OP EXISTS. settings.document.save splices staged
      // fields only; settings.document.create refuses existing paths. This lane needs a
      // new host-facing command — e.g. settings.document.saveRaw { documentId, rawContent,
      // versionToken } — before it can be anything but a local simulation.
      if (rawText === null) return;
      try {
        JSON.parse(rawText);
      } catch (cause) {
        // Refuse rather than act unreliably (§3): a whole-file write of broken JSON
        // would brick every pointer in the substrate.
        throw new Error(
          `not valid JSON (${cause instanceof Error ? cause.message : "parse error"})`,
        );
      }
      setSnapshotRaw(rawText);
      setRawText(null);
      // A wholesale write makes every pointer-keyed state stale — clear, don't guess.
      setFields({});
      return "file saved (local stub — no host op)";
    });

  const issues =
    selected === SEEDED_PATH ? (fixtureDocument.snapshot?.validation?.issues ?? []) : [];

  return (
    <div className="flex h-screen bg-[var(--paper)] text-[var(--clay-ink)]">
      {/* ── LEFT: the tree IS the addressing ── */}
      <div className="flex w-[240px] shrink-0 flex-col border-r border-[var(--line)]">
        <div className="flex h-9 shrink-0 items-center border-b border-[var(--line-2)] px-3">
          <span className="tele-label text-[var(--lichen)]">Settings files</span>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto py-1">
          <FileTree selected={selected} onOpen={openFile} />
        </div>
      </div>

      {/* ── CENTER: the generated form ── */}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-9 shrink-0 items-center gap-2 border-b border-[var(--line-2)] px-3">
          <span className="truncate font-mono text-xs font-medium">{selected}</span>
          <FactChip
            dashed
            title="Round-1 fixture world: null version token by construction — no verb here reaches a host."
          >
            fixture — nothing here writes
          </FactChip>
          <span className="ml-auto flex items-center gap-3 text-[10px] text-[var(--slate)]">
            <span>
              <span className="tele">{proposalCount}</span> proposed
            </span>
            <span>
              <span className="tele">{stagedCount}</span> staged
            </span>
            {attentionCount > 0 ? (
              <span className="text-[var(--fail)]">
                <span className="tele">{attentionCount}</span> attention
              </span>
            ) : null}
          </span>
          <Verb
            label={`Save staged${stagedCount > 0 ? ` ${stagedCount}` : ""}`}
            tone="commit"
            icon={<CheckCheck className="size-3" />}
            disabled={!canSaveStaged}
            reason={saveStagedReason}
            onClick={saveStaged}
          />
        </div>
        {verb.receipt || verb.outcome ? (
          <div className="shrink-0 border-b border-[var(--line-2)] px-3 py-1 text-[10px]">
            {verb.outcome ? (
              <span className="text-[var(--cat-clay)]">{verb.outcome}</span>
            ) : (
              <span className="text-[var(--lichen)]">{verb.receipt?.text}</span>
            )}
          </div>
        ) : null}
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          {rows.length > 0 ? (
            <div className="divide-y divide-[var(--line-2)] rounded-[2px] border border-[var(--line)]">
              {rows.map((row) => (
                <FieldRow
                  key={row.path}
                  row={row}
                  issue={issues.find((i) => i.path === row.path)?.message}
                  onApprove={() =>
                    patchField(row.path, {
                      staged:
                        row.field?.proposal?.delete === true
                          ? { delete: true }
                          : { value: row.field?.proposal?.value },
                      review: "good",
                    })
                  }
                  onDeny={() => patchField(row.path, { proposal: null, review: "none" })}
                  onUnstage={() => patchField(row.path, { staged: null, review: "none" })}
                />
              ))}
            </div>
          ) : (
            <div className="mt-6 rounded-[2px] border border-dashed border-[var(--line)] p-6 text-center text-xs text-[var(--lichen)]">
              This document has no fields.
            </div>
          )}
        </div>
      </div>

      {/* ── RIGHT: the raw whole-file lane ── */}
      <div className="flex w-[40%] shrink-0 flex-col border-l border-[var(--line)]">
        <div className="flex h-9 shrink-0 items-center gap-2 border-b border-[var(--line-2)] px-3">
          <span className="tele-label text-[var(--lichen)]">Raw JSON</span>
          {rawDirty ? (
            <Verb
              label="Revert"
              icon={<RotateCcw className="size-3" />}
              reason="Discard the raw fork and track the snapshot (and staged preview) again"
              onClick={() => setRawText(null)}
            />
          ) : stagedCount > 0 ? (
            <FactChip title="The clean raw pane previews the snapshot with staged fields spliced in — save staged writes exactly this.">
              previewing {stagedCount} staged
            </FactChip>
          ) : null}
          <span className="ml-auto" />
          <Verb
            label="Save file"
            tone="commit"
            disabled={!rawDirty}
            reason={
              rawDirty
                ? "Write the whole file as-is — STUB: no host op exists for whole-file save"
                : "raw pane matches the snapshot — nothing to write"
            }
            onClick={saveFile}
          />
        </div>
        {rawDirty ? (
          <div className="shrink-0 border-b border-[var(--line-2)] px-3 py-1.5">
            {/* Dishonesty made visible — this variant's experiment. */}
            <FactChip
              caution
              title="The whole-file lane writes text the substrate never saw. Pointer-keyed field states, pea's proposals, and the chat reviewer all read `fields` — none of them can see or review a raw edit."
            >
              raw edits bypass the fields substrate — the chat/pea lane cannot see them
            </FactChip>
          </div>
        ) : null}
        <div className="min-h-0 flex-1">
          <JsonEditor className="h-full" value={editorValue} onChange={setRawText} />
        </div>
      </div>
    </div>
  );
}

/* ── the tree (built inline — a separate component is a promotion decision the
      round makes later) ─────────────────────────────────────────────────────── */

function FileTree({ selected, onOpen }: { selected: string; onOpen: (path: string) => void }) {
  // Default-open the chain to the seeded selection.
  const [expanded, setExpanded] = useState<Set<string>>(
    () =>
      new Set(["ws:office", "mod:pe.schedules", "root:pe.schedules/profiles", "dir:mechanical"]),
  );
  const toggle = (key: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const { dirNames, byDir } = useMemo(() => {
    const map = new Map<string, SettingsFileEntry[]>();
    for (const entry of fixtureFiles) {
      const dir = entry.directory ?? "";
      const list = map.get(dir) ?? [];
      list.push(entry);
      map.set(dir, list);
    }
    return { dirNames: [...map.keys()].filter((d) => d !== "").sort(), byDir: map };
  }, []);

  return (
    <div className="text-xs">
      {fixtureWorkspaces.map((ws) => {
        const wsKey = `ws:${ws.workspaceKey}`;
        return (
          <div key={ws.workspaceKey}>
            <TreeRow
              depth={0}
              label={ws.displayName || ws.workspaceKey}
              expanded={expanded.has(wsKey)}
              onClick={() => toggle(wsKey)}
            />
            {expanded.has(wsKey)
              ? ws.modules.map((mod) => {
                  const modKey = `mod:${mod.moduleKey}`;
                  return (
                    <div key={mod.moduleKey}>
                      <TreeRow
                        depth={1}
                        label={mod.moduleKey}
                        mono
                        expanded={expanded.has(modKey)}
                        onClick={() => toggle(modKey)}
                      />
                      {expanded.has(modKey)
                        ? mod.roots.map((root) => {
                            const rootKey = `root:${mod.moduleKey}/${root.rootKey}`;
                            // Fixture files exist only under pe.schedules/profiles.
                            const populated =
                              mod.moduleKey === "pe.schedules" && root.rootKey === "profiles";
                            return (
                              <div key={root.rootKey}>
                                <TreeRow
                                  depth={2}
                                  label={root.displayName || root.rootKey}
                                  expanded={expanded.has(rootKey)}
                                  onClick={() => toggle(rootKey)}
                                />
                                {expanded.has(rootKey) ? (
                                  populated ? (
                                    <>
                                      {dirNames.map((dir) => (
                                        <div key={dir}>
                                          <TreeRow
                                            depth={3}
                                            label={`${dir}/`}
                                            mono
                                            expanded={expanded.has(`dir:${dir}`)}
                                            onClick={() => toggle(`dir:${dir}`)}
                                          />
                                          {expanded.has(`dir:${dir}`)
                                            ? (byDir.get(dir) ?? []).map((f) => (
                                                <FileRow
                                                  key={f.relativePath}
                                                  depth={4}
                                                  entry={f}
                                                  selected={f.relativePath === selected}
                                                  onOpen={onOpen}
                                                />
                                              ))
                                            : null}
                                        </div>
                                      ))}
                                      {(byDir.get("") ?? []).map((f) => (
                                        <FileRow
                                          key={f.relativePath}
                                          depth={3}
                                          entry={f}
                                          selected={f.relativePath === selected}
                                          onOpen={onOpen}
                                        />
                                      ))}
                                    </>
                                  ) : (
                                    // Empty state: "nothing in scope" is the root's own story (§4).
                                    <div
                                      className="py-1 pr-2 italic text-[var(--lichen)]"
                                      style={{ paddingLeft: depthPad(3) }}
                                    >
                                      no files in this fixture root
                                    </div>
                                  )
                                ) : null}
                              </div>
                            );
                          })
                        : null}
                    </div>
                  );
                })
              : null}
          </div>
        );
      })}
    </div>
  );
}

function depthPad(depth: number) {
  return 8 + depth * 14;
}

function TreeRow({
  depth,
  label,
  mono,
  expanded,
  onClick,
}: {
  depth: number;
  label: string;
  mono?: boolean;
  expanded: boolean;
  onClick: () => void;
}) {
  const Chevron = expanded ? ChevronDown : ChevronRight;
  return (
    <button
      type="button"
      onClick={onClick}
      title={expanded ? `Collapse ${label}` : `Expand ${label}`}
      className="flex w-full items-center gap-1 py-1 pr-2 text-left text-[var(--slate)] hover:bg-[var(--line-2)]"
      style={{ paddingLeft: depthPad(depth) }}
    >
      <Chevron className="size-3 shrink-0 text-[var(--lichen)]" />
      <span className={cn("truncate", mono && "font-mono")}>{label}</span>
    </button>
  );
}

function FileRow({
  depth,
  entry,
  selected,
  onOpen,
}: {
  depth: number;
  entry: SettingsFileEntry;
  selected: boolean;
  onOpen: (path: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onOpen(entry.relativePath)}
      title={`Open ${entry.relativePath} — swaps the document and clears field states`}
      className={cn(
        "flex w-full items-baseline gap-2 py-1 pr-2 text-left hover:bg-[var(--line-2)]",
        // Selection is a FILL, never a hue (§5).
        selected && "bg-[color-mix(in_srgb,var(--clay-ink)_8%,transparent)]",
      )}
      style={{ paddingLeft: depthPad(depth) + 16 }}
    >
      <span className="truncate font-mono text-[var(--clay-ink)]">{entry.baseName}</span>
      <span className="ml-auto shrink-0 text-[10px] text-[var(--lichen)]">
        {timeAgo(entry.modifiedUtc)}
      </span>
    </button>
  );
}

/* ── field rows — the shipping surface's row grammar against local state ───── */

interface Row {
  path: string;
  current: unknown;
  field?: SettingsFieldState;
}

function FieldRow({
  row,
  issue,
  onApprove,
  onDeny,
  onUnstage,
}: {
  row: Row;
  issue?: string;
  onApprove: () => void;
  onDeny: () => void;
  onUnstage: () => void;
}) {
  const field = row.field;
  const staged = field?.staged != null;
  const proposal = !staged ? field?.proposal : undefined;
  const attention = field?.review === "attention";

  return (
    <div className="flex min-h-11 items-center gap-3 px-3 py-1.5">
      <div className="min-w-0 flex-1">
        <div className="truncate font-mono text-xs font-medium">{row.path}</div>
        <div className="truncate text-xs text-[var(--slate)]">
          <span className="text-[var(--lichen)]">current:</span> {display(row.current)}
          {staged ? (
            <>
              {" "}
              <span className={attention ? "text-[var(--fail)]" : "text-[var(--cat-green)]"}>
                → staged:
              </span>{" "}
              <span className="text-[var(--clay-ink)]">
                {field?.staged?.delete === true ? "(delete)" : display(field?.staged?.value)}
              </span>
            </>
          ) : proposal ? (
            <>
              {" "}
              <span className="text-[var(--pe-blue)]">→ pea:</span>{" "}
              <span className="text-[var(--clay-ink)]">
                {proposal.delete === true ? "(delete)" : display(proposal.value)}
              </span>
            </>
          ) : null}
        </div>
        {proposal && (proposal.confidence || proposal.note) ? (
          <div className="truncate text-[10px] text-[var(--lichen)]">
            {[proposal.confidence, proposal.note].filter(Boolean).join(" · ")}
          </div>
        ) : null}
        {attention && issue ? (
          <div className="truncate text-[10px] text-[var(--fail)]">{issue}</div>
        ) : null}
      </div>

      {staged ? (
        <Verb
          label="Unstage"
          icon={<RotateCcw className="size-3" />}
          reason={
            attention
              ? "Unstage this value — it is blocking save until the validation issue clears"
              : "Undo approval — the value returns to its current reading"
          }
          onClick={onUnstage}
        />
      ) : proposal ? (
        <div className="flex shrink-0 gap-1">
          <Verb
            label="Deny"
            icon={<X className="size-3" />}
            reason="Dismiss pea's suggestion — the current value stands"
            onClick={onDeny}
          />
          <Verb
            label="Approve"
            icon={<Check className="size-3" />}
            reason="Stage pea's suggested value — save staged writes it"
            onClick={onApprove}
          />
        </div>
      ) : null}
    </div>
  );
}

/* ── local-state plumbing (mirrors the shipping surface's helpers) ─────────── */

function cloneFields(
  fields: Record<string, SettingsFieldState>,
): Record<string, SettingsFieldState> {
  return JSON.parse(JSON.stringify(fields)) as Record<string, SettingsFieldState>;
}

function buildRows(raw: string, fields: Record<string, SettingsFieldState>): Row[] {
  const parsed = safeParse(raw);
  const leafPaths = parsed ? flattenLeafPaths(parsed) : [];
  const paths = new Set<string>([...leafPaths, ...Object.keys(fields)]);
  return [...paths]
    .sort((a, b) => a.localeCompare(b))
    .map((path) => ({
      path,
      current: parsed ? valueAtPath(parsed, settingsFieldSegments(path)) : undefined,
      field: fields[path],
    }));
}

/** Splice every staged edit into the raw text — the local reading of what
 * settings.document.save would produce. Unreachable pointers are skipped silently
 * (prototype; the host op refuses instead). */
function spliceStaged(raw: string, fields: Record<string, SettingsFieldState>): string {
  const parsed = safeParse(raw);
  if (!parsed) return raw;
  const next = JSON.parse(JSON.stringify(parsed)) as Record<string, unknown>;
  for (const [pointer, field] of Object.entries(fields)) {
    if (field.staged == null) continue;
    const segments = settingsFieldSegments(pointer);
    const leaf = segments.at(-1);
    if (leaf == null) continue;
    let cursor: unknown = next;
    for (const segment of segments.slice(0, -1)) {
      if (cursor == null || typeof cursor !== "object") break;
      cursor = (cursor as Record<string, unknown>)[segment];
    }
    if (cursor == null || typeof cursor !== "object") continue;
    if (field.staged.delete === true) delete (cursor as Record<string, unknown>)[leaf];
    else (cursor as Record<string, unknown>)[leaf] = field.staged.value;
  }
  return JSON.stringify(next, null, 2);
}

function safeParse(rawContent: string): Record<string, unknown> | null {
  if (!rawContent.trim()) return null;
  try {
    const parsed: unknown = JSON.parse(rawContent);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** Every leaf JSON Pointer. Objects recurse; arrays/primitives are leaves — except
 * array items that are objects, which recurse by index so the fixture's
 * `/fields/2/columnHeader` pointer addresses a row (shipping-surface parity would
 * treat the whole array as one leaf; the seeded fixture disagrees, so index-recursion
 * wins here — a round question for the form generator). */
function flattenLeafPaths(value: Record<string, unknown>, prefix: string[] = []): string[] {
  const out: string[] = [];
  for (const [key, child] of Object.entries(value)) {
    const segments = [...prefix, key];
    if (child != null && typeof child === "object" && !Array.isArray(child)) {
      out.push(...flattenLeafPaths(child as Record<string, unknown>, segments));
    } else if (
      Array.isArray(child) &&
      child.every((item) => item != null && typeof item === "object")
    ) {
      child.forEach((item, index) => {
        out.push(
          ...flattenLeafPaths(item as Record<string, unknown>, [...segments, String(index)]),
        );
      });
    } else {
      out.push(segments.map((s) => `/${s.replaceAll("~", "~0").replaceAll("/", "~1")}`).join(""));
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

function display(value: unknown): string {
  if (value === undefined) return "—";
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(ms)) return "";
  const min = Math.round(ms / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h`;
  return `${Math.round(hr / 24)}d`;
}
