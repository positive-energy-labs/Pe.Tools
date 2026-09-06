import { Fragment, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  address,
  addressSchema,
  emptyScope,
  resolveScope,
  scopeDocument,
  scopePin,
  type Address,
  type FleetSession,
  type Scope,
} from "@pe/agent-contracts";

import { useThreadScope } from "#/chat/scope";
import { Press } from "#/components/lang/press";
import { useFleet } from "#/host/fleet";
import { documentAddress, type SessionFacts } from "#/host/target";
import { token } from "#/lib/token";
import type { Feed } from "#/state/route-store";
import { Picker, useBindings, type BindingPatch, type BindingState } from "#/targeting/kit";
import { product, type Link } from "#/targeting/model";
import { selectToolCalls, type ChatState } from "#/workbench/chat-state";
import { useWorkbench } from "#/workbench/provider";

/**
 * THE one place the user sees and changes the thread's Scope: the composer's to-line
 * (protoui rounds 3-4, kaitpw 2026-09-06: the Scope belongs on the composer, in the targeting
 * kit's sentence). `to [document] in [Revit]`; the Revit slot is drawn only when the user has to
 * choose (two holders) or already chose (a pin). The `r<n>` press opens the readout: what was
 * chosen, what the fleet resolved, and what the last call ran against, so drift is legible.
 */

/** A connected session as the fleet reports it, plus the title of its active document. */
export interface ScopeSession extends FleetSession {
  documentLabel: string | null;
}

/** A document the user can pick: open in zero, one, or several sessions. */
export interface ScopeDocument {
  document: Address;
  label: string;
  /** The Revit year that saved the file: the holder's year, or the header year of a recent. */
  year: number | null;
  /** Session ids holding it now; empty for a recent document nobody has open. */
  holders: string[];
}

/** What the last pe_do / pe_read in the thread said it ran against. */
export interface Ran {
  key: string;
  ok: boolean;
  revision: number;
  session: string | null;
  document: string | null;
}

export interface ScopeLineProps {
  scope: Scope;
  revision: number;
  sessions: readonly ScopeSession[];
  documents: readonly ScopeDocument[];
  /** pea is mid-turn: the line shows but refuses changes; the turn keeps its admitted Scope. */
  busy: boolean;
  refusal?: string | null;
  ran: Ran | null;
  /** Fleet freshness, so the pickers report stale instead of fresh forever. */
  stale: boolean;
  at?: number;
  onSet: (next: Scope) => void;
}

export function scopeSessions(sessions: readonly SessionFacts[]): ScopeSession[] {
  // An observed Revit (the user's own, no pe-revit receipt) has no SDK id; the host names it by
  // its bridge id in the same slot, so the head and the host resolve the same fleet.
  return sessions.map((session) => ({
    id: session.sdkSessionId ?? session.sessionId,
    year: Number.parseInt(session.year ?? "", 10) || null,
    document: documentAddress(session),
    documentLabel: session.activeDocumentTitle ?? null,
  }));
}

/** Documents first: every session's active document, then recents nobody has open. */
export function scopeDocuments(
  sessions: readonly ScopeSession[],
  recents: readonly { document: Address; label: string; year: number | null }[] = [],
): ScopeDocument[] {
  const byDocument = new Map<Address, ScopeDocument>();
  for (const session of sessions) {
    if (!session.document) continue;
    const entry = byDocument.get(session.document) ?? {
      document: session.document,
      label: session.documentLabel ?? session.document,
      year: session.year,
      holders: [],
    };
    entry.holders.push(session.id);
    byDocument.set(session.document, entry);
  }
  for (const recent of recents)
    if (!byDocument.has(recent.document))
      byDocument.set(recent.document, { ...recent, holders: [] });
  return [...byDocument.values()];
}

/* ── data: host Scope, live fleet, SDK recents, the last run ─────────────────────────────── */

type Recent = { document: Address; label: string; year: number | null };

/** The SDK's recent documents, the same lists /instances reads: one /doctor, then one per year. */
function useRecentDocuments(enabled: boolean) {
  return useQuery({
    queryKey: ["pe", "recents"],
    enabled,
    staleTime: 60_000,
    queryFn: async (): Promise<Recent[]> => {
      const doctor = (await (await fetch("/doctor")).json()) as {
        result?: { revitYears?: string[] };
      };
      const buckets = await Promise.all(
        (doctor.result?.revitYears ?? []).map(async (year) => {
          const body = (await (
            await fetch(`/docs/recents?year=${encodeURIComponent(year)}`)
          ).json()) as {
            result?: { recents?: { path?: string; title?: string; savedYear?: number | null }[] };
          };
          return body.result?.recents ?? [];
        }),
      );
      return buckets.flat().flatMap((recent) => {
        const parsed = addressSchema.safeParse(recent.path);
        return parsed.success
          ? [
              {
                document: parsed.data,
                label: recent.title ?? parsed.data,
                year: recent.savedYear ?? null,
              },
            ]
          : [];
      });
    },
  });
}

/** The last completed pe_do / pe_read, with the revision and target its result named. */
function lastRun(chat: ChatState): Ran | null {
  const last = selectToolCalls(chat)
    .filter(
      (call) => (call.title === "pe_do" || call.title === "pe_read") && call.status === "completed",
    )
    .at(-1);
  if (!last || last.status !== "completed") return null;
  const result = last.result as
    | {
        key?: string;
        ok?: boolean;
        revision?: number;
        target?: { session?: string | null; document?: string | null };
      }
    | undefined;
  if (!result || typeof result.revision !== "number") return null;
  return {
    key: result.key ?? String((last.args as { key?: string } | null)?.key ?? last.title),
    ok: result.ok !== false,
    revision: result.revision,
    session: result.target?.session ?? null,
    document: result.target?.document ?? null,
  };
}

/** Everything the line needs, live or from the `?scope=` fixture. */
export function useScopeLine(live: boolean | undefined, picking: boolean): ScopeLineProps {
  const { revit, currentThreadId, isRunning, chat } = useWorkbench();
  const fleet = useFleet({ enabled: revit === true });
  // Recents are read only inside the open picker: N host round-trips per chat open otherwise.
  const recents = useRecentDocuments(revit === true && live !== false && picking);
  const scope = useThreadScope(currentThreadId, live !== false);
  // ponytail: the fixture switch reads the URL directly so the line renders without a router.
  const shown =
    live === false
      ? fixtureScope(
          new URLSearchParams(window.location.search).get("scope") as FixtureScope | null,
        )
      : null;
  const sessions = shown?.sessions ?? scopeSessions(fleet.sessions);
  return {
    scope: shown?.scope ?? scope.scope,
    revision: shown?.revision ?? scope.revision,
    sessions,
    documents: shown?.documents ?? scopeDocuments(sessions, recents.data ?? []),
    busy: shown ? false : isRunning,
    refusal: scope.refusal,
    ran: lastRun(chat),
    stale: shown ? false : fleet.stale,
    at: fleet.at,
    onSet: (next) => void scope.set(next),
  };
}

/* ── the sentence: the lean Scope as a breadcrumbed Product (where › document › Revit) ────── */

type K = "where" | "document" | "session";

function useScopeBindings(
  p: ScopeLineProps,
  openSlot: string | null,
  setOpen: (key: string | null) => void,
) {
  const named = scopeDocument(p.scope);
  const fileYear = p.documents.find((d) => d.document === named)?.year ?? null;
  const r = resolveScope(p.scope, p.sessions, fileYear);
  // A session needs a human label: the year, plus the id only when two share it or it is unknown.
  const sessionLabel = (id: string) => {
    const s = p.sessions.find((x) => x.id === id);
    if (!s?.year) return id;
    return p.sessions.some((x) => x.id !== id && x.year === s.year)
      ? `Revit ${s.year} · ${id}`
      : `Revit ${s.year}`;
  };
  const documentLabel = (document: Address | null) =>
    document === null
      ? "no document"
      : (p.documents.find((d) => d.document === document)?.label ?? document);
  // Nothing chosen and one Revit up: its document is what every call will take. Drawn as reported,
  // never as chosen (house law 8); picking it makes it chosen.
  const derived = named === null && r.kind === "resolved" ? r.document : null;
  const bound = named ?? derived;

  // The two document sources are a breadcrumb level, not two runs of one long list. Open now is
  // first and is where the picker lands, so the document already up is one click deep.
  const open = p.documents.filter((d) => d.holders.length > 0);
  const recent = p.documents.filter((d) => d.holders.length === 0);
  const [whereOverride, setWhere] = useState<string | null>(null);
  const where =
    whereOverride ?? (bound && recent.some((d) => d.document === bound) ? "recent" : "open");
  const ready = { state: "ready", lane: "live", stale: p.stale, at: p.at } as const;
  const feeds: Record<K, Feed> = {
    where: {
      ...ready,
      options: [
        { id: "open", label: "open now", sub: open.length ? String(open.length) : "none" },
        { id: "recent", label: "recent", sub: recent.length ? String(recent.length) : "none" },
      ],
    },
    document: {
      ...ready,
      options: (where === "open" ? open : recent).map((d) => ({
        id: d.document,
        label: d.label,
        sub: d.holders.length
          ? d.holders.map(sessionLabel).join(", ")
          : d.year
            ? `${d.year}`
            : undefined,
      })),
    },
    // Only the holders of the chosen document can be pinned; a pin elsewhere is a no-op.
    session: {
      ...ready,
      options: (r.kind === "resolved" ? [r.session] : r.kind === "ambiguous" ? r.holders : []).map(
        (id) => ({
          id,
          label: sessionLabel(id),
          sub: scopePin(p.scope) === id ? "pinned" : undefined,
        }),
      ),
    },
  };
  const link = (
    partial: Omit<Link<K>, "multi" | "dir" | "liveness"> &
      Partial<Pick<Link<K>, "dir" | "liveness">>,
  ): Link<K> => ({ multi: false, dir: "duplex", liveness: null, ...partial });
  const manifest = product("chat", "scope", {
    where: link({
      key: "where",
      under: null,
      joiner: "",
      placeholder: "documents",
      needs: "open now or recent",
      dir: null,
    }),
    document: link({
      key: "document",
      under: "where",
      joiner: "in",
      placeholder: "a document",
      needs:
        where === "open"
          ? "a document open in a Revit — open one from /instances"
          : "a document Pea has seen before",
    }),
    session: link({
      key: "session",
      under: "document",
      joiner: "",
      placeholder: r.kind === "ambiguous" ? `${r.holders.length} Revits — pick one` : "a Revit",
      needs: "a Revit holding this document",
      liveness: "attached",
    }),
  })({ feeds, stages: [{ key: "scope", label: "scope", verbs: [] }], panes: [] });

  const state: BindingState<K> = {
    bound: {
      where,
      document: bound,
      session: scopePin(p.scope) ?? (r.kind === "resolved" ? r.session : null),
    },
    multi: {},
    stage: "scope",
  };
  // `pickInto` hands back the whole bound map, so diff it: a changed level is local; a changed
  // document is a new Scope (pin cleared); the chosen document again clears the Scope back to
  // derived; a changed session on the same document is a pin, and the pinned one again unpins.
  const setState = (patch: BindingPatch<K>) => {
    const next = patch.bound;
    if (!next) return;
    if (next.where && next.where !== where) return setWhere(next.where);
    const document = (next.document ?? null) as Address | null;
    if (document === named && document !== null && !next.session) return p.onSet({ kind: "none" });
    if (document !== named)
      return p.onSet(document ? { kind: "document", document } : { kind: "none" });
    if (next.session && named)
      p.onSet(
        next.session === scopePin(p.scope)
          ? { kind: "document", document: named }
          : { kind: "document", document: named, pin: next.session },
      );
  };
  const [level, setLevel] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const b = useBindings(
    manifest,
    state,
    setState,
    openSlot,
    setOpen,
    level,
    setLevel,
    query,
    setQuery,
  );
  return { manifest, b, r, named, derived, documentLabel, sessionLabel };
}

/* ── the readout: chose / got / ran ────────────────────────────────────────────────────────── */

function Readout({ p, m }: { p: ScopeLineProps; m: ReturnType<typeof useScopeBindings> }) {
  const r = m.r;
  const pin = scopePin(p.scope);
  const chose =
    m.named === null
      ? "nothing — every call takes what the fleet resolves"
      : `${m.documentLabel(m.named)}${pin ? `, pinned to ${m.sessionLabel(pin)}` : ""}`;
  const got =
    r.kind === "resolved"
      ? `${m.sessionLabel(r.session)} via ${r.via}${m.derived ? `, holding ${m.documentLabel(r.document)}` : ""}`
      : r.kind === "ambiguous"
        ? `${r.holders.length} Revits hold it — pick one`
        : r.kind === "unheld"
          ? r.eligible.length
            ? `open nowhere — ${r.eligible.map(m.sessionLabel).join(", ")} could`
            : "open nowhere, and no Revit of its year is up"
          : r.sessions.length
            ? `${r.sessions.length} Revits up, none chosen`
            : "no Revit is up";
  // Drift: the last call ran somewhere the Scope no longer resolves to (a pin alone bumps the
  // revision without moving the target, so the revision is not the test).
  const drift =
    p.ran !== null &&
    (r.kind !== "resolved" || p.ran.session !== r.session || p.ran.document !== r.document);
  const rows: [string, ReactNode, boolean][] = [
    ["chose", chose, false],
    ["got", got, r.kind !== "resolved"],
    [
      "ran",
      p.ran ? (
        <>
          <span className="face-mono">{p.ran.key}</span> r{p.ran.revision}
          {p.ran.session ? ` in ${m.sessionLabel(p.ran.session)}` : ""}
          {p.ran.ok ? "" : " — refused"}
          {drift ? " — not what you would get now" : ""}
        </>
      ) : (
        "nothing yet"
      ),
      Boolean(drift),
    ],
  ];
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 t-small" data-testid="scope-readout">
      {rows.map(([label, value, caution]) => (
        <Fragment key={label}>
          <dt className="t-upper" style={{ color: token("ink-mute") }}>
            {label}
          </dt>
          <dd
            data-tone={caution ? "caution" : undefined}
            style={caution ? undefined : { color: token("ink-2") }}
          >
            {value}
          </dd>
        </Fragment>
      ))}
    </dl>
  );
}

/** The Scope as the composer's to-line. Mounted by ChatShell in the composer topBar. */
export function ScopeLine({ live }: { live?: boolean }) {
  const [openSlot, setOpen] = useState<string | null>(null);
  const p = useScopeLine(live, openSlot === "pick:document");
  const m = useScopeBindings(p, openSlot, setOpen);
  const { manifest, b, r } = m;
  const [readout, setReadout] = useState(false);
  const pinned = r.kind === "resolved" && r.via === "pin";
  // The holder is noise when it is the only answer: draw the Revit only when the user has to
  // choose (several holders) or already chose one and can unchoose it.
  const showSession = r.kind === "ambiguous" || pinned;
  const note =
    r.kind === "unheld"
      ? r.eligible.length === 1
        ? `not open — ${m.sessionLabel(r.eligible[0]!)} could`
        : r.eligible.length
          ? `not open — ${r.eligible.length} Revits could`
          : "not open, and no Revit of its year is up"
      : r.kind === "unchosen" && r.sessions.length === 0
        ? "no Revit is up"
        : null;
  const mute = { color: token("ink-2") };
  return (
    <div
      className="hairline-b flex flex-col gap-1 px-3 py-1.5"
      data-testid="scope-head"
      data-scope={r.kind}
    >
      <div className="flex flex-wrap items-baseline gap-2 t-small">
        <span className="t-upper" style={{ color: token("ink-mute") }}>
          to
        </span>
        <span className="inline-flex flex-wrap items-baseline gap-x-1.5">
          <Picker
            product={manifest}
            link={manifest.slots.document}
            b={b}
            inert={p.busy}
            derived={m.derived !== null}
          />
          {showSession ? (
            <>
              <span style={mute}>in</span>
              <Picker product={manifest} link={manifest.slots.session} b={b} inert={p.busy} />
            </>
          ) : null}
          {note ? <span data-tone="caution">{note}</span> : null}
        </span>
        <span className="flex-1" />
        {p.refusal ? <span style={mute}>{p.refusal}</span> : null}
        <Press
          type="button"
          tone="quiet"
          size="caption"
          data-tone={p.busy ? "pea" : undefined}
          title={
            (p.busy ? "pea is mid-turn; the turn keeps the Scope it was admitted under. " : "") +
            (readout ? "hide the readout" : "readout: chose / got / ran")
          }
          onClick={() => setReadout(!readout)}
          data-testid="scope-revision"
        >
          r{p.revision}
        </Press>
      </div>
      {readout ? <Readout p={p} m={m} /> : null}
    </div>
  );
}

/* ── fixture: `/chat?source=fixture&scope=<kind>` draws each resolution without a host ─────── */

type FixtureScope = "resolved" | "unheld" | "ambiguous" | "unchosen";
function fixtureScope(kind: FixtureScope | null) {
  const document = address("C:\\Fixtures\\project-a Residence.rvt");
  const family = address("C:\\Fixtures\\Door-Single.rfa");
  const one: ScopeSession = {
    id: "pe.app-25",
    year: 2025,
    document,
    documentLabel: "project-a Residence.rvt",
  };
  const two: ScopeSession = {
    id: "pe.app-26",
    year: 2025,
    document: kind === "ambiguous" ? document : family,
    documentLabel: kind === "ambiguous" ? "project-a Residence.rvt" : "Door-Single.rfa",
  };
  const idle: ScopeSession = { id: "pe.idle", year: 2025, document: null, documentLabel: null };
  const sessions = [one, two, idle];
  const recent = address("C:\\Fixtures\\Recent Tower.rvt");
  const documents = scopeDocuments(sessions, [
    { document: recent, label: "Recent Tower.rvt", year: 2025 },
  ]);
  const scope: Scope =
    kind === "resolved" || kind === "ambiguous"
      ? { kind: "document", document }
      : kind === "unheld"
        ? { kind: "document", document: recent }
        : emptyScope;
  const revision = { resolved: 3, unheld: 2, ambiguous: 4, unchosen: 0 }[kind ?? "unchosen"];
  return { scope, revision, sessions, documents };
}
