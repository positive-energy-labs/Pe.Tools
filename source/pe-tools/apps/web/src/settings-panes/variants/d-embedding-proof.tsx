/**
 * PROTOTYPE — settings-panes round 1, VARIANT D: "the embedding proof" (throwaway;
 * see docs/features/settings/PRODUCT.md).
 *
 * The claim under test is the product claim itself: settings is a kit of
 * EASILY-WIRED pane components, not a page. So this page is two different mock
 * host routes side by side, each embedding the kit, and the real deliverable is
 * the minimum prop contract that survives both consumers (§6: one consumer does
 * not validate an API; the second consumer is the evidence). See THE PROP
 * CONTRACT comment at the bottom of this file.
 *
 * LEFT  host — "/family-ish": a cramped ~380px right rail embedding
 *              SettingsFormPane over the fixture document (approve/deny/unstage
 *              against local state).
 * RIGHT host — "/schedule-manager-ish": CmdScheduleManager's browse → preview →
 *              act loop as a web pane (SettingsTreePane → SettingsJsonPane →
 *              verb row; create/open stubbed, gaps recorded at the call sites).
 *
 * The mock host chrome (dashed borders, MOCK HOST headers) is deliberately plain
 * so nobody mistakes the hosts themselves for designs under review.
 */
import { useMemo, useState } from "react";
import { Check, ExternalLink, RotateCcw, TableProperties, X } from "lucide-react";

import {
  type SettingsFieldState,
  type SettingsRouteDocument,
  settingsFieldPointer,
  settingsFieldSegments,
} from "@pe/agent-contracts";
import type { SettingsFileEntry } from "@pe/host-contracts/operation-types";

import { fixtureDocument, fixtureFiles, fixtureRawFor } from "#/settings-panes/fixture";
import { JsonView } from "#/settings-panes/json-editor";

/* ════════════════════════════════════════════════════════════════════════════
   THE KIT — sketches of the future public pane components. Every prop below is
   earned by one of the two hosts on this page; nothing speculative survives
   (§6: prefer a specific affordance over a designed-but-unused slot).
   ════════════════════════════════════════════════════════════════════════════ */

/** Generated-form pane: renders the trichotomy field rows for one document.
 * The HOST owns the fields state (that is what makes it easily-wired — the pane
 * has no store, no route-state, no host queries); it hands the pane a document
 * and receives verb intents back, pointer-keyed. */
function SettingsFormPane({
  document,
  onApprove,
  onDeny,
  onUnstage,
}: {
  document: SettingsRouteDocument;
  /** Stage the proposal's value on this pointer (forced by the family host's approve verb). */
  onApprove: (pointer: string, value: unknown) => void;
  /** Discard the open proposal on this pointer. */
  onDeny: (pointer: string) => void;
  /** Un-stage a previously approved value. */
  onUnstage: (pointer: string) => void;
}) {
  const rows = useMemo(() => buildFieldRows(document), [document]);
  return (
    <div className="divide-y divide-[var(--line-soft)]">
      {rows.map((row) => {
        const field = row.field;
        const staged = field?.staged != null;
        const proposal = !staged ? field?.proposal : undefined;
        const attention = field?.review === "attention";
        return (
          <div key={row.path} className="flex items-center gap-2 px-2.5 py-1.5">
            <div className="min-w-0 flex-1">
              <div className="truncate font-mono text-[11px] font-medium text-[var(--clay-ink)]">
                {row.path}
              </div>
              <div className="truncate text-[11px] text-[var(--slate)]">
                {display(row.current)}
                {staged ? (
                  <>
                    {" "}
                    <span className={attention ? "text-[var(--fail)]" : "text-[var(--cat-green)]"}>
                      → {display(field?.staged?.value)}
                    </span>
                  </>
                ) : proposal ? (
                  <>
                    {" "}
                    <span className="text-[var(--pe-blue)]">→ pea: {display(proposal.value)}</span>
                  </>
                ) : null}
              </div>
              {proposal?.note ? (
                <div className="truncate text-[10px] text-[var(--lichen)]">
                  {[proposal.confidence, proposal.note].filter(Boolean).join(" · ")}
                </div>
              ) : null}
            </div>
            {staged ? (
              <Verb title="Undo approval" onClick={() => onUnstage(row.path)}>
                <RotateCcw className="size-3" />
              </Verb>
            ) : proposal ? (
              <div className="flex shrink-0 gap-1">
                <Verb title="Deny suggestion" onClick={() => onDeny(row.path)}>
                  <X className="size-3" />
                </Verb>
                <Verb
                  title="Approve and stage"
                  tone="primary"
                  onClick={() => onApprove(row.path, proposal.value)}
                >
                  <Check className="size-3" />
                </Verb>
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

/** Raw-JSON pane: the shared highlight primitive behind one prop. Read-only —
 * neither host on this page edits raw text, so the prescribed `onChange?` slot
 * is NOT here: no consumer below earned it (§6 forbids designed-but-unused
 * slots; see THE PROP CONTRACT). Variants A/B are the callers that would earn
 * it back, presence-based: `onChange` present ⇒ editable overlay. */
function SettingsJsonPane({ rawContent, className }: { rawContent: string; className?: string }) {
  return <JsonView code={rawContent} className={className} />;
}

/** Settings file tree: directory-grouped listing over the host's file entries.
 * Selection lives in the HOST (it is the host's browse state — the tree is just
 * the rendering + intent surface). */
function SettingsTreePane({
  files,
  selected,
  onOpen,
}: {
  files: SettingsFileEntry[];
  /** relativePath of the open file, or null. */
  selected: string | null;
  onOpen: (relativePath: string) => void;
}) {
  const groups = useMemo(() => {
    const byDir = new Map<string, SettingsFileEntry[]>();
    for (const entry of files) {
      const dir = entry.directory ?? "";
      const bucket = byDir.get(dir) ?? [];
      bucket.push(entry);
      byDir.set(dir, bucket);
    }
    return [...byDir.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [files]);

  return (
    <div className="flex flex-col gap-2 py-1">
      {groups.map(([dir, entries]) => (
        <div key={dir || "(root)"}>
          <div className="tele-label px-2.5 py-1 text-[var(--lichen)]">{dir || "(root)"}</div>
          {entries.map((entry) => {
            const active = entry.relativePath === selected;
            return (
              <button
                key={entry.relativePath}
                type="button"
                onClick={() => onOpen(entry.relativePath)}
                className={`block w-full truncate px-2.5 py-1 text-left text-xs ${
                  active
                    ? "bg-[var(--pea-tint)] font-medium text-[var(--clay-ink)]"
                    : "text-[var(--slate)] hover:bg-[var(--paper-2)]"
                }`}
              >
                {entry.name}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════════
   THE PAGE — two mock hosts, one visible seam.
   ════════════════════════════════════════════════════════════════════════════ */

export function VariantD() {
  return (
    <div className="flex h-dvh flex-col bg-[var(--paper)]">
      <div className="shrink-0 border-b border-[var(--line-2)] px-5 py-2">
        <span className="text-sm font-medium text-[var(--ink)]">
          Variant D — the embedding proof
        </span>
        <span className="ml-3 text-xs text-[var(--slate)]">
          two mock hosts embed the same kit; the deliverable is the prop contract that survives both
        </span>
      </div>
      <div className="flex min-h-0 flex-1 gap-4 p-4">
        <FamilyIshHost />
        {/* the seam — deliberately visible so the two consumers read as separate routes */}
        <div className="w-px shrink-0 bg-[var(--line-2)]" />
        <ScheduleManagerIshHost />
      </div>
    </div>
  );
}

/* ── LEFT host: "/family-ish" — the kit inside a cramped right rail ────────── */

function FamilyIshHost() {
  // The host owns the trichotomy state — the pane is stateless by contract.
  const [fields, setFields] = useState<Record<string, SettingsFieldState>>(fixtureDocument.fields);
  const document = useMemo<SettingsRouteDocument>(() => ({ ...fixtureDocument, fields }), [fields]);

  const patch = (pointer: string, next: Partial<SettingsFieldState>) =>
    setFields((prev) => {
      const base = prev[pointer] ?? { proposal: null, staged: null, review: "none" as const };
      return { ...prev, [pointer]: { ...base, ...next } };
    });

  const stagedCount = Object.values(fields).filter((f) => f.staged != null).length;

  return (
    <MockHost label="MOCK HOST — /family (right rail)" className="w-[380px] shrink-0">
      {/* mock family header — obviously-mock stand-in for the /family page head */}
      <div className="border-b border-[var(--line)] px-3 py-2">
        <div className="text-sm font-medium text-[var(--ink)]">VAV Box — Parallel Fan Powered</div>
        <div className="tele text-[var(--slate)]">Mechanical Equipment · 4 types · rfa loaded</div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex shrink-0 items-center justify-between px-3 py-1.5">
          <span className="section-label">schedule profile</span>
          <FactChip />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto border-t border-[var(--line-soft)]">
          <SettingsFormPane
            document={document}
            onApprove={(pointer, value) => patch(pointer, { staged: { value }, review: "good" })}
            onDeny={(pointer) => patch(pointer, { proposal: null, review: "none" })}
            onUnstage={(pointer) => patch(pointer, { staged: null, review: "none" })}
          />
        </div>
        <div className="shrink-0 border-t border-[var(--line)] px-3 py-1.5">
          {/* the save gate stays HOST logic — the host owns fields, so it can compute
              this itself; the kit needed no metrics/save props. */}
          <span className="tele text-[var(--slate)]">
            {stagedCount} staged
            {Object.values(fields).some((f) => f.review === "attention")
              ? " · attention blocks save"
              : ""}
          </span>
        </div>
      </div>
    </MockHost>
  );
}

/* ── RIGHT host: "/schedule-manager-ish" — browse → preview → act ──────────── */

function ScheduleManagerIshHost() {
  // Browse state (selection) is host state; the tree pane only renders it.
  const [selected, setSelected] = useState<string | null>("mechanical/vav-boxes.json");
  const verb = useVerb();

  const entry = fixtureFiles.find((f) => f.relativePath === selected) ?? null;
  const rawContent = selected ? fixtureRawFor(selected) : null;
  // Only the fixture's open document carries seeded validation; other tree files
  // are presumed valid — the create gate mirrors CmdScheduleManager's
  // CanExecute = PreviewData.IsValid.
  const validation =
    selected === fixtureDocument.snapshot?.documentId.relativePath
      ? (fixtureDocument.snapshot?.validation ?? null)
      : null;
  const createBlocked = validation != null && !validation.isValid;

  return (
    <MockHost label="MOCK HOST — /schedule-manager (web pane)" className="min-w-0 flex-1">
      <div className="flex items-center justify-between border-b border-[var(--line)] px-3 py-2">
        <div>
          <div className="text-sm font-medium text-[var(--ink)]">Schedule Manager</div>
          <div className="tele text-[var(--slate)]">pe.schedules · profiles · create tab</div>
        </div>
        <FactChip />
      </div>
      <div className="flex min-h-0 flex-1">
        <div className="w-[200px] shrink-0 overflow-y-auto border-r border-[var(--line)]">
          <SettingsTreePane files={fixtureFiles} selected={selected} onOpen={setSelected} />
        </div>
        <div className="flex min-w-0 flex-1 flex-col">
          {entry && rawContent != null ? (
            <>
              <div className="shrink-0 border-b border-[var(--line-soft)] px-3 py-1.5">
                <span className="font-mono text-xs font-medium text-[var(--clay-ink)]">
                  {entry.relativePath}
                </span>
                <span className="tele ml-2 text-[var(--slate)]">
                  modified {entry.modifiedUtc.slice(0, 10)}
                </span>
                {createBlocked ? (
                  <div className="mt-0.5 text-[11px] text-[var(--fail)]">
                    {validation?.issues[0]?.message}
                  </div>
                ) : null}
              </div>
              <SettingsJsonPane
                rawContent={rawContent}
                className="min-h-0 flex-1 border-b border-[var(--line-soft)] text-xs"
              />
              <div className="flex shrink-0 items-center gap-2 px-3 py-2">
                <Verb
                  tone="primary"
                  disabled={createBlocked}
                  title={
                    createBlocked ? "profile has validation errors" : "Create the schedule in Revit"
                  }
                  onClick={() =>
                    // GAP: no web lane for revit.apply.schedule. The desktop verb
                    // (CmdScheduleManager.HandleCreateSingle) runs
                    // Doc.ApplyScheduleProfile inside a Revit transaction; the web
                    // host needs a typed host op + route-state command
                    // (revit.apply.schedule) before this is real. Stubbed to local
                    // state only.
                    verb.run(`created schedule from ${entry.name} (stub — local state only)`)
                  }
                >
                  <TableProperties className="size-3" /> create schedule
                </Verb>
                <Verb
                  title="Open the JSON file"
                  onClick={() =>
                    // GAP: desktop HandleOpenFile shells to the OS default app; the
                    // web host has no "open local file" lane — likely resolves to
                    // routing into the /settings raw utility instead. Stubbed.
                    verb.run(`would open ${entry.path} (stub — no web open-file lane)`)
                  }
                >
                  <ExternalLink className="size-3" /> open file
                </Verb>
                {verb.last ? (
                  <span className="tele truncate text-[var(--lichen)]">{verb.last}</span>
                ) : null}
              </div>
            </>
          ) : (
            <div className="p-4 text-xs text-[var(--lichen)]">Select a profile to preview.</div>
          )}
        </div>
      </div>
    </MockHost>
  );
}

/* ── mock chrome + lang bits (page-local; die with the round) ──────────────── */

/** Dashed, plainly-labelled wrapper so the hosts read as scaffolding, not design. */
function MockHost({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={`flex min-h-0 flex-col ${className ?? ""}`}>
      <div className="tele-label shrink-0 border-2 border-b-0 border-dashed border-[var(--line-2)] bg-[var(--paper-2)] px-3 py-1 text-[var(--slate)]">
        {label}
      </div>
      <div className="flex min-h-0 flex-1 flex-col border-2 border-dashed border-[var(--line-2)] bg-[var(--paper)]">
        {children}
      </div>
    </div>
  );
}

/** Both hosts announce the shared inert fixture (declared-fixture lane). */
function FactChip() {
  return (
    <span className="tele-label rounded-[2px] border border-[var(--cat-clay)]/40 bg-[var(--clay-tint)] px-1.5 py-0.5 text-[var(--clay-ink)]">
      fixture · inert
    </span>
  );
}

/** Plain lang button — no #/components/ui/button in the panes round. */
function Verb({
  tone = "quiet",
  disabled,
  title,
  onClick,
  children,
}: {
  tone?: "quiet" | "primary";
  disabled?: boolean;
  title?: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-[2px] px-2 py-1 text-xs disabled:cursor-not-allowed disabled:opacity-45 ${
        tone === "primary"
          ? "bg-[var(--cat-green)] text-white hover:bg-[var(--cat-green)]/85"
          : "border border-[var(--line-2)] text-[var(--slate)] hover:bg-[var(--paper-2)]"
      }`}
    >
      {children}
    </button>
  );
}

/** Minimal verb log against local state — the stubbed verbs still "work". */
function useVerb() {
  const [last, setLast] = useState<string | null>(null);
  return { last, run: (outcome: string) => setLast(outcome) };
}

/* ── field-row derivation (copied from the shipping route; prototype-local) ── */

interface FieldRow {
  path: string;
  current: unknown;
  field?: SettingsFieldState;
}

function buildFieldRows(document: SettingsRouteDocument): FieldRow[] {
  const parsed = safeParse(document.snapshot?.rawContent);
  const leafPaths = parsed ? flattenLeafPaths(parsed) : [];
  const paths = new Set<string>([...leafPaths, ...Object.keys(document.fields)]);
  return [...paths]
    .sort((a, b) => a.localeCompare(b))
    .map((path) => ({
      path,
      current: parsed ? valueAtPath(parsed, settingsFieldSegments(path)) : undefined,
      field: document.fields[path],
    }));
}

function safeParse(rawContent: string | null | undefined): Record<string, unknown> | null {
  if (!rawContent?.trim()) return null;
  try {
    const parsed = JSON.parse(rawContent);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

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

function display(value: unknown): string {
  if (value === undefined) return "—";
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

/* ════════════════════════════════════════════════════════════════════════════
   THE PROP CONTRACT — the variant's deliverable.

   What the kit's minimum props turned out to be, and which consumer forced
   each into existence:

   SettingsFormPane
     document: SettingsRouteDocument      — family host (the whole render input:
                                            snapshot rawContent for current
                                            values + pointer-keyed fields; one
                                            prop keeps the pane chat-plugin
                                            compatible, since SSE proposals land
                                            in exactly this shape)
     onApprove(pointer, value)            — family host approve verb
     onDeny(pointer)                      — family host deny verb
     onUnstage(pointer)                   — family host undo verb
     NOT needed: any store/route-state/host-query wiring, save/validate verbs,
     metric props. The host owns the fields state, so save gating and counts are
     host arithmetic — the kit stays stateless and therefore easily-wired.

   SettingsJsonPane
     rawContent: string                   — schedule host preview
     className?: string                   — both layouts (the embed must size it)
     onChange? was PRESCRIBED for this variant but NO consumer on this page
     earned it — both embeds are read-only. Per §6 (no designed-but-unused
     slots) it is omitted; variants A/B's raw-edit write models are the callers
     that would earn it back, presence-based (`onChange` present ⇒ editable
     textarea overlay, absent ⇒ JsonView).

   SettingsTreePane
     files: SettingsFileEntry[]           — schedule host (host-contract entries
                                            straight through; directory grouping
                                            is derived inside, no extra props)
     selected: string | null              — schedule host (selection is HOST
                                            browse state; the pane renders it)
     onOpen(relativePath)                 — schedule host browse verb

   The finding: the contract that survives both consumers is "one document/list
   in, pointer-or-path-keyed intents out, zero owned state." The cramped 380px
   embed forced nothing extra (rows already truncate); the second consumer's
   real pressure was on WHO owns state, not on more props. Verbs beyond the
   trichotomy (create schedule, open file) stayed host-owned — the kit never
   grew an "actions" slot.
   ════════════════════════════════════════════════════════════════════════════ */
