/**
 * PROTOTYPE — settings-panes round 1, VARIANT C: "the annotated file" (throwaway with the
 * round; see docs/features/settings/PRODUCT.md).
 *
 * THE GENERATED FORM IS RETIRED HERE. The raw JSON *is* the page — this variant exists to
 * test whether the file itself can carry the whole review. Trichotomy state renders as
 * line-anchored marks on the text (dec-proposed / dec-staged / dec-attention / dec-issue);
 * decisions happen in a right-edge annotation strip aligned beside the marked lines. The
 * mark LOCATES, the strip DECIDES — the decision sits where the evidence is, and the
 * affordances never move the content (SURFACE-PHILOSOPHY §4).
 *
 * CORE ARGUMENT: even under raw text editing, pointer-keyed `fields` stay the substrate.
 * "done" re-parses the buffer, diffs LEAF POINTERS against what was shown, and stages each
 * change per-pointer — so pea's SSE proposals, the chat-plugin reviewer, and this page all
 * keep reading and writing the same `Record<pointer, SettingsFieldState>`. Raw editing does
 * not blind the chat lane; that is this variant's whole bid.
 *
 * BRANCH GAP: this worktree branch predates the design-sweep lang kit — `#/components/lang`
 * (FactChip, Verb) and `#/lib/use-verb` exist only on main. The stand-ins below mirror those
 * APIs (tones, required `reason`/`title`, the un-gagged disabled commit) and port 1:1 when
 * the branch catches up. No `#/components/ui/button` anywhere in this file. `useVerb` itself
 * is deliberately absent: every verb here is a synchronous local-state mutation — the async
 * bracket arrives with real host commands.
 */
import { useMemo, useState } from "react";

import { settingsFieldSegments, type SettingsFieldState } from "@pe/agent-contracts";

import { cn } from "#/lib/utils";

import { fixtureDocument, fixtureFiles, fixtureRawFor } from "../fixture";
import { JsonEditor, JsonView, type HighlightDecoration } from "../json-editor";

/* ── lang stand-ins (port to #/components/lang when the branch catches up to main) ──── */

type FactTone = "meta" | "caution" | "done" | "alarm" | "pea";

const CHIP_TONES: Record<FactTone, string> = {
  meta: "border-[var(--r-line,#d8d4cc)] text-[var(--r-ink-2,#555)]",
  caution:
    "border-[var(--r-caution,#b45309)] bg-[var(--r-caution-wash,#fdf3e0)] text-[var(--r-caution,#b45309)]",
  done: "border-[var(--r-done,#2e7d43)] text-[var(--r-done,#2e7d43)]",
  alarm: "border-[var(--r-alarm,#b91c1c)] text-[var(--r-alarm,#b91c1c)]",
  pea: "border-[var(--r-pea,#3f7d4e)] bg-[var(--r-pea-wash,#eef6ee)] text-[var(--r-pea,#3f7d4e)]",
};

/** A state fact, mono, not a control. `title` required: what the fact means, what changes it. */
function FactChip({
  children,
  tone = "meta",
  dashed,
  title,
}: {
  children: React.ReactNode;
  tone?: FactTone;
  /** Reserved for seam — typed but unproven; the fixture wears it. */
  dashed?: boolean;
  title: string;
}) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex shrink-0 items-center rounded-[2px] border px-1.5 font-mono text-[11px] leading-5",
        CHIP_TONES[tone],
        dashed && "border-dashed",
      )}
    >
      {children}
    </span>
  );
}

/** Every control that acts. `reason` is required, always — it is the title; a DISABLED
 * commit verb alone also says its reason on the surface (the un-gagged commit ruling). */
function Verb({
  label,
  onClick,
  reason,
  tone = "act",
  disabled,
  className,
}: {
  label: string;
  onClick: () => void;
  reason: string;
  tone?: "act" | "commit";
  disabled?: boolean;
  className?: string;
}) {
  const inert = disabled === true;
  return (
    <>
      <button
        type="button"
        title={reason}
        disabled={inert}
        onClick={onClick}
        className={cn(
          "shrink-0 rounded-[2px] border px-2 text-xs leading-5",
          tone === "commit"
            ? "border-transparent bg-[var(--r-commit,#1c5fae)] text-white hover:bg-[var(--r-commit,#1c5fae)]/85"
            : "border-[var(--r-line,#d8d4cc)] text-[var(--r-ink-1,#1a1a1a)] hover:bg-[color-mix(in_srgb,var(--r-ink-1,#1a1a1a)_8%,transparent)]",
          inert &&
            "cursor-default border-[var(--r-line,#d8d4cc)] bg-[color-mix(in_srgb,var(--r-ink-3,#888)_8%,transparent)] italic text-[var(--r-ink-3,#888)] hover:bg-[color-mix(in_srgb,var(--r-ink-3,#888)_8%,transparent)]",
          className,
        )}
      >
        {label}
      </button>
      {tone === "commit" && inert ? (
        <span className="max-w-[24rem] truncate text-[11px] italic text-[var(--r-ink-3,#888)]">
          {reason}
        </span>
      ) : null}
    </>
  );
}

/* ── pointer ⇄ line resolution ────────────────────────────────────────────────────────── */

const LINE_H = 20; // leading-5, pinned on the pane below — the strip's whole geometry
const PANE_PAD = 8; // .jsonpane pre padding-top (json-editor.css)

function escapeSeg(segment: string): string {
  return segment.replaceAll("~", "~0").replaceAll("/", "~1");
}

/**
 * Map every JSON Pointer in `root` to the 1-based line its value starts on — by mirroring
 * exactly how `JSON.stringify(root, null, 2)` lays lines out (scalars are one line because
 * stringify escapes newlines; empty {} / [] print inline; each entry of a non-empty
 * container opens a fresh line; a closing bracket takes one more).
 *
 * CEILING: exact only because this pane always renders the CANONICAL 2-space serialization
 * of the parsed value (edits are re-canonicalized on "done"). A hand-formatted on-disk file
 * — different indentation, one-line objects, trailing whitespace — needs a real
 * position-tracking parser instead of this mirror-walk.
 */
function pointerLines(root: unknown): Map<string, number> {
  const map = new Map<string, number>();
  let line = 1;
  const walk = (value: unknown, pointer: string): void => {
    map.set(pointer, line);
    if (value !== null && typeof value === "object") {
      const entries = Array.isArray(value)
        ? value.map((child, index) => [String(index), child] as const)
        : Object.entries(value as Record<string, unknown>);
      if (entries.length === 0) return; // {} / [] render inline on the current line
      for (const [key, child] of entries) {
        line += 1;
        walk(child, `${pointer}/${escapeSeg(key)}`);
      }
      line += 1; // closing bracket
    }
  };
  walk(root, "");
  return map;
}

/** Every leaf pointer → value. Unlike the shipping route's flatten (arrays are leaves
 * there), this recurses into arrays too — matching how pea addresses "/fields/2/columnHeader".
 * Empty containers count as leaves so staging `[]` diffs cleanly. */
function flattenLeaves(
  value: unknown,
  pointer = "",
  out = new Map<string, unknown>(),
): Map<string, unknown> {
  if (value !== null && typeof value === "object") {
    const entries = Array.isArray(value)
      ? value.map((child, index) => [String(index), child] as const)
      : Object.entries(value as Record<string, unknown>);
    if (entries.length > 0) {
      for (const [key, child] of entries) flattenLeaves(child, `${pointer}/${escapeSeg(key)}`, out);
      return out;
    }
  }
  out.set(pointer, value);
  return out;
}

function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function valueAt(root: unknown, pointer: string): unknown {
  let cursor: unknown = root;
  for (const seg of settingsFieldSegments(pointer)) {
    if (cursor == null || typeof cursor !== "object") return undefined;
    cursor = Array.isArray(cursor) ? cursor[Number(seg)] : (cursor as Record<string, unknown>)[seg];
  }
  return cursor;
}

function setAt(root: unknown, segments: string[], value: unknown): void {
  let cursor = root as Record<string, unknown> | unknown[];
  for (let i = 0; i < segments.length - 1; i++) {
    const seg = segments[i]!;
    const next = Array.isArray(cursor)
      ? cursor[Number(seg)]
      : (cursor as Record<string, unknown>)[seg];
    if (next == null || typeof next !== "object") {
      // gap: intermediate containers are minted by the NEXT segment's spelling (digits →
      // array); a pointer that means "object with numeric keys" would be mis-minted. Fine
      // for a prototype whose fixtures never stage into missing paths.
      const made: Record<string, unknown> | unknown[] = /^\d+$/.test(segments[i + 1]!) ? [] : {};
      if (Array.isArray(cursor)) cursor[Number(seg)] = made;
      else (cursor as Record<string, unknown>)[seg] = made;
      cursor = made;
    } else {
      cursor = next as Record<string, unknown> | unknown[];
    }
  }
  const last = segments.at(-1)!;
  if (Array.isArray(cursor)) cursor[Number(last)] = value;
  else (cursor as Record<string, unknown>)[last] = value;
}

function deleteAt(root: unknown, segments: string[]): void {
  let cursor: unknown = root;
  for (const seg of segments.slice(0, -1)) {
    if (cursor == null || typeof cursor !== "object") return;
    cursor = Array.isArray(cursor) ? cursor[Number(seg)] : (cursor as Record<string, unknown>)[seg];
  }
  if (cursor == null || typeof cursor !== "object") return;
  const last = segments.at(-1)!;
  if (Array.isArray(cursor)) cursor.splice(Number(last), 1);
  else delete (cursor as Record<string, unknown>)[last];
}

/** The working-tree view: staged edits spliced over the saved file. Proposals are NOT
 * spliced — they are pea's, not accepted; their mark anchors on the CURRENT value's line.
 * gap: several staged array-element deletes shift each other's indices (splice order is
 * object-key order) — the same per-pointer-splice question the shipping `save` owns. */
function spliceStaged(disk: unknown, fields: Record<string, SettingsFieldState>): unknown {
  const out: unknown = structuredClone(disk);
  for (const [pointer, field] of Object.entries(fields)) {
    const edit = field.staged;
    if (edit == null) continue;
    const segments = settingsFieldSegments(pointer);
    if (edit.delete === true) deleteAt(out, segments);
    else setAt(out, segments, structuredClone(edit.value));
  }
  return out;
}

function display(value: unknown): string {
  if (value === undefined) return "—";
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

/* ── annotations ──────────────────────────────────────────────────────────────────────── */

type Issue = NonNullable<
  NonNullable<(typeof fixtureDocument)["snapshot"]>["validation"]
>["issues"][number];

interface Annotation {
  pointer: string;
  line: number | null;
  field?: SettingsFieldState;
  issues: Issue[];
}

type MarkKind = "proposed" | "staged" | "attention" | "issue";

function kindOf(a: Annotation): MarkKind {
  if (a.field?.staged != null) return a.field.review === "attention" ? "attention" : "staged";
  if (a.field?.proposal != null) return "proposed";
  return "issue";
}

const ACCENT: Record<MarkKind, string> = {
  proposed: "var(--r-pea,#3f7d4e)",
  staged: "var(--r-caution,#b45309)",
  attention: "var(--r-caution,#b45309)",
  issue: "var(--r-alarm,#b91c1c)",
};

const DEC_CLASS: Record<Exclude<MarkKind, "issue">, string> = {
  proposed: "dec-proposed",
  staged: "dec-staged",
  attention: "dec-attention",
};

/** gap: card heights are ESTIMATES for the collision pass — no post-render measurement, so
 * a very long pea note can overlap the next card. The real version measures. */
function estimateHeight(a: Annotation): number {
  let h = 30; // padding + pointer row
  const kind = kindOf(a);
  if (kind === "proposed") h += 36 + (a.field?.proposal?.note ? 30 : 0);
  else if (kind !== "issue") h += 36;
  h += a.issues.length * 30;
  if (a.field != null) h += 26; // verb row
  return h;
}

/* ── the variant ──────────────────────────────────────────────────────────────────────── */

const FIXTURE_PATH = "mechanical/vav-boxes.json";
const fixtureIssues: Issue[] = fixtureDocument.snapshot?.validation?.issues ?? [];

export function VariantC() {
  const [filePath, setFilePath] = useState(FIXTURE_PATH);
  const [raw, setRaw] = useState(() => fixtureRawFor(FIXTURE_PATH));
  const [fields, setFields] = useState<Record<string, SettingsFieldState>>(() => ({
    ...fixtureDocument.fields,
  }));
  // gap: validation is the fixture's FROZEN snapshot — unstaging the flagged field clears
  // the attention gate but this issue list only changes on file switch; live revalidation
  // is the `validate` command's job and there is no host here.
  const [issues, setIssues] = useState<Issue[]>(fixtureIssues);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [parseRefusal, setParseRefusal] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  const parsedDisk = useMemo(() => JSON.parse(raw) as unknown, [raw]);
  const displayed = useMemo(() => spliceStaged(parsedDisk, fields), [parsedDisk, fields]);
  const code = useMemo(() => JSON.stringify(displayed, null, 2), [displayed]);
  const lines = useMemo(() => pointerLines(displayed), [displayed]);
  const lineCount = useMemo(() => code.split("\n").length, [code]);

  const annotations = useMemo<Annotation[]>(() => {
    const byPointer = new Map<string, Annotation>();
    for (const [pointer, field] of Object.entries(fields)) {
      if (field.proposal == null && field.staged == null) continue;
      byPointer.set(pointer, { pointer, line: lines.get(pointer) ?? null, field, issues: [] });
    }
    // audit finding #5's fix: issues JOIN their lines instead of dying in a head chip.
    for (const issue of issues) {
      if (!issue.path) continue;
      const slot = byPointer.get(issue.path);
      if (slot) slot.issues.push(issue);
      else
        byPointer.set(issue.path, {
          pointer: issue.path,
          line: lines.get(issue.path) ?? null,
          issues: [issue],
        });
    }
    // gap: an annotation whose pointer is not in the file (line == null — e.g. a staged
    // delete, or a proposal onto a missing path) sorts to the strip's end with an explicit
    // "not in file" tag instead of a line anchor. The fixture seeds none.
    return [...byPointer.values()].sort(
      (a, b) => (a.line ?? Number.POSITIVE_INFINITY) - (b.line ?? Number.POSITIVE_INFINITY),
    );
  }, [fields, issues, lines]);

  const decorations = useMemo<HighlightDecoration[]>(() => {
    const classesByLine = new Map<number, Set<string>>();
    for (const a of annotations) {
      if (a.line == null) continue;
      const set = classesByLine.get(a.line) ?? new Set<string>();
      const kind = kindOf(a);
      if (kind !== "issue") set.add(DEC_CLASS[kind]);
      if (a.issues.length > 0) set.add("dec-issue");
      classesByLine.set(a.line, set);
    }
    return [...classesByLine.entries()].map(([line, set]) => ({
      lines: line,
      className: [...set].join(" "),
    }));
  }, [annotations]);

  const placed = useMemo(() => {
    let cursor = PANE_PAD;
    const cards: { a: Annotation; top: number }[] = [];
    for (const a of annotations) {
      const ideal = a.line != null ? PANE_PAD + (a.line - 1) * LINE_H : cursor;
      const top = Math.max(ideal, cursor);
      cards.push({ a, top });
      cursor = top + estimateHeight(a) + 8;
    }
    return { cards, height: Math.max(PANE_PAD * 2 + lineCount * LINE_H, cursor) };
  }, [annotations, lineCount]);

  const proposedCount = Object.values(fields).filter(
    (f) => f.proposal != null && f.staged == null,
  ).length;
  const stagedCount = Object.values(fields).filter((f) => f.staged != null).length;
  const attentionCount = Object.values(fields).filter((f) => f.review === "attention").length;
  const canSave = stagedCount > 0 && attentionCount === 0;

  /* ── verbs (all local; approve stages, deny clears, save is a stub) ── */

  const setField = (pointer: string, next: SettingsFieldState | null) => {
    setFields((prev) => {
      const out = { ...prev };
      if (next == null) delete out[pointer];
      else out[pointer] = next;
      return out;
    });
  };

  const approve = (pointer: string, field: SettingsFieldState) => {
    const proposal = field.proposal;
    if (proposal == null) return;
    setField(pointer, {
      ...field,
      staged: proposal.delete === true ? { delete: true } : { value: proposal.value },
      review: "good",
    });
  };

  const deny = (pointer: string, field: SettingsFieldState) => {
    if (field.staged == null) setField(pointer, null);
    else setField(pointer, { ...field, proposal: null });
  };

  const unstage = (pointer: string, field: SettingsFieldState) => {
    if (field.proposal == null) setField(pointer, null);
    else setField(pointer, { ...field, staged: null, review: "none" });
  };

  const save = () => {
    // Local stub: the real lane is `settings.document.save` splicing staged fields with the
    // open version token — and PRODUCT.md's contract fact stands: there is NO raw-content
    // save for an existing document, so a whole-file write lane would be a new host command.
    const n = stagedCount;
    setRaw(JSON.stringify(displayed, null, 2));
    setFields((prev) => {
      const out: Record<string, SettingsFieldState> = {};
      for (const [pointer, field] of Object.entries(prev)) {
        // Approved proposals are consumed by the save; untouched open proposals survive it.
        if (field.staged == null) out[pointer] = field;
      }
      return out;
    });
    setReceipt(`saved ${n} field${n === 1 ? "" : "s"} — local stub`);
  };

  const beginEdit = () => {
    setDraft(code);
    setParseRefusal(null);
    setReceipt(null);
    setEditing(true);
  };

  /** Parse → canonicalize → leaf-diff → stage per pointer. Keeps the pointer-keyed
   * substrate under raw editing — the chat/pea lane stays sighted. */
  const doneEditing = () => {
    let next: unknown;
    try {
      next = JSON.parse(draft);
    } catch (cause) {
      setParseRefusal(
        `not JSON — ${cause instanceof Error ? cause.message : String(cause)}. Fix it or discard.`,
      );
      return;
    }
    setParseRefusal(null);
    const before = flattenLeaves(displayed); // what the user saw and edited
    const disk = flattenLeaves(parsedDisk); // what the file still holds
    const after = flattenLeaves(next);
    setFields((prev) => {
      const out = { ...prev };
      for (const [pointer, value] of after) {
        if (before.has(pointer) && sameJson(before.get(pointer), value)) continue; // untouched
        if (disk.has(pointer) && sameJson(disk.get(pointer), value)) {
          // Typed back to the saved value: the field is simply CLEAN again — and any open
          // proposal on it was still touched, so it severs with the rest.
          delete out[pointer];
          continue;
        }
        // SEVER (§3 "typing beats proposing", R6): the user's text stands; an open proposal
        // on a touched pointer vanishes with NO trace — history is not computable from
        // current facts, and no severed member exists to record it.
        out[pointer] = { proposal: null, staged: { value }, review: "good" };
      }
      for (const pointer of before.keys()) {
        if (after.has(pointer)) continue;
        if (!disk.has(pointer))
          delete out[pointer]; // deleting a staged add = clean
        else out[pointer] = { proposal: null, staged: { delete: true }, review: "good" };
      }
      return out;
    });
    // gap (round finding, worth the verdict's attention): positional array pointers are
    // UNSTABLE under element insert/delete — removing fields[1] in the editor rewrites
    // every later element's pointer, so the leaf-diff stages a shift-storm of changes
    // rather than one removal. Honest, but ugly; a keyed addressing scheme (or array-level
    // staging) is the ceiling breaker.
    setEditing(false);
  };

  const openFile = (relativePath: string) => {
    setFilePath(relativePath);
    setRaw(fixtureRawFor(relativePath));
    // gap: only the vav-boxes fixture seeds trichotomy state + validation; other tree files
    // open clean — the file-switch story, not their contents, is under review here.
    setFields(relativePath === FIXTURE_PATH ? { ...fixtureDocument.fields } : {});
    setIssues(relativePath === FIXTURE_PATH ? fixtureIssues : []);
    setEditing(false);
    setParseRefusal(null);
    setReceipt(null);
    setPickerOpen(false);
  };

  /* ── render ── */

  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--r-ground,#fdfcfa)]">
      {/* head: one thin line — the sentence, the facts, the verbs */}
      <div className="flex shrink-0 items-center gap-2 border-b border-[var(--r-line,#d8d4cc)] px-3 py-1.5 text-xs text-[var(--r-ink-2,#555)]">
        <span className="shrink-0">
          pe.schedules · profiles ·{" "}
          <span className="relative inline-block">
            <button
              type="button"
              title="The open fixture file — switches among the fixture tree's files"
              className="font-mono text-[var(--r-ink-1,#1a1a1a)] underline decoration-dotted underline-offset-2"
              onClick={() => setPickerOpen((v) => !v)}
            >
              {filePath}
            </button>
            {pickerOpen ? (
              <>
                <button
                  type="button"
                  aria-label="close file list"
                  className="fixed inset-0 z-10 cursor-default"
                  onClick={() => setPickerOpen(false)}
                />
                <span className="absolute left-0 top-full z-20 mt-1 flex w-72 flex-col border border-[var(--r-line,#d8d4cc)] bg-[var(--r-ground,#fff)] py-1 shadow-sm">
                  {fixtureFiles.map((f) => (
                    <button
                      key={f.relativePath}
                      type="button"
                      className={cn(
                        "flex items-baseline justify-between gap-2 px-2 py-0.5 text-left font-mono text-[11px] hover:bg-[color-mix(in_srgb,var(--r-ink-1,#1a1a1a)_6%,transparent)]",
                        f.relativePath === filePath
                          ? "text-[var(--r-ink-1,#1a1a1a)]"
                          : "text-[var(--r-ink-2,#555)]",
                      )}
                      onClick={() => openFile(f.relativePath)}
                    >
                      <span className="truncate">{f.relativePath}</span>
                      <span className="shrink-0 text-[var(--r-ink-3,#888)]">
                        {f.modifiedUtc.slice(0, 10)}
                      </span>
                    </button>
                  ))}
                </span>
              </>
            ) : null}
          </span>
        </span>

        <FactChip
          dashed
          tone="pea"
          title="Declared fixture lane — a null version token means nothing here can be written through, by construction."
        >
          fixture
        </FactChip>
        {proposedCount > 0 ? (
          <FactChip tone="pea" title="Open pea proposals — each marks its line; decide beside it.">
            {proposedCount} proposed
          </FactChip>
        ) : null}
        {stagedCount > 0 ? (
          <FactChip tone="caution" title="Approved but unsaved — save splices these into the file.">
            {stagedCount} staged
          </FactChip>
        ) : null}
        {attentionCount > 0 ? (
          <FactChip
            tone="caution"
            title="Flagged staged fields — save refuses while any remain; unstage at the mark to clear."
          >
            {attentionCount} attention
          </FactChip>
        ) : null}
        {issues.length > 0 ? (
          <FactChip
            tone="alarm"
            title="Schema validation issues from the fixture snapshot, joined onto the lines they name."
          >
            {issues.length} issue{issues.length === 1 ? "" : "s"}
          </FactChip>
        ) : null}

        <span className="min-w-0 flex-1" />

        {receipt ? (
          <span className="truncate text-[11px] text-[var(--r-ink-3,#888)]">{receipt}</span>
        ) : null}
        {parseRefusal ? (
          <span className="max-w-[22rem] truncate text-[11px] text-[var(--r-alarm,#b91c1c)]">
            {parseRefusal}
          </span>
        ) : null}

        {editing ? (
          <>
            <Verb
              label="discard"
              reason="Throw the buffer away — the file and its marks stand as they were"
              onClick={() => {
                setEditing(false);
                setParseRefusal(null);
              }}
            />
            <Verb
              label="done"
              reason="Re-parse the buffer, diff leaf pointers against what was shown, and stage each change; open proposals on touched pointers are severed"
              onClick={doneEditing}
            />
          </>
        ) : (
          <Verb
            label="edit"
            reason="Rewrite the file text directly — done stages the diff per pointer, so pea still sees every change"
            onClick={beginEdit}
          />
        )}
        <Verb
          label={stagedCount > 0 ? `save ${stagedCount}` : "save"}
          tone="commit"
          disabled={editing || !canSave}
          reason={
            editing
              ? "finish or discard the edit first"
              : stagedCount === 0
                ? "nothing staged — approve a mark or edit the file"
                : attentionCount > 0
                  ? `${attentionCount} staged field${attentionCount === 1 ? "" : "s"} flagged for attention — save refuses while any remain`
                  : `Splice ${stagedCount} staged field${stagedCount === 1 ? "" : "s"} into the file (local stub — the real lane is settings.document.save)`
          }
          onClick={save}
        />
      </div>

      {/* body: the file, full-bleed — or the editor while the buffer is open */}
      {editing ? (
        <JsonEditor
          value={draft}
          onChange={setDraft}
          className="min-h-0 flex-1 text-xs leading-5"
        />
      ) : (
        <div className="min-h-0 flex-1 overflow-auto">
          {/* Marks cannot anchor a mid-edit buffer, so the strip exists only in read mode. */}
          <div className="flex min-w-fit" style={{ minHeight: placed.height }}>
            <JsonView
              code={code}
              decorations={decorations}
              lineNumbers
              className="flex-1 !overflow-visible text-xs leading-5"
            />
            {/* the annotation strip — marks locate, these cards decide */}
            <div className="relative w-[340px] shrink-0" style={{ height: placed.height }}>
              {placed.cards.map(({ a, top }) => {
                const kind = kindOf(a);
                const field = a.field;
                const was = valueAt(parsedDisk, a.pointer);
                return (
                  <div
                    key={a.pointer}
                    className="absolute left-2 right-3 border border-[var(--r-line,#d8d4cc)] bg-[var(--r-ground,#fff)] p-2 text-xs"
                    style={{ top, borderLeft: `2px solid ${ACCENT[kind]}` }}
                  >
                    <div className="flex items-baseline gap-1.5 font-mono text-[10px] text-[var(--r-ink-3,#888)]">
                      <span>{a.line != null ? `L${a.line}` : "not in file"}</span>
                      <span className="truncate text-[var(--r-ink-2,#555)]">{a.pointer}</span>
                    </div>

                    {kind === "proposed" && field?.proposal != null ? (
                      <>
                        <div className="mt-0.5 truncate">
                          <span className="text-[var(--r-pea,#3f7d4e)]">pea proposes </span>
                          <span className="font-mono font-medium text-[var(--r-ink-1,#1a1a1a)]">
                            {field.proposal.delete === true
                              ? "delete"
                              : display(field.proposal.value)}
                          </span>
                        </div>
                        <div className="truncate text-[11px] text-[var(--r-ink-3,#888)]">
                          was <span className="font-mono">{display(was)}</span>
                        </div>
                        {field.proposal.note || field.proposal.confidence ? (
                          <div className="mt-0.5 text-[11px] italic leading-4 text-[var(--r-ink-3,#888)]">
                            {[field.proposal.confidence, field.proposal.note]
                              .filter(Boolean)
                              .join(" · ")}
                          </div>
                        ) : null}
                        <div className="mt-1 flex gap-1">
                          <Verb
                            label="approve"
                            reason="Stage pea's value — unsaved until the save verb splices it in"
                            onClick={() => approve(a.pointer, field)}
                          />
                          <Verb
                            label="deny"
                            reason="Clear the proposal — the file's value stands"
                            onClick={() => deny(a.pointer, field)}
                          />
                        </div>
                      </>
                    ) : null}

                    {(kind === "staged" || kind === "attention") && field?.staged != null ? (
                      <>
                        <div className="mt-0.5 truncate">
                          <span className="text-[var(--r-caution,#b45309)]">staged </span>
                          <span className="font-mono font-medium text-[var(--r-ink-1,#1a1a1a)]">
                            {field.staged.delete === true ? "delete" : display(field.staged.value)}
                          </span>
                        </div>
                        <div className="truncate text-[11px] text-[var(--r-ink-3,#888)]">
                          was <span className="font-mono">{display(was)}</span>
                        </div>
                        {a.issues.map((issue, i) => (
                          <div
                            key={i}
                            className="mt-0.5 text-[11px] leading-4 text-[var(--r-alarm,#b91c1c)]"
                          >
                            {issue.message}
                          </div>
                        ))}
                        <div className="mt-1 flex gap-1">
                          <Verb
                            label="unstage"
                            reason={
                              kind === "attention"
                                ? "Withdraw the flagged value — clears the attention gate on save"
                                : "Withdraw the staged value — the file's value stands"
                            }
                            onClick={() => unstage(a.pointer, field)}
                          />
                        </div>
                      </>
                    ) : null}

                    {kind === "issue"
                      ? a.issues.map((issue, i) => (
                          <div
                            key={i}
                            className="mt-0.5 text-[11px] leading-4 text-[var(--r-alarm,#b91c1c)]"
                          >
                            {issue.message}
                          </div>
                        ))
                      : null}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
