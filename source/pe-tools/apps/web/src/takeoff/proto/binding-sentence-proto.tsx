/**
 * PROTOTYPE — targeting-grammar round 1 (2026-08-19 rulings, design-system ledger).
 *
 * Question: do FOUR directional clauses (subject · reads · writes · syncs · world) stay
 * readable at head-rail width? Three structurally different renderings of the SAME
 * `ProtoBinding[]` manifest, mounted on the live /takeoffs route via `?proto=head&variant=a|b|c`:
 *
 *   a — ONE SENTENCE: joiner grammar (editing/from/into/syncing/in) + mono glyph prefixes.
 *       The 2026-08-19 ruling; the thing under proof.
 *   b — READS/WRITES CLAUSES: explicit `reads:` / `writes:` groups. The rejected alternate,
 *       built so the ruling is tested against eyes, not argument.
 *   c — SUBJECT + CONNECTION STRIP: short sentence, everything else as glyph chips below.
 *       The scale hedge if a fails at four clauses.
 *
 * READ-ONLY: every pick lands in proto-local state; no host call, no route mutation.
 * Slot/popover idiom copied from components/sentence.tsx so the canon look is audited free.
 * Throwaway — this file dies at round close (prototype skill rules).
 */
import { useEffect, useRef, useState } from "react";

import { AddressingBar } from "#/components/lang/addressing-bar";
import { VariantSwitcher } from "#/param-tables/proto/switcher";
import { sessionLabel, type SessionFacts, type TargetResolution } from "#/host/target";
import type { ViewFacts } from "#/takeoff/model";
import type { World } from "#/takeoff/world";

// ── The manifest — what the canon Binding[] type would carry ────────────────

type ProtoDirection = "subject" | "reads" | "writes" | "syncs" | "context";

interface ProtoOption {
  id: string;
  label: string;
  sub?: string;
}

interface ProtoBinding {
  key: string;
  direction: ProtoDirection;
  /** Joiner grammar (ruled 2026-08-19): editing · from/against · into/to · syncing · in. */
  joiner: string;
  noun: string | null;
  placeholder: string;
  /** Legal-options law: null = no picker exists yet (an honest gap, not a free field). */
  options: ProtoOption[] | null;
  /** Where options come from, shown when the picker is empty or absent. */
  empty: string;
}

/** Direction glyphs (ruled): ← reads · → writes · ⇄ syncs. Subject/context carry none. */
const GLYPH: Record<ProtoDirection, string | null> = {
  subject: null,
  reads: "←",
  writes: "→",
  syncs: "⇄",
  context: null,
};

function baseName(path: string): string {
  const ix = Math.max(path.lastIndexOf("\\"), path.lastIndexOf("/"));
  return ix >= 0 ? path.slice(ix + 1) : path;
}

/** Build takeoffs' worst-case manifest from the route's REAL state. */
function buildManifest(args: {
  world: World;
  views: ViewFacts[];
  r10Path: string;
  resolution: TargetResolution;
  sessions: SessionFacts[];
  picked: Record<string, string | null>;
}): ProtoBinding[] {
  const { world, views, r10Path, resolution, sessions, picked } = args;
  const zoningViews = views.filter((v) => v.regions > 0);
  return [
    {
      key: "doc",
      direction: "subject",
      joiner: "editing",
      noun: world.docName && world.docName !== "no target" ? world.docName : null,
      placeholder: "no document",
      options: null,
      empty: "the document arrives with the bound world's model read",
    },
    {
      key: "view",
      direction: "reads",
      joiner: "from",
      noun: picked.view ?? zoningViews[0]?.name ?? null,
      placeholder: "pick a zoning plan",
      options: views.map((v) => ({
        id: v.name,
        label: v.name,
        sub: `${v.level || "no level"} · ${v.regions} region${v.regions === 1 ? "" : "s"}`,
      })),
      empty: "views come from the bound model — connect a world to list them",
    },
    {
      key: "zone",
      direction: "writes",
      joiner: "into",
      noun: picked.zone ?? (world.zones.length > 0 ? `${world.zones.length} zones` : null),
      placeholder: "no adopted zones",
      options: world.zones.map((z) => ({
        id: z.zone.guid,
        label: z.name,
        sub: `${z.rooms.length} rooms · ${z.stage}`,
      })),
      empty: "zones come from adoption — stamp designer regions in the zoning plan first",
    },
    {
      key: "r10",
      direction: "syncs",
      joiner: "syncing",
      noun: picked.r10 ?? (r10Path ? baseName(r10Path) : null),
      placeholder: "pick a .r10",
      // PROTO GAP (legal-options law): canon has no host op listing .r10 files — today this
      // is a raw typed path in the sync panel. The picker exists here to show the target shape.
      options: null,
      empty: "needs a host op listing .r10 files near the model — today a typed path (gap)",
    },
    {
      key: "world",
      direction: "context",
      joiner: "in",
      noun:
        resolution.kind === "resolved" ? sessionLabel(resolution.session) : (picked.world ?? null),
      placeholder: sessions.length === 0 ? "no live world" : "pick a world",
      options: sessions.map((s) => ({
        id: s.sessionId,
        label: sessionLabel(s),
        sub: `pid ${s.processId}`,
      })),
      empty: "no live worlds — start one from /instances",
    },
  ];
}

// ── Shared slot + popover idiom (copied from components/sentence.tsx) ───────

function ProtoSlot({
  binding,
  open,
  onToggle,
  glyph,
}: {
  binding: ProtoBinding;
  open: boolean;
  onToggle: () => void;
  glyph?: boolean;
}) {
  const g = glyph ? GLYPH[binding.direction] : null;
  const bound = binding.noun != null;
  return (
    <button
      type="button"
      title={binding.empty}
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      className="face-mono t-label"
      style={{
        padding: 0,
        cursor: "pointer",
        background: open ? "var(--r-select)" : "transparent",
        border: "none",
        borderBottom: `0.5px solid ${bound ? "var(--r-ink)" : "var(--r-caution)"}`,
        borderRadius: 0,
        color: bound ? "var(--r-ink)" : "var(--r-caution)",
        whiteSpace: "nowrap",
      }}
    >
      {g ? <span style={{ color: "var(--r-ink-2)" }}>{g} </span> : null}
      {binding.noun ?? binding.placeholder}
    </button>
  );
}

function Joiner({ children }: { children: React.ReactNode }) {
  return (
    <span className="face-mono t-label" style={{ color: "var(--r-ink-2)", whiteSpace: "nowrap" }}>
      {children}
    </span>
  );
}

function ProtoPopover({
  binding,
  onPick,
}: {
  binding: ProtoBinding;
  onPick: (id: string, label: string) => void;
}) {
  const [query, setQuery] = useState("");
  const options = binding.options ?? [];
  const shown = options.filter((o) => o.label.toLowerCase().includes(query.toLowerCase()));
  return (
    <div
      className="absolute left-0 top-full z-40 mt-1 max-h-72 w-80 overflow-y-auto px-2 py-1"
      style={{
        border: "0.5px solid var(--r-line-2)",
        background: "var(--r-page)",
        borderRadius: 2,
        boxShadow: "0 2px 8px color-mix(in srgb, var(--r-ink) 8%, transparent)",
      }}
    >
      <div className="t-caption t-upper pb-0.5" style={{ color: "var(--r-ink-2)" }}>
        {binding.direction} — {binding.joiner} {binding.placeholder}
      </div>
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={`filter ${binding.key}s`}
        className="face-mono t-caption mt-1 w-full px-1.5 py-0.5"
        style={{
          borderRadius: 2,
          border: "0.5px solid var(--r-line-2)",
          background: "transparent",
          color: "var(--r-ink)",
          outline: "none",
        }}
      />
      {shown.map((o) => (
        <div
          key={o.id}
          className="py-1"
          style={{ cursor: "pointer", borderTop: "0.5px solid var(--r-line)" }}
          onClick={() => onPick(o.id, o.label)}
        >
          <span className="face-mono t-caption" style={{ color: "var(--r-ink)" }}>
            {o.label}
          </span>{" "}
          {o.sub ? (
            <span className="face-mono t-caption" style={{ color: "var(--r-ink-2)" }}>
              {o.sub}
            </span>
          ) : null}
        </div>
      ))}
      {shown.length === 0 ? (
        <div className="face-mono t-caption py-1" style={{ color: "var(--r-ink-2)" }}>
          {binding.empty}
        </div>
      ) : null}
    </div>
  );
}

// ── Variant A — one sentence, joiner grammar + glyphs (the ruling) ──────────

function SentenceA({ bindings, openSlot, toggle, onPick }: VariantProps) {
  return (
    <div className="relative inline-block min-w-0 flex-1 basis-72">
      <div
        className="flex h-7 items-center overflow-hidden px-2"
        style={{ border: "0.5px solid var(--r-line-2)", borderRadius: 2 }}
      >
        <span className="flex items-baseline gap-1 truncate" style={{ whiteSpace: "nowrap" }}>
          {bindings.map((b) => (
            <span
              key={b.key}
              className="flex items-baseline gap-1"
              style={{ whiteSpace: "nowrap" }}
            >
              <Joiner>{b.joiner}</Joiner>
              <ProtoSlot
                binding={b}
                glyph
                open={openSlot === b.key}
                onToggle={() => toggle(b.key)}
              />
            </span>
          ))}
        </span>
      </div>
      {bindings.map((b) =>
        openSlot === b.key ? (
          <ProtoPopover key={b.key} binding={b} onPick={(id, l) => onPick(b.key, id, l)} />
        ) : null,
      )}
    </div>
  );
}

// ── Variant B — reads:/writes: clauses (the rejected alternate) ─────────────

function SentenceB({ bindings, openSlot, toggle, onPick }: VariantProps) {
  const by = (d: ProtoDirection) => bindings.filter((b) => b.direction === d);
  const group = (label: string, items: ProtoBinding[]) =>
    items.length === 0 ? null : (
      <span className="flex items-baseline gap-1" style={{ whiteSpace: "nowrap" }}>
        <Joiner>{label}</Joiner>
        {items.map((b) => (
          <ProtoSlot
            key={b.key}
            binding={b}
            open={openSlot === b.key}
            onToggle={() => toggle(b.key)}
          />
        ))}
      </span>
    );
  return (
    <div className="relative inline-block min-w-0 flex-1 basis-72">
      <div
        className="flex h-7 items-center gap-2 overflow-hidden px-2"
        style={{ border: "0.5px solid var(--r-line-2)", borderRadius: 2 }}
      >
        {group("editing", by("subject"))}
        {group("· reads:", by("reads"))}
        {group("· writes:", [...by("writes"), ...by("syncs")])}
        {group("· syncs:", [])}
        {group("· in", by("context"))}
      </div>
      {bindings.map((b) =>
        openSlot === b.key ? (
          <ProtoPopover key={b.key} binding={b} onPick={(id, l) => onPick(b.key, id, l)} />
        ) : null,
      )}
    </div>
  );
}

// ── Variant C — subject-only sentence + connection strip below ──────────────

function SentenceC({ bindings, openSlot, toggle, onPick }: VariantProps) {
  const inline = bindings.filter((b) => b.direction === "subject" || b.direction === "context");
  const strip = bindings.filter((b) => b.direction !== "subject" && b.direction !== "context");
  return (
    <div className="relative inline-block min-w-0 flex-1 basis-72">
      <div
        className="flex h-7 items-center overflow-hidden px-2"
        style={{ border: "0.5px solid var(--r-line-2)", borderRadius: 2 }}
      >
        <span className="flex items-baseline gap-1 truncate" style={{ whiteSpace: "nowrap" }}>
          {inline.map((b) => (
            <span
              key={b.key}
              className="flex items-baseline gap-1"
              style={{ whiteSpace: "nowrap" }}
            >
              <Joiner>{b.joiner}</Joiner>
              <ProtoSlot binding={b} open={openSlot === b.key} onToggle={() => toggle(b.key)} />
            </span>
          ))}
        </span>
      </div>
      <div className="mt-1 flex items-center gap-1.5">
        {strip.map((b) => (
          <span
            key={b.key}
            className="flex items-baseline gap-1 px-1.5"
            style={{ border: "0.5px solid var(--r-line-2)", borderRadius: 2 }}
          >
            <ProtoSlot binding={b} glyph open={openSlot === b.key} onToggle={() => toggle(b.key)} />
          </span>
        ))}
      </div>
      {bindings.map((b) =>
        openSlot === b.key ? (
          <ProtoPopover key={b.key} binding={b} onPick={(id, l) => onPick(b.key, id, l)} />
        ) : null,
      )}
    </div>
  );
}

interface VariantProps {
  bindings: ProtoBinding[];
  openSlot: string | null;
  toggle: (key: string) => void;
  onPick: (key: string, id: string, label: string) => void;
}

// ── The mount — real AddressingBar, real route state, proto-local picks ─────

const VARIANTS = [
  { key: "a", name: "one sentence · joiners + glyphs" },
  { key: "b", name: "reads:/writes: clauses" },
  { key: "c", name: "subject + connection strip" },
];

export function BindingHeadProto({
  variant,
  onVariant,
  world,
  views,
  r10Path,
  resolution,
  sessions,
}: {
  variant: string;
  onVariant: (key: string) => void;
  world: World;
  views: ViewFacts[];
  r10Path: string;
  resolution: TargetResolution;
  sessions: SessionFacts[];
}) {
  const [picked, setPicked] = useState<Record<string, string | null>>({});
  const [openSlot, setOpenSlot] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!openSlot) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpenSlot(null);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [openSlot]);

  const bindings = buildManifest({ world, views, r10Path, resolution, sessions, picked });
  const toggle = (key: string) => setOpenSlot(openSlot === key ? null : key);
  const onPick = (key: string, _id: string, label: string) => {
    setPicked((prev) => ({ ...prev, [key]: label }));
    setOpenSlot(null);
  };
  const props: VariantProps = { bindings, openSlot, toggle, onPick };

  return (
    <div
      ref={rootRef}
      className="relative z-40 px-2 pt-2 pb-1"
      style={{ background: "var(--r-page)", borderBottom: "0.5px solid var(--r-line-2)" }}
    >
      <AddressingBar
        name="takeoffs"
        sentence={
          variant === "b" ? (
            <SentenceB {...props} />
          ) : variant === "c" ? (
            <SentenceC {...props} />
          ) : (
            <SentenceA {...props} />
          )
        }
        seam={
          <span className="face-mono t-caption" style={{ color: "var(--r-ink-2)" }}>
            proto · picks are local, nothing writes
          </span>
        }
      />
      <VariantSwitcher variants={VARIANTS} current={variant} onSelect={onVariant} />
    </div>
  );
}
